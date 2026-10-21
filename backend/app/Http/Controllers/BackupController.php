<?php
namespace App\Http\Controllers;

use App\Support\{StaffAuth,SystemAudit};
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{Cache,Crypt,DB,Schema,Storage};
use Illuminate\Support\Str;

class BackupController extends Controller
{
    private const TABLES=['staff_users','services','appointments','transactions','visitor_log','queue_counters','shared_appointments','shared_transactions','shared_visitor_log','shared_chats','confidential_cases','confidential_requests','office_calendar','service_catalog','shared_system_settings','queues','notification_outbox','system_audit','calendar_audit'];

    private function decode(array $backup):array
    {
        abort_unless(($backup['format']??'')==='uniserve-encrypted-v1',422,'Select a UniServe encrypted backup.');
        try {$tables=json_decode(Crypt::decryptString($backup['encrypted']??''),true,512,JSON_THROW_ON_ERROR);}
        catch(\Throwable $e){abort(422,'Cannot decrypt this backup. It must be unchanged and use this server’s original application key.');}
        abort_unless(is_array($tables)&&$tables,422,'The backup is empty or invalid.');
        foreach($tables as $table=>$rows){
            abort_unless(in_array($table,self::TABLES,true)&&Schema::hasTable($table),422,'The backup contains an unsupported table.');
            abort_unless(is_array($rows)&&array_is_list($rows),422,'Invalid backup records.');
            $columns=Schema::getColumnListing($table);
            foreach($rows as $row)abort_unless(is_array($row)&&$row&&!array_diff(array_keys($row),$columns),422,'Backup columns do not match this database.');
        }
        abort_unless(collect($tables['staff_users']??[])->contains(fn($u)=>($u['role']??'')==='SUPER_ADMIN'&&($u['is_active']??false)),422,'The backup must contain an active Super Admin account.');
        return $tables;
    }

    public function preview(Request $request)
    {
        $actor=StaffAuth::user($request,'SUPER_ADMIN');
        $data=$request->validate(['backup'=>'required|array','backup.format'=>'required|string','backup.encrypted'=>'required|string|max:30000000','backup.createdAt'=>'required|date']);
        $tables=$this->decode($data['backup']);
        $token=(string)Str::uuid();
        Cache::put('backup-restore:'.$token,['actor'=>$actor->id,'backup'=>$data['backup']],600);
        return response()->json(['token'=>$token,'createdAt'=>$data['backup']['createdAt'],'tables'=>collect($tables)->map(fn($rows,$table)=>['table'=>$table,'backupRows'=>count($rows),'currentRows'=>DB::table($table)->count()])->values(),'message'=>'Records in the listed tables will be replaced. A recovery backup will be saved first. Restored pending emails will be paused to prevent duplicate delivery. You must sign in again using an account from this backup.']);
    }

    public function restore(Request $request)
    {
        $actor=StaffAuth::user($request,'SUPER_ADMIN');
        $data=$request->validate(['token'=>'required|uuid','confirmation'=>'required|in:RESTORE']);
        return Cache::lock('backup-restore-lock',120)->block(5,function()use($data,$actor){
            $key='backup-restore:'.$data['token'];$preview=Cache::get($key);
            abort_unless($preview&&$preview['actor']===$actor->id,422,'Preview expired. Select your backup again.');
            $tables=$this->decode($preview['backup']);
            if(DB::getDriverName()==='mysql')foreach(array_keys($tables) as $table){
                $engine=DB::selectOne('SELECT ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[$table]);
                abort_unless(strtolower($engine->engine??'')==='innodb',422,'Restore requires transactional database tables.');
            }
            $recovery=DB::transaction(function()use($tables,$actor){
                $before=[];
                foreach(array_keys($tables) as $table)$before[$table]=DB::table($table)->lockForUpdate()->get()->toArray();
                $file='activity-backups/pre-restore-'.now()->format('Ymd-His').'-'.Str::uuid().'.json';
                $backup=['format'=>'uniserve-encrypted-v1','createdAt'=>now()->toIso8601String(),'encrypted'=>Crypt::encryptString(json_encode($before,JSON_THROW_ON_ERROR))];
                abort_unless(Storage::disk('local')->put($file,json_encode($backup,JSON_THROW_ON_ERROR)),500,'Could not save the recovery backup. Nothing was restored.');
                foreach(array_reverse(array_keys($tables)) as $table)DB::table($table)->delete();
                foreach($tables as $table=>$rows)foreach(array_chunk($rows,50) as $chunk)DB::table($table)->insert($chunk);
                if(isset($tables['notification_outbox']))DB::table('notification_outbox')->whereIn('status',['pending','failed'])->update(['status'=>'paused']);
                SystemAudit::record($actor,'Data','Restored encrypted database backup');
                return $file;
            });
            Cache::forget($key);
            return response()->json(['restored'=>true,'recoveryBackup'=>$recovery]);
        });
    }
}
