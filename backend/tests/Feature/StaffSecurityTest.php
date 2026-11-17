<?php
use App\Support\{StaffAuth, StaffMfa};
use Illuminate\Support\Facades\{DB, Schema, Cache, Hash, Mail};

beforeEach(function(){
    if(DB::getDriverName()!=='sqlite'||DB::connection()->getDatabaseName()!==':memory:')throw new RuntimeException('Security tests require SQLite memory.');
    $this->artisan('migrate:fresh',['--force'=>true])->assertSuccessful();Cache::flush();
    config(['services.turnstile.enabled'=>false]);
    foreach(['security-super'=>'SUPER_ADMIN','security-admin'=>'ADMIN'] as $id=>$role)DB::table('staff_users')->insert(['id'=>$id,'username'=>$id,'email'=>$id.'@example.com','full_name'=>$id,'role'=>$role,'password_hash'=>Hash::make('SecurityFixture42!'),'is_active'=>true]);
});
afterEach(function(){Schema::dropAllTables();});
function securityHeaders($id='security-super'){return ['Authorization'=>'Bearer '.StaffAuth::token(DB::table('staff_users')->where('id',$id)->first())];}
function securityConfirm($headers){test()->postJson('/api/password/confirm',['password'=>'SecurityFixture42!'],$headers)->assertOk();}

it('exposes only an authenticated change marker without auditing polling or extending idle sessions',function(){
    $this->getJson('/api/realtime/changes')->assertUnauthorized();
    $headers=securityHeaders('security-admin');
    $first=$this->getJson('/api/realtime/changes',$headers)->assertOk()->assertHeader('Cache-Control','no-store, private');
    expect(array_keys($first->json()))->toBe(['version']);
    $this->getJson('/api/realtime/changes',$headers)->assertJsonPath('version',$first->json('version'));
    expect(DB::table('system_audit')->count())->toBe(0);
    \App\Support\SystemAudit::record(null,'System','Fixture change');
    expect($this->getJson('/api/realtime/changes',$headers)->json('version'))->not->toBe($first->json('version'));
    DB::table('shared_system_settings')->where('id',1)->update(['payload'=>json_encode(['sessionTimeout'=>5])]);
    $this->travel(6)->minutes();
    $this->getJson('/api/realtime/changes',$headers)->assertUnauthorized();
});

it('allows Admins to manage only their own MFA and sessions without Super Admin privileges',function(){
    $admin=securityHeaders('security-admin');$other=securityHeaders('security-admin');$super=securityHeaders();
    $this->getJson('/api/security/mfa',$admin)->assertOk()->assertJsonPath('enabled',false);
    $this->postJson('/api/security/mfa',['action'=>'setup'],$admin)->assertStatus(428);
    securityConfirm($admin);
    $this->deleteJson('/api/security/sessions',['id'=>hash('sha256',substr($super['Authorization'],7))],$admin)->assertNotFound();
    $listed=$this->getJson('/api/security/sessions',$admin)->assertOk()->json('sessions');
    expect(collect($listed)->pluck('id')->all())->not->toContain(hash('sha256',substr($super['Authorization'],7)));
    $this->deleteJson('/api/security/sessions',['id'=>hash('sha256',substr($other['Authorization'],7))],$admin)->assertOk();
    $this->getJson('/api/security/sessions',$other)->assertUnauthorized();
    $this->getJson('/api/admins',$admin)->assertForbidden();
    $this->postJson('/api/system/test-email',[],$admin)->assertForbidden();
    $secret=$this->postJson('/api/security/mfa',['action'=>'setup'],$admin)->assertOk()->json('secret');
    $enabled=$this->postJson('/api/security/mfa',['action'=>'enable','code'=>StaffMfa::code($secret,now()->timestamp)],$admin)->assertOk();
    $this->postJson('/api/login',['username'=>'security-admin','password'=>'SecurityFixture42!'])->assertUnprocessable()->assertJsonPath('mfaRequired',true);
    $fresh=['Authorization'=>'Bearer '.$enabled->json('token')];securityConfirm($fresh);
    $this->postJson('/api/security/mfa',['action'=>'disable','code'=>$enabled->json('recoveryCodes.0')],$fresh)->assertOk();
    expect(DB::table('staff_users')->where('id','security-super')->value('mfa_secret'))->toBeNull();
});

it('backs up the old staff schema before applying only the MFA migration and safely reruns it',function(){
    \Illuminate\Support\Facades\Storage::fake('local');
    $migration='2026_11_13_170000_add_staff_mfa';
    Schema::table('staff_users',fn($table)=>$table->dropColumn(['mfa_secret','mfa_version','mfa_recovery_codes','mfa_last_step']));
    DB::table('migrations')->where('migration',$migration)->delete();
    $originalColumns=Schema::getColumnListing('staff_users');
    $before=DB::table('staff_users')->orderBy('id')->get($originalColumns)->toJson();
    $this->artisan('backup:create')->assertSuccessful();
    expect(\Illuminate\Support\Facades\Storage::disk('local')->files('activity-backups'))->not->toBeEmpty();
    $args=['--force'=>true,'--path'=>'database/migrations/'.$migration.'.php'];
    $this->artisan('migrate',$args)->assertSuccessful();
    $this->artisan('migrate',$args)->assertSuccessful();
    expect(Schema::hasColumns('staff_users',['mfa_secret','mfa_version','mfa_recovery_codes','mfa_last_step']))->toBeTrue();
    expect(DB::table('staff_users')->orderBy('id')->get($originalColumns)->toJson())->toBe($before);
    expect(DB::table('migrations')->where('migration',$migration)->count())->toBe(1);
});

it('does not turn expired-session polling into visitor access-denied events',function(){
    $headers=securityHeaders();
    $this->travel(61)->minutes();
    foreach(['/api/admins','/api/security/sessions','/api/confidential/approvals'] as $path)$this->getJson($path,$headers)->assertUnauthorized();
    $this->postJson('/api/session/activity',[],$headers)->assertUnauthorized();
    $this->postJson('/api/realtime/auth',['socket_id'=>'123.456','channel_name'=>'private-office'],$headers)->assertUnauthorized();
    expect(DB::table('system_audit')->count())->toBe(0);
    $this->patchJson('/api/admins/security-admin',['active'=>false],$headers)->assertUnauthorized();
    $row=DB::table('system_audit')->sole();
    expect($row->action)->toBe('Request authentication required');
    expect($row->actor_name)->toBe('Unauthenticated request');
    expect(DB::table('staff_users')->where('id','security-admin')->value('is_active'))->toBe(1);
});

it('records real permission denials with the authenticated actor and HTTP evidence',function(){
    $this->getJson('/api/admins',securityHeaders('security-admin'))->assertForbidden();
    $row=DB::table('system_audit')->sole();
    expect($row->action)->toBe('Access denied');
    expect($row->actor_id)->toBe('security-admin');
    expect($row->category)->toBe('Accounts');
    $evidence=collect(json_decode($row->changes,true))->pluck('to','field');
    expect($evidence['HTTP status'])->toBe('403');
    expect($evidence['Request method'])->toBe('GET');
});

it('keeps failed sign-ins in the audit without claiming a verified identity',function(){
    $this->postJson('/api/login',['username'=>'security-super','password'=>'wrong'])->assertUnauthorized();
    $row=DB::table('system_audit')->sole();
    expect($row->action)->toBe('Sign-in failed');
    expect($row->actor_name)->toBe('Unknown staff');
    expect($row->actor_id)->toBeNull();
});

it('applies the same audit rules to returned error responses and thrown errors',function(){
    \Illuminate\Support\Facades\Route::middleware('api')->get('/api/audit-fixture/unauthorized',fn()=>response()->json(['message'=>'Sign in'],401));
    \Illuminate\Support\Facades\Route::middleware('api')->post('/api/audit-fixture/denied',fn()=>response()->json(['message'=>'Denied'],403));
    $this->getJson('/api/audit-fixture/unauthorized')->assertUnauthorized();
    expect(DB::table('system_audit')->count())->toBe(0);
    $this->postJson('/api/audit-fixture/denied')->assertForbidden();
    $row=DB::table('system_audit')->sole();
    expect($row->action)->toBe('Access denied');
    expect($row->actor_name)->toBe('Unauthenticated request');
});

it('enforces idle timeout on the API without allowing polling to extend it',function(){
    DB::table('shared_system_settings')->where('id',1)->update(['payload'=>json_encode(['sessionTimeout'=>5])]);
    $headers=securityHeaders();$this->travel(4)->minutes();$this->getJson('/api/security/sessions',$headers)->assertOk();
    $this->travel(2)->minutes();$this->getJson('/api/security/sessions',$headers)->assertUnauthorized();
    $this->postJson('/api/session/activity',[],$headers)->assertUnauthorized();
});
it('keeps genuinely active sessions alive within the absolute token expiry',function(){
    DB::table('shared_system_settings')->where('id',1)->update(['payload'=>json_encode(['sessionTimeout'=>5])]);
    $headers=securityHeaders();$this->travel(4)->minutes();$this->postJson('/api/session/activity',[],$headers)->assertOk();
    $this->travel(4)->minutes();$this->getJson('/api/security/sessions',$headers)->assertOk();
    $this->travel(53)->minutes();$this->postJson('/api/session/activity',[],$headers)->assertUnauthorized();
});
it('requires token-bound expiring confirmation for account changes and restore',function(){
    $headers=securityHeaders();$target='/api/admins/security-admin';
    $this->patchJson($target,['active'=>false],$headers)->assertStatus(428);
    $this->postJson('/api/backup/restore',[],$headers)->assertStatus(428);
    securityConfirm($headers);
    $this->patchJson($target,['active'=>false],securityHeaders())->assertStatus(428);
    $this->patchJson($target,['active'=>false],$headers)->assertOk();
    $this->travel(6)->minutes();$this->patchJson($target,['active'=>true],$headers)->assertStatus(428);
});
it('revokes only sessions belonging to the signed-in Super Admin',function(){
    $one=securityHeaders();$two=securityHeaders();$other=securityHeaders('security-admin');securityConfirm($one);
    $this->deleteJson('/api/security/sessions',['id'=>hash('sha256',substr($other['Authorization'],7))],$one)->assertNotFound();
    $this->deleteJson('/api/security/sessions',['id'=>hash('sha256',substr($two['Authorization'],7))],$one)->assertOk();
    $this->getJson('/api/security/sessions',$two)->assertUnauthorized();$this->getJson('/api/security/sessions',$one)->assertOk();
});
it('rejects inconsistent appointment timing before saving settings',function(){
    $headers=securityHeaders();$revision=$this->getJson('/api/settings')->json('revision');
    $this->putJson('/api/settings',['revision'=>$revision,'settings'=>['maintenanceMode'=>false,'sessionTimeout'=>30,'gracePeriodMinutes'=>30,'noShowThresholdMinutes'=>15]],$headers)->assertUnprocessable();
});
it('sends test email only to the signed-in account and never claims inbox delivery',function(){
    Mail::shouldReceive('raw')->once()->withArgs(function($body,$callback){
        $message=new \Illuminate\Mail\Message(new \Symfony\Component\Mime\Email());$callback($message);
        expect($message->getSymfonyMessage()->getTo()[0]->getAddress())->toBe('security-super@example.com');
        expect($body)->toContain('Reference:');return true;
    });config(['mail.default'=>'smtp']);$headers=securityHeaders();
    $this->postJson('/api/system/test-email',[],$headers)->assertStatus(428);securityConfirm($headers);
    $this->postJson('/api/system/test-email',['to'=>'untrusted@example.com'],$headers)->assertOk()->assertJsonPath('message','Test submitted to the mail transport. Confirm receipt in your inbox.');
    expect(Cache::get('system:email-test')['reference'])->not->toBeEmpty();
});
it('matches the RFC 6238 SHA1 test vectors',function(){
    $secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    foreach([59=>'94287082',1111111109=>'07081804',1111111111=>'14050471',1234567890=>'89005924',2000000000=>'69279037',20000000000=>'65353130'] as $time=>$code)expect(StaffMfa::code($secret,$time,8))->toBe($code);
});
it('requires verified MFA enrollment and blocks replay while supporting one-use recovery codes',function(){
    $headers=securityHeaders();$this->postJson('/api/security/mfa',['action'=>'setup'],$headers)->assertStatus(428);securityConfirm($headers);
    $secret=$this->postJson('/api/security/mfa',['action'=>'setup'],$headers)->assertOk()->json('secret');
    $this->postJson('/api/security/mfa',['action'=>'enable','code'=>'invalid'],$headers)->assertUnprocessable();
    $code=StaffMfa::code($secret,now()->timestamp);
    $codes=$this->postJson('/api/security/mfa',['action'=>'enable','code'=>$code],$headers)->assertOk()->json('recoveryCodes');
    expect(DB::table('staff_users')->where('id','security-super')->value('mfa_secret'))->not->toBe($secret);
    $login=['username'=>'security-super','password'=>'SecurityFixture42!'];
    $this->postJson('/api/login',$login)->assertUnprocessable()->assertJsonPath('mfaRequired',true)->assertJsonMissingPath('token');
    $this->postJson('/api/login',$login+['mfaCode'=>$code])->assertUnprocessable();
    $this->travel(31)->seconds();$next=StaffMfa::code($secret,now()->timestamp);
    $this->postJson('/api/login',$login+['mfaCode'=>$next])->assertOk();
    $this->postJson('/api/login',$login+['mfaCode'=>$next])->assertUnprocessable();
    $this->postJson('/api/login',$login+['mfaCode'=>$codes[0]])->assertOk();
    $this->postJson('/api/login',$login+['mfaCode'=>$codes[0]])->assertUnprocessable();
    $this->getJson('/api/security/sessions',$headers)->assertUnauthorized();
    $fresh=$this->postJson('/api/login',$login+['mfaCode'=>$codes[1]])->assertOk()->json('token');
    $freshHeaders=['Authorization'=>'Bearer '.$fresh];securityConfirm($freshHeaders);
    $this->postJson('/api/security/mfa',['action'=>'disable','code'=>$codes[2]],$freshHeaders)->assertOk();
    $this->getJson('/api/security/sessions',$headers)->assertUnauthorized();
    $this->getJson('/api/security/sessions',$freshHeaders)->assertUnauthorized();
    $this->postJson('/api/login',$login)->assertOk();
});

it('does not log an MFA challenge as a failed login or leak authenticator secrets',function(){
    $user=DB::table('staff_users')->where('id','security-super')->first();
    DB::table('staff_users')->where('id',$user->id)->update(['mfa_secret'=>\Illuminate\Support\Facades\Crypt::encryptString('JBSWY3DPEHPK3PXP')]);
    $this->postJson('/api/login',['username'=>$user->username,'password'=>'SecurityFixture42!'])->assertUnprocessable()->assertJsonPath('mfaRequired',true);
    expect(DB::table('system_audit')->where('action','Sign-in failed')->count())->toBe(0);
    $this->getJson('/api/admins',securityHeaders())->assertOk()->assertDontSee('mfa_secret')->assertDontSee('JBSWY3DPEHPK3PXP');
});

it('reports deployment prerequisites without exposing secrets or modifying application records',function(){
    \Illuminate\Support\Facades\Storage::fake('local');
    config(['cache.default'=>'array','app.debug'=>true]);
    $count=DB::table('staff_users')->count();
    $this->artisan('system:readiness')->expectsOutputToContain('Still verify:')->assertExitCode(1);
    expect(DB::table('staff_users')->count())->toBe($count);
    expect(\Illuminate\Support\Facades\Storage::disk('local')->allFiles('readiness-probes'))->toBeEmpty();
});
