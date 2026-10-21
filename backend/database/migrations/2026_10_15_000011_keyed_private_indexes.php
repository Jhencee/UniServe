<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\{DB,Crypt};
return new class extends Migration {
 public function up():void {
  foreach(['shared_appointments','shared_chats'] as $table)DB::table($table)->orderBy('id')->chunk(100,function($rows)use($table){foreach($rows as $row){$d=json_decode(Crypt::decryptString($row->payload),true);DB::table($table)->where('id',$row->id)->update(['email'=>\App\Support\EmailIndex::key($d['email'])]);}});
  DB::table('queues')->whereNotNull('portal_payload')->orderBy('id')->chunk(100,function($rows){foreach($rows as $row){$q=\App\Support\QueueData::read($row->portal_payload);DB::table('queues')->where('id',$row->id)->update(['email_hash'=>\App\Support\EmailIndex::key($q['email']??'')]);}});
 }
 public function down():void {throw new RuntimeException('Private indexes require a reviewed key-rotation procedure.');}
};
