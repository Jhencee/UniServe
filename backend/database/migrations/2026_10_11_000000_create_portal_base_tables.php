<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
 public function up():void {
  if(!Schema::hasTable('staff_users'))Schema::create('staff_users',function(Blueprint $t){$t->string('id',20)->primary();$t->string('username',50)->unique();$t->string('password_hash');$t->string('full_name',120);$t->string('email',120)->nullable()->unique();$t->string('role',20)->default('ADMIN');$t->boolean('is_active')->default(true);$t->boolean('confidential_access')->default(false);$t->timestamps();});
  if(!Schema::hasTable('queues'))Schema::create('queues',function(Blueprint $t){$t->string('id',20)->primary();$t->string('queue_number',20);$t->string('prefix',5);$t->integer('seq');$t->json('portal_payload')->nullable();$t->string('visitor_type',20)->default('Student');$t->string('service_label_text',150)->nullable();$t->string('source',20)->default('Walk-in');$t->string('visitor_name',150)->nullable();$t->string('id_number',50)->nullable();$t->string('contact',50)->nullable();$t->string('status',20)->default('Waiting');$t->string('assigned_admin_id',20)->nullable();$t->string('assigned_admin_name',120)->nullable();$t->integer('recall_count')->default(0);$t->timestamp('called_at')->nullable();$t->timestamp('serving_at')->nullable();$t->timestamp('completed_at')->nullable();$t->timestamp('recalled_at')->nullable();$t->timestamps();});
  if(!Schema::hasTable('queue_counters'))Schema::create('queue_counters',function(Blueprint $t){$t->date('day_key');$t->string('prefix',5);$t->integer('last_seq')->default(0);$t->primary(['day_key','prefix']);});
 }
 public function down():void { /* Preserve portal data during rollback. */ }
};
