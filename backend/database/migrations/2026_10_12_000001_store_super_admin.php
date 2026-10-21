<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

return new class extends Migration
{
    public function up(): void
    {
        if (! DB::table('staff_users')->where('role', 'SUPER_ADMIN')->exists()) {
            DB::table('staff_users')->insert([
                'id' => 'u1', 'username' => 'admin', 'email' => 'sysadmin@oss.edu.ph',
                'full_name' => 'System Administrator', 'role' => 'SUPER_ADMIN',
                'password_hash' => Hash::make('admin123'), 'is_active' => true,
                'confidential_access' => false,
            ]);
        }
    }

    public function down(): void
    {
        // Preserve the Super Admin account and changed credentials.
    }
};
