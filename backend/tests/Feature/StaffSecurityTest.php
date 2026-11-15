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
