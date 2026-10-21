<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
return new class extends Migration {
 public function up():void {foreach(['shared_appointments','shared_chats'] as $table)DB::table($table)->where('email','like','%@%')->orderBy('id')->chunk(100,function($rows)use($table){foreach($rows as $row)DB::table($table)->where('id',$row->id)->update(['email'=>hash('sha256',strtolower($row->email))]);});}
 public function down():void {throw new RuntimeException('Private email indexes are intentionally one-way; original values remain in encrypted payloads.');}
};
