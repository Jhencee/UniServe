<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('system_audit')) Schema::create('system_audit', function (Blueprint $t) {
            $t->string('id', 80)->primary(); $t->string('actor_id')->nullable(); $t->string('actor_name');
            $t->string('category', 50); $t->string('action', 1000); $t->string('target', 200)->nullable();
            $t->json('changes'); $t->string('source', 30); $t->timestamp('created_at')->index();
        });
        if (!Schema::hasTable('notification_outbox')) Schema::create('notification_outbox', function (Blueprint $t) {
            $t->id(); $t->string('visit_id', 80)->index(); $t->string('recipient'); $t->string('subject');
            $t->text('body'); $t->dateTime('scheduled_at'); $t->dateTime('send_at')->index(); $t->timestamp('sent_at')->nullable();
            $t->string('status', 20)->default('pending'); $t->string('kind', 30); $t->string('dedup_key', 64)->unique();
            $t->string('actor_id'); $t->unsignedInteger('attempts')->default(0); $t->text('last_error')->nullable();
            $t->timestamps();
        });
    }
    public function down(): void
    {
        Schema::dropIfExists('notification_outbox'); Schema::dropIfExists('system_audit');
    }
};
