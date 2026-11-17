<?php

use App\Support\{StaffAuth, StaffMfa, TrustedDevices};
use Illuminate\Support\Facades\{Cache, Crypt, DB, Hash, Schema};

beforeEach(function(){
    if(DB::getDriverName()!=='sqlite'||DB::connection()->getDatabaseName()!==':memory:')throw new RuntimeException('Trusted-device tests require SQLite memory.');
    $this->artisan('migrate:fresh',['--force'=>true])->assertSuccessful();Cache::flush();
    config(['services.turnstile.enabled'=>false,'cors.allowed_origins'=>['https://oss.uniserve.vercel.app'],'cors.allowed_origins_patterns'=>[]]);
    foreach(['td-admin'=>'ADMIN','td-other'=>'ADMIN','td-super'=>'SUPER_ADMIN'] as $id=>$role){
        DB::table('staff_users')->insert(['id'=>$id,'username'=>$id,'email'=>$id.'@example.com','full_name'=>$id,'role'=>$role,'password_hash'=>Hash::make('TrustFixture42!'),'is_active'=>true,
            'mfa_secret'=>Crypt::encryptString('JBSWY3DPEHPK3PXP'),'mfa_version'=>'existing-enrollment','mfa_recovery_codes'=>json_encode([hash('sha256','abcdef0123456789')])]);
    }
});
afterEach(function(){$this->travelBack();Schema::dropAllTables();});

function tdCall(string $method,string $path,array $data=[],?string $cookie=null,array $server=[]){
    return test()->call($method,$path,[],$cookie?[TrustedDevices::COOKIE=>$cookie]:[],[],array_merge([
        'CONTENT_TYPE'=>'application/json','HTTP_ACCEPT'=>'application/json','HTTP_USER_AGENT'=>'FixtureBrowser/1','REMOTE_ADDR'=>'192.0.2.1','HTTPS'=>'on',
    ],$server),json_encode($data));
}
function tdInput(string $id='td-admin'):array{return ['username'=>$id.'@example.com','password'=>'TrustFixture42!'];}
function tdEnroll(string $id='td-admin'){
    return tdCall('POST','/api/login',tdInput($id)+['mfaCode'=>StaffMfa::code('JBSWY3DPEHPK3PXP',now()->timestamp),'trustDevice'=>true])->assertOk();
}
function tdCookie($response):string{return $response->getCookie(TrustedDevices::COOKIE,false)->getValue();}
function tdBearer(string $id='td-admin'):array{return ['HTTP_AUTHORIZATION'=>'Bearer '.StaffAuth::token(DB::table('staff_users')->where('id',$id)->first())];}
function tdConfirm(array $server):void{tdCall('POST','/api/password/confirm',['password'=>'TrustFixture42!'],null,$server)->assertOk();}

it('requires MFA on a new device and never grants a session or trust before verification',function(){
    tdCall('POST','/api/login',tdInput()+['trustDevice'=>true])->assertUnprocessable()->assertJsonPath('mfaRequired',true)->assertJsonPath('trustedDeviceEligible',true)->assertJsonMissingPath('token');
    tdCall('POST','/api/login',tdInput()+['mfaCode'=>'invalid','trustDevice'=>true])->assertUnprocessable()->assertJsonMissingPath('token');
    expect(DB::table('staff_trusted_devices')->count())->toBe(0);
    tdCall('GET','/api/security/sessions')->assertUnauthorized();
});

it('stores only a hash, uses a secure HttpOnly cookie, and preserves the existing enrollment',function(){
    $before=DB::table('staff_users')->where('id','td-admin')->first();$response=tdEnroll();$cookie=$response->getCookie(TrustedDevices::COOKIE,false);
    $row=DB::table('staff_trusted_devices')->sole();
    expect($cookie->isSecure())->toBeTrue();expect($cookie->isHttpOnly())->toBeTrue();expect($cookie->isPartitioned())->toBeTrue();
    expect($cookie->getSameSite())->toBe('none');expect($cookie->getDomain())->toBeNull();expect($cookie->getPath())->toBe('/');
    expect($row->token_hash)->toBe(hash('sha256',$cookie->getValue()))->not->toBe($cookie->getValue());
    expect($cookie->getExpiresTime())->toBe(now()->addDays(30)->timestamp);
    expect(DB::table('staff_users')->where('id','td-admin')->value('mfa_secret'))->toBe($before->mfa_secret);
    expect(DB::table('staff_users')->where('id','td-admin')->value('mfa_version'))->toBe($before->mfa_version);
    expect(json_encode($response->json()))->not->toContain($cookie->getValue());
    expect(DB::table('system_audit')->where('action','Signed in')->count())->toBe(1);
});

it('keeps trust after logout, rotates its proof, and never extends the 30-day deadline',function(){
    $first=tdEnroll();$cookie=tdCookie($first);$expires=DB::table('staff_trusted_devices')->sole()->expires_at;
    tdCall('POST','/api/logout',[],$cookie,['HTTP_AUTHORIZATION'=>'Bearer '.$first->json('token')])->assertOk();
    tdCall('GET','/api/security/sessions',[],$cookie,['HTTP_AUTHORIZATION'=>'Bearer '.$first->json('token')])->assertUnauthorized();
    $this->travel(2)->days();
    $next=tdCall('POST','/api/login',tdInput(),$cookie)->assertOk();expect(tdCookie($next))->not->toBe($cookie);
    expect(DB::table('staff_trusted_devices')->sole()->expires_at)->toBe($expires);
    tdCall('POST','/api/login',tdInput(),$cookie)->assertUnprocessable()->assertJsonPath('mfaRequired',true);
    tdCall('POST','/api/login',tdInput(),tdCookie($next))->assertOk();
});

it('requires a code on another device and on an expired trusted device',function(){
    $cookie=tdCookie(tdEnroll());tdCall('POST','/api/login',tdInput())->assertUnprocessable()->assertJsonPath('mfaRequired',true);
    $this->travel(30)->days();
    tdCall('POST','/api/login',tdInput(),$cookie)->assertUnprocessable()->assertJsonPath('mfaRequired',true);
    expect(DB::table('staff_trusted_devices')->sole()->revoked_at)->not->toBeNull();
});

it('does not remember an unchecked device and keeps requiring MFA on later logins',function(){
    $result=tdCall('POST','/api/login',tdInput()+['mfaCode'=>StaffMfa::code('JBSWY3DPEHPK3PXP',now()->timestamp),'trustDevice'=>false])->assertOk();
    $result->assertCookieMissing(TrustedDevices::COOKIE);expect(DB::table('staff_trusted_devices')->count())->toBe(0);
    tdCall('POST','/api/login',tdInput())->assertUnprocessable()->assertJsonPath('mfaRequired',true);
});

it('never allows Super Admin to bypass MFA or enroll a trusted device',function(){
    $adminCookie=tdCookie(tdEnroll());
    tdCall('POST','/api/login',tdInput('td-super')+['trustDevice'=>true],$adminCookie)->assertUnprocessable()->assertJsonPath('trustedDeviceEligible',false)->assertJsonMissingPath('token');
    $response=tdCall('POST','/api/login',tdInput('td-super')+['mfaCode'=>StaffMfa::code('JBSWY3DPEHPK3PXP',now()->timestamp),'trustDevice'=>true],$adminCookie)->assertOk();
    $response->assertCookieMissing(TrustedDevices::COOKIE);
    expect(DB::table('staff_trusted_devices')->where('staff_user_id','td-super')->count())->toBe(0);
    tdCall('POST','/api/login',tdInput('td-super'),$adminCookie)->assertUnprocessable()->assertJsonPath('mfaRequired',true);
    tdCall('GET','/api/security/trusted-devices',[],null,tdBearer('td-super'))->assertForbidden();
});

it('never treats a device cookie as password authentication or API authorization',function(){
    $cookie=tdCookie(tdEnroll());
    tdCall('POST','/api/login',['username'=>'td-admin@example.com','password'=>'wrong'],$cookie)->assertUnauthorized();
    tdCall('GET','/api/security/sessions',[],$cookie)->assertUnauthorized();
    tdCall('GET','/api/admins',[],$cookie)->assertUnauthorized();
    tdCall('POST','/api/login',tdInput('td-other'),$cookie)->assertUnprocessable()->assertJsonPath('mfaRequired',true);
    tdCall('POST','/api/login',tdInput(),str_repeat('a',64))->assertUnprocessable()->assertJsonPath('mfaRequired',true);
});

it('revokes trust when the browser or network changes',function(){
    $cookie=tdCookie(tdEnroll());
    tdCall('POST','/api/login',tdInput(),$cookie,['HTTP_USER_AGENT'=>'DifferentBrowser/2'])->assertUnprocessable()->assertJsonPath('mfaRequired',true);
    tdCall('POST','/api/login',tdInput(),$cookie)->assertUnprocessable()->assertJsonPath('mfaRequired',true);
    $this->travel(31)->seconds();$next=tdCookie(tdEnroll());
    tdCall('POST','/api/login',tdInput(),$next,['REMOTE_ADDR'=>'198.51.100.2'])->assertUnprocessable()->assertJsonPath('mfaRequired',true);
});

it('invalidates the presented trust after repeated incorrect password attempts',function(){
    $cookie=tdCookie(tdEnroll());
    for($i=0;$i<5;$i++)tdCall('POST','/api/login',['username'=>'td-admin@example.com','password'=>'wrong'],$cookie)->assertUnauthorized();
    expect(DB::table('staff_trusted_devices')->sole()->revoked_at)->not->toBeNull();
    tdCall('POST','/api/login',tdInput(),$cookie)->assertStatus(429);
    $this->travel(61)->seconds();tdCall('POST','/api/login',tdInput(),$cookie)->assertUnprocessable()->assertJsonPath('mfaRequired',true);
});

it('lists safe metadata and requires password confirmation to revoke only owned devices',function(){
    $cookie=tdCookie(tdEnroll());$id=DB::table('staff_trusted_devices')->sole()->id;$headers=tdBearer();
    $other=tdEnroll('td-other');$otherId=DB::table('staff_trusted_devices')->where('staff_user_id','td-other')->value('id');
    $list=tdCall('GET','/api/security/trusted-devices',[],$cookie,$headers)->assertOk()->assertJsonCount(1,'devices')->assertJsonPath('devices.0.current',true);
    expect(array_keys($list->json('devices.0')))->toBe(['id','label','createdAt','lastUsedAt','expiresAt','current']);
    tdCall('DELETE','/api/security/trusted-devices',['id'=>$id],$cookie,$headers)->assertStatus(428);
    tdConfirm($headers);
    tdCall('DELETE','/api/security/trusted-devices',['id'=>$otherId],$cookie,$headers)->assertNotFound();
    tdCall('DELETE','/api/security/trusted-devices',['id'=>$id],$cookie,$headers)->assertOk();
    tdCall('POST','/api/login',tdInput(),$cookie)->assertUnprocessable()->assertJsonPath('mfaRequired',true);
    tdCall('POST','/api/login',tdInput('td-other'),tdCookie($other))->assertOk();
});

it('supports revoking all trusted devices without revoking the active bearer session',function(){
    $first=tdEnroll();$cookie=tdCookie($first);$this->travel(31)->seconds();tdEnroll();$headers=tdBearer();tdConfirm($headers);
    tdCall('DELETE','/api/security/trusted-devices',['all'=>true],$cookie,$headers)->assertOk();
    expect(DB::table('staff_trusted_devices')->whereNull('revoked_at')->count())->toBe(0);
    tdCall('GET','/api/security/sessions',[],null,$headers)->assertOk();
});

it('invalidates all device trust after disabling MFA or an emergency MFA reset',function(){
    $cookie=tdCookie(tdEnroll());$headers=tdBearer();tdConfirm($headers);
    tdCall('POST','/api/security/mfa',['action'=>'disable','code'=>'abcdef0123456789'],null,$headers)->assertOk();
    expect(DB::table('staff_trusted_devices')->sole()->revoked_at)->not->toBeNull();
    DB::table('staff_users')->where('id','td-admin')->update(['mfa_secret'=>Crypt::encryptString('JBSWY3DPEHPK3PXP'),'mfa_last_step'=>null]);
    $this->travel(31)->seconds();tdEnroll();
    $this->artisan('security:reset-mfa',['username'=>'td-admin'])->expectsConfirmation('Disable two-step sign-in for this account? This is an audited emergency recovery action.','yes')->assertSuccessful();
    expect(DB::table('staff_trusted_devices')->whereNull('revoked_at')->count())->toBe(0);
});

it('invalidates cookies on credential or restore-epoch changes without altering enrollment',function(){
    $cookie=tdCookie(tdEnroll());$secret=DB::table('staff_users')->where('id','td-admin')->value('mfa_secret');
    Cache::forever('system:credential-epoch','restored');
    tdCall('POST','/api/login',tdInput(),$cookie)->assertUnprocessable()->assertJsonPath('mfaRequired',true);
    $this->travel(31)->seconds();$cookie=tdCookie(tdEnroll());
    DB::table('staff_users')->where('id','td-admin')->update(['password_hash'=>Hash::make('ChangedPassword42!')]);
    tdCall('POST','/api/login',['username'=>'td-admin@example.com','password'=>'ChangedPassword42!'],$cookie)->assertUnprocessable()->assertJsonPath('mfaRequired',true);
    expect(DB::table('staff_users')->where('id','td-admin')->value('mfa_secret'))->toBe($secret);
});

it('revokes stored grants through the existing authenticated password-change flow',function(){
    tdEnroll();$secret=DB::table('staff_users')->where('id','td-admin')->value('mfa_secret');$this->travel(31)->seconds();
    tdCall('POST','/api/password',tdInput()+['new_password'=>'ChangedPassword42!','mfaCode'=>StaffMfa::code('JBSWY3DPEHPK3PXP',now()->timestamp)])->assertOk();
    expect(DB::table('staff_trusted_devices')->whereNull('revoked_at')->count())->toBe(0);
    expect(DB::table('staff_users')->where('id','td-admin')->value('mfa_secret'))->toBe($secret);
});

it('revokes stored grants through the existing verified password-reset flow',function(){
    tdEnroll();$user=DB::table('staff_users')->where('id','td-admin')->first();$id=(string)\Illuminate\Support\Str::uuid();
    Cache::put('staff-reset:'.$id,['user'=>$user->id,'credential'=>hash('sha256',$user->password_hash),'hash'=>hash_hmac('sha256','123456',config('app.key')),'attempts'=>0,'expires'=>time()+300,'verified'=>true],300);
    tdCall('POST','/api/password/reset',['challengeId'=>$id,'code'=>'123456','password'=>'ChangedPassword42!','password_confirmation'=>'ChangedPassword42!'])->assertOk();
    expect(DB::table('staff_trusted_devices')->whereNull('revoked_at')->count())->toBe(0);
    expect(DB::table('staff_users')->where('id','td-admin')->value('mfa_secret'))->toBe($user->mfa_secret);
});

it('revokes trust when a Super Admin deactivates an Admin even if reactivated later',function(){
    $cookie=tdCookie(tdEnroll());$headers=tdBearer('td-super');tdConfirm($headers);
    tdCall('PATCH','/api/admins/td-admin',['active'=>false],null,$headers)->assertOk();
    expect(DB::table('staff_trusted_devices')->sole()->revoked_at)->not->toBeNull();
    tdCall('POST','/api/login',tdInput(),$cookie)->assertForbidden();
    tdCall('PATCH','/api/admins/td-admin',['active'=>true],null,$headers)->assertOk();
    tdCall('POST','/api/login',tdInput(),$cookie)->assertUnprocessable()->assertJsonPath('mfaRequired',true);
});

it('lets a confirmed Super Admin revoke compromised Admin devices and sessions',function(){
    $admin=tdEnroll();$cookie=tdCookie($admin);$headers=tdBearer('td-super');$before=DB::table('staff_users')->where('id','td-admin')->first();
    tdCall('PATCH','/api/admins/td-admin',['revokeTrustedDevices'=>true],null,$headers)->assertStatus(428);
    tdConfirm($headers);tdCall('PATCH','/api/admins/td-admin',['revokeTrustedDevices'=>true],null,$headers)->assertOk();
    expect(DB::table('staff_trusted_devices')->sole()->revoked_at)->not->toBeNull();
    tdCall('GET','/api/security/sessions',[],null,['HTTP_AUTHORIZATION'=>'Bearer '.$admin->json('token')])->assertUnauthorized();
    tdCall('POST','/api/login',tdInput(),$cookie)->assertUnprocessable()->assertJsonPath('mfaRequired',true);
    expect(DB::table('staff_users')->where('id','td-admin')->value('mfa_secret'))->toBe($before->mfa_secret);
    expect(DB::table('staff_users')->where('id','td-admin')->value('mfa_version'))->not->toBe($before->mfa_version);
});

it('never accepts or issues device trust from an unapproved origin',function(){
    $cookie=tdCookie(tdEnroll());
    tdCall('POST','/api/login',tdInput(),$cookie,['HTTP_ORIGIN'=>'https://untrusted.example'])->assertUnprocessable()->assertJsonPath('trustedDeviceEligible',false);
    $this->travel(31)->seconds();
    tdCall('POST','/api/login',tdInput()+['mfaCode'=>StaffMfa::code('JBSWY3DPEHPK3PXP',now()->timestamp),'trustDevice'=>true],null,['HTTP_ORIGIN'=>'https://untrusted.example'])->assertStatus(503);
});

it('fails safely back to MFA when the migration or cookie is missing',function(){
    Schema::drop('staff_trusted_devices');
    tdCall('POST','/api/login',tdInput())->assertUnprocessable()->assertJsonPath('trustedDeviceEligible',false);
    tdCall('POST','/api/login',tdInput()+['mfaCode'=>StaffMfa::code('JBSWY3DPEHPK3PXP',now()->timestamp)])->assertOk();
});

it('does not enable MFA or create trust for an account without an existing enrollment',function(){
    DB::table('staff_users')->where('id','td-admin')->update(['mfa_secret'=>null]);
    tdCall('POST','/api/login',tdInput()+['trustDevice'=>true])->assertOk()->assertCookieMissing(TrustedDevices::COOKIE);
    expect(DB::table('staff_trusted_devices')->count())->toBe(0);
    expect(DB::table('staff_users')->where('id','td-admin')->value('mfa_secret'))->toBeNull();
});

it('sends credentialed CORS responses only to configured frontends',function(){
    tdCall('POST','/api/login',tdInput(),null,['HTTP_ORIGIN'=>'https://oss.uniserve.vercel.app'])->assertHeader('Access-Control-Allow-Origin','https://oss.uniserve.vercel.app')->assertHeader('Access-Control-Allow-Credentials','true');
    // A single-origin CORS configuration always emits that fixed origin; it must never echo the attacker's origin.
    tdCall('POST','/api/login',tdInput(),null,['HTTP_ORIGIN'=>'https://untrusted.example'])->assertHeader('Access-Control-Allow-Origin','https://oss.uniserve.vercel.app');
});
