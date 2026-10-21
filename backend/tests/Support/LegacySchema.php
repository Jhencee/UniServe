<?php

namespace Tests\Support;

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

final class LegacySchema
{
    public static function create(): void
    {
        if (DB::connection()->getDriverName() !== 'sqlite' || DB::connection()->getDatabaseName() !== ':memory:') {
            throw new \RuntimeException('Legacy fixtures require an isolated in-memory database.');
        }

        Schema::create('staff_users', function (Blueprint $t) {
            $t->string('id')->primary();
            $t->string('username')->collation('NOCASE')->unique();
            $t->string('password_hash');
            $t->string('full_name');
            $t->string('role')->default('ADMIN');
            $t->boolean('is_active')->default(true);
            $t->timestamps();
        });
        Schema::create('queues', function (Blueprint $t) {
            $t->string('id')->primary();
            foreach (['queue_number', 'prefix', 'visitor_type', 'service_label_text', 'visitor_name', 'id_number', 'contact', 'source', 'status', 'assigned_admin_id', 'assigned_admin_name'] as $field) {
                $t->string($field)->nullable();
            }
            $t->integer('seq')->nullable();
            foreach (['called_at', 'serving_at', 'completed_at'] as $field) {
                $t->timestamp($field)->nullable();
            }
            $t->timestamps();
        });
        Schema::create('queue_counters', function (Blueprint $t) {
            $t->date('day_key');
            $t->string('prefix');
            $t->integer('last_seq')->default(0);
            $t->primary(['day_key', 'prefix']);
        });
        foreach (glob(database_path('migrations/2026_*.php')) as $migration) {
            (require $migration)->up();
        }
    }
}
