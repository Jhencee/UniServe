<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
 public function up():void{
  if(!Schema::hasTable('shared_chats'))Schema::create('shared_chats',function(Blueprint $t){$t->string('id')->primary();$t->string('email',120)->index();$t->string('status')->default('Open');$t->longText('payload');$t->timestamps();});
  Schema::create('shared_system_settings',function(Blueprint $t){$t->integer('id')->primary();$t->json('payload');$t->unsignedInteger('revision')->default(0);});
  \Illuminate\Support\Facades\DB::table('shared_system_settings')->insert(['id'=>1,'payload'=>json_encode(['maintenanceMode'=>false,'sessionTimeout'=>30,'gracePeriodMinutes'=>15,'noShowThresholdMinutes'=>60])]);
 }
 public function down():void{Schema::dropIfExists('shared_chats');Schema::dropIfExists('shared_system_settings');}
};
