<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\{DB,Schema,Crypt};
return new class extends Migration {
 public function up():void {
  if(DB::connection()->getDriverName()!=='mysql')return;
  $legacy=['activity_log','appointment_attachments','appointments','chat_message_attachments','chat_messages','chats','incidents','scholarships','service_requirements','transaction_attachments','transactions','system_settings','services'];
  foreach($legacy as $table)if(Schema::hasTable($table)&&DB::table($table)->exists())throw new RuntimeException('Legacy cleanup refused: '.$table.' is not empty.');
  $links=DB::select('SELECT TABLE_NAME,COLUMN_NAME,CONSTRAINT_NAME,REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL');
  foreach($links as $link)if(!in_array($link->TABLE_NAME,$legacy)&&in_array($link->REFERENCED_TABLE_NAME,$legacy)&&DB::table($link->TABLE_NAME)->whereNotNull($link->COLUMN_NAME)->exists())throw new RuntimeException('Legacy cleanup refused: live references exist.');
  $snapshot=['database'=>DB::connection()->getDatabaseName(),'createdAt'=>now()->toIso8601String(),'tables'=>[]];
  foreach(DB::select('SHOW TABLES') as $row){$table=array_values((array)$row)[0];$definition=DB::select('SHOW CREATE TABLE '.DB::connection()->getQueryGrammar()->wrapTable($table));$snapshot['tables'][$table]=['definition'=>array_values((array)$definition[0])[1],'rows'=>DB::table($table)->get()->toArray()];}
  $directory=storage_path('app/private/schema-backups');if(!is_dir($directory))mkdir($directory,0700,true);$file=$directory.'/before-legacy-cleanup-'.now()->format('Ymd-His').'.json';
  $encrypted=Crypt::encryptString(json_encode($snapshot,JSON_THROW_ON_ERROR));if(file_put_contents($file,json_encode(['format'=>'uniserve-schema-snapshot-v1','encrypted'=>$encrypted],JSON_THROW_ON_ERROR))===false)throw new RuntimeException('Cannot save cleanup backup.');Crypt::decryptString($encrypted);
  foreach($links as $link)if(!in_array($link->TABLE_NAME,$legacy)&&in_array($link->REFERENCED_TABLE_NAME,$legacy))Schema::table($link->TABLE_NAME,fn($table)=>$table->dropForeign($link->CONSTRAINT_NAME));
  foreach($legacy as $table)Schema::dropIfExists($table);
 }
 public function down():void {throw new RuntimeException('Use the encrypted pre-cleanup schema snapshot to restore legacy schema explicitly.');}
};
