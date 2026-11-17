<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('staff_trusted_devices', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->string('staff_user_id', 64)->index();
            $table->char('token_hash', 64)->unique();
            $table->char('credential_hash', 64);
            $table->char('agent_hash', 64);
            $table->char('ip_hash', 64);
            $table->string('label', 100);
            $table->timestamp('expires_at')->index();
            $table->timestamp('last_used_at');
            $table->timestamp('revoked_at')->nullable();
            $table->timestamps();
        });
    }
    public function down(): void { Schema::dropIfExists('staff_trusted_devices'); }
};
