<?php

use App\Support\VisitorAccess;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Queue;

it('requires an unexpired verified token for the submitted email', function () {
    $this->postJson('/api/history/session', ['email'=>'visitor@gmail.com'])->assertUnauthorized();
    $headers=['X-Visitor-Token'=>VisitorAccess::token('visitor@gmail.com')];
    $this->postJson('/api/history/session', ['email'=>'visitor@gmail.com'], $headers)->assertOk();
    $this->postJson('/api/history/session', ['email'=>'other@gmail.com'], $headers)->assertForbidden();
    $expired=Crypt::encryptString(json_encode(['purpose'=>'visitor','email'=>'visitor@gmail.com','expires'=>time()-1]));
    $this->postJson('/api/history/session', ['email'=>'visitor@gmail.com'], ['X-Visitor-Token'=>$expired])->assertUnauthorized();
});

it('queues Gmail codes and prevents immediate resend', function () {
    Cache::flush();
    Queue::fake();
    config(['mail.default'=>'smtp','mail.mailers.smtp.username'=>'test','mail.mailers.smtp.password'=>'test']);
    $this->postJson('/api/history/code', ['email'=>'verify@gmail.com'])->assertOk()->assertJsonPath('expiresIn',300);
    Queue::assertPushed(\App\Jobs\SendVerificationCode::class, fn($job)=>$job->email==='verify@gmail.com' && preg_match('/^\d{6}$/',$job->code));
    $this->postJson('/api/history/code', ['email'=>'verify@gmail.com'])->assertStatus(429);
    Cache::flush();
});

it('requires a visitor Turnstile check before queuing Gmail codes',function(){
    Cache::flush(); Queue::fake();
    config(['services.turnstile.enabled'=>true,'services.turnstile.site_key'=>'public','services.turnstile.secret_key'=>'private','services.turnstile.hostnames'=>['campus.example'],'mail.default'=>'smtp','mail.mailers.smtp.username'=>'test','mail.mailers.smtp.password'=>'test']);
    \Illuminate\Support\Facades\Http::fake(['challenges.cloudflare.com/*'=>\Illuminate\Support\Facades\Http::response(['success'=>true,'action'=>'visitor-code','hostname'=>'campus.example'])]);
    $this->postJson('/api/history/code',['email'=>'secure@gmail.com'])->assertUnprocessable();
    Queue::assertNothingPushed();
    \Illuminate\Support\Facades\Http::assertNothingSent();
    $this->postJson('/api/history/code',['email'=>'secure@gmail.com','turnstileToken'=>'visitor-token'])->assertOk();
    Queue::assertPushed(\App\Jobs\SendVerificationCode::class);
    Cache::flush();
});

it('rejects failed expired or mismatched visitor security checks',function($check){
    Cache::flush(); Queue::fake();
    config(['services.turnstile.enabled'=>true,'services.turnstile.site_key'=>'public','services.turnstile.secret_key'=>'private','services.turnstile.hostnames'=>['campus.example']]);
    \Illuminate\Support\Facades\Http::fake(['challenges.cloudflare.com/*'=>\Illuminate\Support\Facades\Http::response($check)]);
    $this->postJson('/api/history/code',['email'=>'secure@gmail.com','turnstileToken'=>'bad-token'])->assertUnprocessable();
    Queue::assertNothingPushed();
})->with([
    [['success'=>false,'error-codes'=>['timeout-or-duplicate']]],
    [['success'=>true,'action'=>'staff-login','hostname'=>'campus.example']],
    [['success'=>true,'action'=>'visitor-code','hostname'=>'wrong.example']],
]);

it('does not send codes when visitor verification is unavailable',function(){
    Queue::fake();
    config(['services.turnstile.enabled'=>true,'services.turnstile.site_key'=>'public','services.turnstile.secret_key'=>null]);
    $this->postJson('/api/history/code',['email'=>'secure@gmail.com','turnstileToken'=>'token'])->assertStatus(503);
    Queue::assertNothingPushed();
});
