<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void { Schema::table('staff_users',function(Blueprint $table){$table->text('mfa_secret')->nullable();$table->string('mfa_version',64)->nullable();$table->text('mfa_recovery_codes')->nullable();$table->bigInteger('mfa_last_step')->nullable();}); }
    public function down(): void { Schema::table('staff_users',fn(Blueprint $table)=>$table->dropColumn(['mfa_secret','mfa_version','mfa_recovery_codes','mfa_last_step'])); }
};
