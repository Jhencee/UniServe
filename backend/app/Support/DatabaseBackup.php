<?php
namespace App\Support;

use Illuminate\Support\Facades\{Crypt, DB, Schema, Storage};
use Illuminate\Support\Str;

/** Application data only. Infrastructure secrets and runtime queues are deliberately excluded. */
class DatabaseBackup
{
    public const TABLES = ['staff_users','services','appointments','transactions','visitor_log','queue_counters','shared_appointments','shared_transactions','shared_visitor_log','shared_chats','confidential_cases','confidential_requests','office_calendar','service_catalog','shared_system_settings','queues','notification_outbox','system_audit','calendar_audit'];
    // Older installations have these unused tables; current records use the shared_* tables.
    private const LEGACY_TABLES = ['services','appointments','transactions','visitor_log'];

    public static function tables(): array
    {
        return array_values(array_filter(self::TABLES, fn($table) => Schema::hasTable($table)));
    }

    public static function snapshot(): array
    {
        // Lock the exported application rows in a fixed order until the snapshot is complete.
        // Production disaster-recovery exports should still run during a quiet/paused period.
        $tables = DB::transaction(function () {
            $result = [];
            foreach (self::tables() as $table) $result[$table] = DB::table($table)->lockForUpdate()->get()->map(fn($row)=>(array)$row)->all();
            return $result;
        });
        return ['format'=>'uniserve-encrypted-v1', 'createdAt'=>now()->toIso8601String(),
            'scope'=>'application-database', 'encrypted'=>Crypt::encryptString(json_encode($tables, JSON_THROW_ON_ERROR))];
    }

    public static function decode(array $backup, bool $complete = true): array
    {
        abort_unless(($backup['format']??'') === 'uniserve-encrypted-v1', 422, 'Select a UniServe encrypted database backup.');
        try { $tables = json_decode(Crypt::decryptString($backup['encrypted']??''), true, 512, JSON_THROW_ON_ERROR); }
        catch (\Throwable $e) { abort(422, 'Cannot decrypt this backup. Preserve the original application key and the unchanged backup file.'); }
        abort_unless(is_array($tables) && $tables, 422, 'The backup is empty or invalid.');
        $expected = self::tables();
        if ($complete) {
            $missing=array_values(array_diff($expected,array_keys($tables)));
            $required=array_values(array_filter($missing,fn($table)=>!in_array($table,self::LEGACY_TABLES,true)||DB::table($table)->exists()));
            abort_if($required,422,'This backup is missing required data tables: '.implode(', ',$required).'. Choose a complete backup for this database. Current records have not been changed.');
            // Never fabricate missing rows or overwrite a populated legacy table.
            // Omitted empty legacy tables stay untouched during restore.
        }
        foreach ($tables as $table=>$rows) {
            if (!in_array($table,$expected,true) && in_array($table,self::LEGACY_TABLES,true) && $rows===[]) continue;
            abort_unless(in_array($table,$expected,true) && is_array($rows) && array_is_list($rows), 422, 'Backup tables do not match this database.');
            $columns = Schema::getColumnListing($table);
            foreach ($rows as $row) abort_unless(is_array($row) && $row && !array_diff(array_keys($row),$columns) && (!$complete || !array_diff($columns,array_keys($row))), 422, 'Backup columns do not match this database. Use the matching migrated application version.');
        }
        if ($complete) abort_unless(collect($tables['staff_users']??[])->contains(fn($u)=>($u['role']??'')==='SUPER_ADMIN' && ($u['is_active']??false)), 422, 'The backup must contain an active Super Admin account.');
        $ordered=[];
        foreach ($expected as $table) if (array_key_exists($table,$tables)) $ordered[$table]=$tables[$table];
        return $ordered;
    }

    public static function save(array $backup, string $kind, ?object $actor = null): array
    {
        $tables = self::decode($backup, $kind !== 'pre-restore');
        $json = json_encode($backup, JSON_THROW_ON_ERROR);
        $id = (string) Str::uuid();
        $disk = Storage::disk('local');
        $path = 'activity-backups/'.$id.'.json';
        abort_unless($disk->put($path,$json) && hash_equals(hash('sha256',$json), hash('sha256',$disk->get($path))), 500, 'Could not verify the server backup file.');
        $metadata = ['id'=>$id,'kind'=>$kind,'createdAt'=>$backup['createdAt'],'savedAt'=>now()->toIso8601String(),
            'sha256'=>hash('sha256',$json),'bytes'=>strlen($json),'tables'=>count($tables),
            'rows'=>array_sum(array_map('count',$tables)), 'actor'=>$actor?->full_name??'System operator',
            'verification'=>'decryption-and-schema', 'restoreTested'=>false];
        abort_unless($disk->put('activity-backups/index/'.$id.'.json',json_encode($metadata,JSON_THROW_ON_ERROR)), 500, 'Backup saved but history could not be recorded.');
        return $metadata;
    }

    public static function history(): array
    {
        $disk = Storage::disk('local');
        $files = $disk->files('activity-backups/index');
        // Inspect a bounded recent set. No backup is automatically deleted.
        usort($files, fn($a,$b)=>$disk->lastModified($b)<=>$disk->lastModified($a));
        $result=[];
        foreach (array_slice($files,0,20) as $file) {
            try {
                $meta=json_decode($disk->get($file),true,512,JSON_THROW_ON_ERROR);
                if (!Str::isUuid($meta['id']??'')) continue;
                $path='activity-backups/'.$meta['id'].'.json';
                $meta['fileAvailable']=$disk->exists($path);
                $result[]=$meta;
            } catch (\Throwable $e) { /* An unreadable manifest is not a verified backup. */ }
        }
        return $result;
    }

    public static function read(string $id): array
    {
        abort_unless(Str::isUuid($id),404);
        $disk=Storage::disk('local');
        $path='activity-backups/'.$id.'.json';
        $index='activity-backups/index/'.$id.'.json';
        abort_unless($disk->exists($path)&&$disk->exists($index),404,'Server backup not found.');
        $json=$disk->get($path);
        $meta=json_decode($disk->get($index),true,512,JSON_THROW_ON_ERROR);
        abort_unless(hash_equals($meta['sha256']??'',hash('sha256',$json)),422,'The stored backup checksum does not match.');
        $backup=json_decode($json,true,512,JSON_THROW_ON_ERROR);
        self::decode($backup);
        return ['backup'=>$backup,'metadata'=>$meta];
    }

    public static function restore(array $tables, object $actor): string
    {
        if (DB::getDriverName()==='mysql') foreach(array_keys($tables) as $table) {
            $engine=DB::selectOne('SELECT ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[$table]);
            abort_unless(strtolower($engine->engine??'')==='innodb',422,'Restore requires transactional database tables.');
        }
        return DB::transaction(function()use($tables,$actor){
            $before=[];
            foreach(array_keys($tables) as $table) $before[$table]=DB::table($table)->lockForUpdate()->get()->map(fn($r)=>(array)$r)->all();
            $backup=['format'=>'uniserve-encrypted-v1','createdAt'=>now()->toIso8601String(),'encrypted'=>Crypt::encryptString(json_encode($before,JSON_THROW_ON_ERROR))];
            $saved=self::save($backup,'pre-restore',$actor);
            foreach(array_reverse(array_keys($tables)) as $table) DB::table($table)->delete();
            foreach($tables as $table=>$rows) foreach(array_chunk($rows,50) as $chunk) DB::table($table)->insert($chunk);
            if(isset($tables['notification_outbox'])) DB::table('notification_outbox')->whereIn('status',['pending','failed'])->update(['status'=>'paused']);
            SystemAudit::record($actor,'Data','Restored encrypted database backup',$saved['id']);
            return 'activity-backups/'.$saved['id'].'.json';
        });
    }
}
