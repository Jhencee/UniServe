<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;
return new class extends Migration {
    public function up(): void {
        Schema::table('staff_users', fn(Blueprint $t) => $t->boolean('confidential_approver')->default(false));
        Schema::create('confidential_cases', function(Blueprint $t) {
            $t->string('id',80)->primary(); $t->string('code',80); $t->string('assigned_admin_id')->nullable(); $t->timestamps();
        });
        Schema::create('confidential_requests', function(Blueprint $t) {
            $t->uuid('id')->primary(); $t->string('case_id',80)->index(); $t->string('requester_id');
            $t->string('scope',10); $t->text('reason'); $t->string('status')->default('Pending');
            $t->string('reviewer_id')->nullable(); $t->text('decision_note')->nullable(); $t->timestamp('expires_at')->nullable(); $t->timestamps();
        });
    }
    public function down(): void {
        Schema::dropIfExists('confidential_requests'); Schema::dropIfExists('confidential_cases');
        Schema::table('staff_users', fn(Blueprint $t) => $t->dropColumn('confidential_approver'));
    }
};
