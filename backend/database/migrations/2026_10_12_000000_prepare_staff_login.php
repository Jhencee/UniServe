<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('staff_users', 'email')) {
            Schema::table('staff_users', fn (Blueprint $table) => $table->string('email', 120)->nullable()->unique());
        }
        if (! Schema::hasColumn('staff_users', 'confidential_access')) {
            Schema::table('staff_users', fn (Blueprint $table) => $table->boolean('confidential_access')->default(false));
        }
        // Admin accounts are created through Admin Management.

    }

    public function down(): void
    {
        // Preserve staff accounts and credentials when rolling back.
    }
};
