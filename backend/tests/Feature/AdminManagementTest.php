<?php

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;

uses(DatabaseTransactions::class);

beforeEach(function(){\Tests\Support\LegacySchema::create(); DB::table('staff_users')->where('role','SUPER_ADMIN')->update(['password_hash'=>\Illuminate\Support\Facades\Hash::make('FixturePassword123')]);});


function superAdminHeaders(): array
{
    return ['Authorization' => 'Bearer '.\App\Support\StaffAuth::token(DB::table('staff_users')->where('role', 'SUPER_ADMIN')->first())];
}

it('rejects account management without super admin credentials', function () {
    $this->getJson('/api/admins')->assertUnauthorized();
    $this->postJson('/api/admins', [], ['Authorization' => 'Basic '.base64_encode('oss.admin:1234')])->assertUnauthorized();
});

it('creates edits disables resets and removes a database admin', function () {
    $headers = superAdminHeaders();
    $response = $this->postJson('/api/admins', [
        'fullName' => 'Management Test', 'username' => 'management.test',
        'email' => 'management.test@example.com', 'password' => 'OriginalPassword123!',
    ], $headers)->assertCreated();
    $id = $response->json('user.id');
    expect($response->json('user'))->not->toHaveKeys(['password', 'password_hash']);
    $this->postJson('/api/login', ['username' => 'management.test', 'password' => 'OriginalPassword123!'])->assertOk();
    $this->patchJson('/api/admins/'.$id, ['fullName' => 'Edited Name', 'confidentialAccess' => true, 'active' => false], $headers)
        ->assertOk()->assertJsonPath('user.fullName', 'Edited Name')->assertJsonPath('user.confidentialAccess', true);
    $this->postJson('/api/login', ['username' => 'management.test', 'password' => 'OriginalPassword123!'])->assertForbidden();
    $this->patchJson('/api/admins/'.$id, ['active' => true, 'password' => 'ReplacementPassword123!'], $headers)->assertOk();
    $this->postJson('/api/login', ['username' => 'management.test', 'password' => 'ReplacementPassword123!'])->assertOk();
    $this->getJson('/api/admins', $headers)->assertOk()->assertJsonFragment(['username' => 'Management.test']);
    $this->deleteJson('/api/admins/'.$id, [], $headers)->assertOk();
    expect(DB::table('staff_users')->where('id', $id)->exists())->toBeFalse();
});

it('validates duplicate accounts and protects reserved super admin identifiers', function () {
    $data = ['fullName' => 'Test', 'username' => 'admin', 'password' => '1234'];
    $this->postJson('/api/admins', $data, superAdminHeaders())->assertUnprocessable();
    $data['username'] = 'oss.admin';
    $this->postJson('/api/admins', $data, superAdminHeaders())->assertUnprocessable();
    $this->patchJson('/api/admins/u1', ['active' => false], superAdminHeaders())->assertNotFound();
});
