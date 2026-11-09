<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('staff_users')) {
            Schema::create('staff_users', function (Blueprint $table) {
                $table->string('id', 20)->primary();
                $table->string('username', 50)->unique();
                $table->string('password_hash');
                $table->string('full_name', 120);
                $table->string('email', 120)->nullable()->unique();
                $table->string('role', 20)->default('ADMIN');
                $table->boolean('is_active')->default(true);
                $table->boolean('confidential_access')->default(false);
                $table->timestamps();
            });
        }
        if (! Schema::hasTable('queues')) {
            Schema::create('queues', function (Blueprint $table) {
                $table->string('id', 20)->primary();
                $table->string('queue_number', 20);
                $table->string('prefix', 5);
                $table->integer('seq');
                $table->json('portal_payload')->nullable();
                $table->string('visitor_type', 20)->default('Student');
                $table->string('service_label_text', 150)->nullable();
                $table->string('source', 20)->default('Walk-in');
                $table->string('visitor_name', 150)->nullable();
                $table->string('id_number', 50)->nullable();
                $table->string('contact', 50)->nullable();
                $table->string('status', 20)->default('Waiting');
                $table->string('assigned_admin_id', 20)->nullable();
                $table->string('assigned_admin_name', 120)->nullable();
                $table->integer('recall_count')->default(0);
                foreach (['called_at', 'serving_at', 'completed_at', 'recalled_at'] as $column) {
                    $table->timestamp($column)->nullable();
                }
                $table->timestamps();
            });
        }
        if (! Schema::hasTable('queue_counters')) {
            Schema::create('queue_counters', function (Blueprint $table) {
                $table->date('day_key');
                $table->string('prefix', 5);
                $table->integer('last_seq')->default(0);
                $table->primary(['day_key', 'prefix']);
            });
        }
    }

    public function down(): void
    {
        // Preserve portal records during rollback.
    }
};
