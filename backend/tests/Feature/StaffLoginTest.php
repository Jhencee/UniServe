<?php

use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

uses(DatabaseTransactions::class);

it('exposes only the public Turnstile key',function(){
 config(['services.turnstile.enabled'=>true,'services.turnstile.site_key'=>'public-key','services.turnstile.secret_key'=>'private-key']);
 $this->getJson('/api/login/challenge')->assertOk()->assertJsonPath('siteKey','public-key')->assertDontSee('private-key');
});
it('requires a valid Turnstile token before accepting login',function(){
 config(['services.turnstile.enabled'=>true,'services.turnstile.site_key'=>'public-key','services.turnstile.secret_key'=>'private-key','services.turnstile.hostnames'=>['campus.example']]);
 \Illuminate\Support\Facades\Http::fake(['challenges.cloudflare.com/*'=>\Illuminate\Support\Facades\Http::response(['success'=>true,'action'=>'staff-login','hostname'=>'campus.example'])]);
 $login=['username'=>'login.test','password'=>'test-password'];
 $this->postJson('/api/login',$login)->assertUnprocessable();
 \Illuminate\Support\Facades\Http::assertNothingSent();
 $this->postJson('/api/login',$login+['turnstileToken'=>'valid-token'])->assertOk();
});
it('rejects expired or mismatched Turnstile tokens',function($result){
 config(['services.turnstile.enabled'=>true,'services.turnstile.site_key'=>'public-key','services.turnstile.secret_key'=>'private-key','services.turnstile.hostnames'=>['campus.example']]);
 \Illuminate\Support\Facades\Http::fake(['challenges.cloudflare.com/*'=>\Illuminate\Support\Facades\Http::response($result)]);
 $this->postJson('/api/login',['username'=>'login.test','password'=>'test-password','turnstileToken'=>'bad-token'])->assertUnprocessable();
})->with([
 'expired'=>[['success'=>false,'error-codes'=>['timeout-or-duplicate']]],
 'wrong action'=>[['success'=>true,'action'=>'other','hostname'=>'campus.example']],
 'wrong host'=>[['success'=>true,'action'=>'staff-login','hostname'=>'other.example']],
]);
it('accepts successful dummy verification only with local test keys',function(){
 config(['services.turnstile.enabled'=>true,'services.turnstile.site_key'=>'1x00000000000000000000AA','services.turnstile.secret_key'=>'1x0000000000000000000000000000000AA','services.turnstile.hostnames'=>[]]);
 \Illuminate\Support\Facades\Http::fake(['challenges.cloudflare.com/*'=>\Illuminate\Support\Facades\Http::response(['success'=>true,'action'=>'test','hostname'=>'localhost'])]);
 $login=['username'=>'login.test','password'=>'test-password','turnstileToken'=>'XXXX.DUMMY.TOKEN.XXXX'];
 $this->postJson('/api/login',$login)->assertOk();
 config(['services.turnstile.secret_key'=>'production-secret']);
 $this->postJson('/api/login',$login)->assertUnprocessable();
});
it('still rejects failed dummy verification',function(){
 config(['services.turnstile.enabled'=>true,'services.turnstile.site_key'=>'1x00000000000000000000AA','services.turnstile.secret_key'=>'1x0000000000000000000000000000000AA','services.turnstile.hostnames'=>[]]);
 \Illuminate\Support\Facades\Http::fake(['challenges.cloudflare.com/*'=>\Illuminate\Support\Facades\Http::response(['success'=>false])]);
 $this->postJson('/api/login',['username'=>'login.test','password'=>'test-password','turnstileToken'=>'bad-token'])->assertUnprocessable();
});
it('blocks login when enabled Turnstile is not configured',function(){
 config(['services.turnstile.enabled'=>true,'services.turnstile.site_key'=>null,'services.turnstile.secret_key'=>null]);
 $this->postJson('/api/login',['username'=>'login.test','password'=>'test-password'])->assertStatus(503);
});

beforeEach(function () {
    \Tests\Support\LegacySchema::create();
    DB::table('staff_users')->insert([
        'id' => 'login-test', 'username' => 'login.test', 'full_name' => 'Login Test',
        'email' => 'login.test@example.com', 'password_hash' => Hash::make('test-password'),
        'role' => 'ADMIN', 'is_active' => true, 'confidential_access' => false,
    ]);
});

it('accepts a database username or email without exposing the password', function ($identifier) {
    $response = $this->postJson('/api/login', ['username' => $identifier, 'password' => 'test-password']);
    $response->assertOk()->assertJsonPath('user.id', 'login-test')->assertJsonPath('user.role', 'ADMIN');
    expect($response->json('user'))->not->toHaveKeys(['password', 'password_hash']);
})->with(['login.test', 'login.test@example.com']);

it('rejects incorrect passwords', function () {
    $this->postJson('/api/login', ['username' => 'login.test', 'password' => 'wrong'])->assertUnauthorized();
});

it('changes the database password only after checking the current password', function () {
    $this->postJson('/api/password', ['username' => 'login.test', 'password' => 'wrong', 'new_password' => 'ReplacementPassword123!'])->assertUnauthorized();
    $this->postJson('/api/password', ['username' => 'login.test', 'password' => 'test-password', 'new_password' => 'ReplacementPassword123!'])->assertOk();
    $this->postJson('/api/login', ['username' => 'login.test', 'password' => 'test-password'])->assertUnauthorized();
    $this->postJson('/api/login', ['username' => 'login.test', 'password' => 'ReplacementPassword123!'])->assertOk();
});

it('rejects inactive accounts', function () {
    DB::table('staff_users')->where('id', 'login-test')->update(['is_active' => false]);
    $this->postJson('/api/login', ['username' => 'login.test', 'password' => 'test-password'])->assertForbidden();
});

it('authenticates database super admin accounts', function () {
    DB::table('staff_users')->where('id', 'login-test')->update(['role' => 'SUPER_ADMIN']);
    $this->postJson('/api/login', ['username' => 'login.test', 'password' => 'test-password'])->assertOk()->assertJsonPath('user.role', 'SUPER_ADMIN');
});

it('updates super admin email and password and revokes the old login token', function () {
    DB::table('staff_users')->where('id', 'login-test')->update(['role' => 'SUPER_ADMIN']);
    $token = $this->postJson('/api/login', ['username' => 'login.test', 'password' => 'test-password'])->json('token');
    $headers = ['Authorization' => 'Bearer '.$token];
    $data = ['fullName' => 'Updated Super Admin', 'username' => 'login.test', 'email' => 'updated@example.com',
        'current_password' => 'wrong', 'new_password' => 'NewSecretPassword123!', 'new_password_confirmation' => 'NewSecretPassword123!'];
    $this->patchJson('/api/profile', $data, $headers)->assertUnprocessable();
    $data['current_password'] = 'test-password';
    $response = $this->patchJson('/api/profile', $data, $headers)->assertOk()->assertJsonPath('user.email', 'updated@example.com');
    $this->postJson('/api/login', ['username' => 'login.test', 'password' => 'test-password'])->assertUnauthorized();
    $this->postJson('/api/login', ['username' => 'updated@example.com', 'password' => 'NewSecretPassword123!'])->assertOk();
    $this->getJson('/api/admins', $headers)->assertUnauthorized();
    $this->getJson('/api/admins', ['Authorization' => 'Bearer '.$response->json('token')])->assertOk();
});

it('prevents regular admins from updating the super admin profile', function () {
    $token = $this->postJson('/api/login', ['username' => 'login.test', 'password' => 'test-password'])->json('token');
    $this->patchJson('/api/profile', [], ['Authorization' => 'Bearer '.$token])->assertForbidden();
});

it('confirms the signed-in super admin password without bypassing login verification',function(){
    DB::table('staff_users')->where('id','login-test')->update(['role'=>'SUPER_ADMIN']);
    $user=DB::table('staff_users')->where('id','login-test')->first();
    $headers=['Authorization'=>'Bearer '.\App\Support\StaffAuth::token($user)];
    config(['services.turnstile.enabled'=>true,'services.turnstile.site_key'=>'public','services.turnstile.secret_key'=>'secret']);
    $this->postJson('/api/password/confirm',['password'=>'test-password'])->assertUnauthorized();
    $this->postJson('/api/password/confirm',['password'=>'wrong'],$headers)->assertUnprocessable();
    $this->postJson('/api/password/confirm',['password'=>'test-password'],$headers)->assertOk()->assertJsonPath('confirmed',true)->assertJsonMissingPath('token');
    $this->postJson('/api/login',['username'=>'login.test','password'=>'test-password'])->assertUnprocessable();
});

it('rejects regular admin sessions at super admin password confirmation',function(){
    $user=DB::table('staff_users')->where('id','login-test')->first();
    $this->postJson('/api/password/confirm',['password'=>'test-password'],['Authorization'=>'Bearer '.\App\Support\StaffAuth::token($user)])->assertForbidden();
});
