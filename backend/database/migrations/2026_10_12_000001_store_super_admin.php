<?php

use Illuminate\Database\Migrations\Migration;

return new class extends Migration
{
    public function up(): void
    {
        // Create the first account using portal:create-super-admin, never a shared password.
    }

    public function down(): void
    {
        // Preserve the Super Admin account and changed credentials.
    }
};
