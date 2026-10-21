<?php

use App\Support\OfficeCalendar;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('office_calendar', function (Blueprint $table) {
            $table->unsignedInteger('id')->primary();
            $table->json('payload');
        });
        Schema::create('calendar_audit', function (Blueprint $table) {
            $table->id(); $table->string('actor_id'); $table->string('actor_name');
            $table->json('before'); $table->json('after'); $table->json('effects'); $table->timestamp('created_at');
        });
        DB::table('office_calendar')->insert(['id' => 1, 'payload' => json_encode(OfficeCalendar::defaults())]);
    }

    public function down(): void
    {
        Schema::dropIfExists('calendar_audit'); Schema::dropIfExists('office_calendar');
    }
};
