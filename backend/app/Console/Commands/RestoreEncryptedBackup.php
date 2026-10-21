<?php
namespace App\Console\Commands;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\{DB,Crypt,Schema};
class RestoreEncryptedBackup extends Command {
 protected $signature='backup:restore {file} {--verify : Verify decryption and schema without changing records}';
 protected $description='Restore an authenticated encrypted UniServe backup into the migrated database';
 public function handle():int {
  try{$backup=json_decode(file_get_contents($this->argument('file')),true,512,JSON_THROW_ON_ERROR);if(($backup['format']??'')!=='uniserve-encrypted-v1')throw new \RuntimeException('Unsupported backup format.');$tables=json_decode(Crypt::decryptString($backup['encrypted']),true,512,JSON_THROW_ON_ERROR);
   $allowed=['staff_users','services','appointments','transactions','visitor_log','queue_counters','shared_appointments','shared_transactions','shared_visitor_log','shared_chats','confidential_cases','confidential_requests','office_calendar','service_catalog','shared_system_settings','queues','notification_outbox','system_audit','calendar_audit'];
   foreach($tables as $table=>$rows)if(!in_array($table,$allowed)||!Schema::hasTable($table)||!is_array($rows))throw new \RuntimeException('Backup and database schema do not match.');
   foreach($tables as $table=>$rows){$columns=Schema::getColumnListing($table);foreach($rows as $row)if(!is_array($row)||array_diff(array_keys($row),$columns))throw new \RuntimeException('Backup columns do not match.');}
   if($this->option('verify')){$this->info('Backup decrypts and matches the current schema. No records changed.');return self::SUCCESS;}
   if(!$this->confirm('This replaces saved records in the configured database. Have you saved a current backup and stopped the application?'))return self::FAILURE;
   Schema::disableForeignKeyConstraints();
   try{DB::transaction(function()use($tables){foreach($tables as $table=>$rows){if($table==='system_audit'){foreach(array_chunk($rows,100) as $batch)if($batch)DB::table($table)->insertOrIgnore($batch);continue;}DB::table($table)->delete();foreach(array_chunk($rows,100) as $batch)if($batch)DB::table($table)->insert($batch);}DB::table('cache')->delete();});}finally{Schema::enableForeignKeyConstraints();}
   \App\Support\SystemAudit::record((object)['id'=>null,'full_name'=>'System operator'],'Data','Encrypted database backup restored');
   $this->info('Backup restored. Restart the application and sign in again.');return self::SUCCESS;
  }catch(\Throwable $e){$this->error('Restore refused or rolled back. Check the backup format, application key and database schema.');return self::FAILURE;}
 }
}
