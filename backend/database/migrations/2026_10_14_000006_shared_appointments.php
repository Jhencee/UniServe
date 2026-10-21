<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
 public function up(): void {
  Schema::create('service_catalog',function(Blueprint $t){$t->string('key')->primary();$t->string('label');$t->json('payload');});
  $services=json_decode(file_get_contents(database_path('seeders/services.json')),true);
  foreach($services as $s) \Illuminate\Support\Facades\DB::table('service_catalog')->insert(['key'=>$s['key'],'label'=>$s['label'],'payload'=>json_encode($s)]);
  Schema::create('shared_appointments',function(Blueprint $t){$t->string('id')->primary();$t->string('visit_id',80)->unique();$t->string('email',120)->index();$t->string('service_key');$t->string('status');$t->date('date')->nullable();$t->string('time',5)->nullable();$t->string('queue_id')->nullable()->unique();$t->longText('payload');$t->unsignedInteger('revision')->default(0);$t->timestamps();});
  foreach(['shared_transactions','shared_visitor_log'] as $table) Schema::create($table,function(Blueprint $t){$t->string('id')->primary();$t->string('queue_id')->unique();$t->longText('payload');$t->timestamps();});
 }
 public function down(): void {foreach(['shared_visitor_log','shared_transactions','shared_appointments','service_catalog'] as $table)Schema::dropIfExists($table);}
};
