<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
 public function up(): void {Schema::table('shared_appointments',fn(Blueprint $t)=>$t->uuid('submission_key')->nullable()->unique());}
 public function down(): void {Schema::table('shared_appointments',fn(Blueprint $t)=>$t->dropColumn('submission_key'));}
};
