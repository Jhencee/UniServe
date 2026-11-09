<?php
use App\Support\StaffAuth;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;
beforeEach(function(){
    Schema::create('staff_users',function(Blueprint $t){$t->string('id')->primary();$t->string('full_name');$t->string('username')->nullable();$t->string('email')->nullable();$t->string('role');$t->string('password_hash');$t->boolean('is_active');$t->boolean('confidential_access');$t->timestamps();});
    (require database_path('migrations/2026_10_13_000005_confidential_access.php'))->up();
    (require database_path('migrations/2026_10_12_000004_audit_and_notifications.php'))->up();
    foreach(['owner','other','head','super','blocked'] as $id) DB::table('staff_users')->insert(['id'=>$id,'username'=>$id,'full_name'=>$id,'role'=>$id==='super'?'SUPER_ADMIN':'ADMIN','password_hash'=>Hash::make('FixturePassword123'),'is_active'=>true,'confidential_access'=>$id!=='blocked','confidential_approver'=>$id==='head']);
    DB::table('confidential_cases')->insert(['id'=>'case1','code'=>'OSS-001','assigned_admin_id'=>'owner','created_at'=>now(),'updated_at'=>now()]);
});
afterEach(function(){foreach(['confidential_requests','confidential_cases','notification_outbox','system_audit','staff_users'] as $table)Schema::dropIfExists($table);});
function confHeaders($id){return ['Authorization'=>'Bearer '.StaffAuth::token(DB::table('staff_users')->where('id',$id)->first())];}
it('notifies only the requester about active approvals and removes expired or revoked approvals',function(){
 $id=$this->postJson('/api/confidential/requests',['caseId'=>'case1','scope'=>'view','reason'=>'Case review'],confHeaders('other'))->assertCreated()->json('id');
 $this->getJson('/api/confidential/approvals',confHeaders('other'))->assertOk()->assertJsonCount(0,'approvals');
 $this->patchJson('/api/confidential/requests/'.$id,['decision'=>'Approved','minutes'=>30],confHeaders('head'))->assertOk();
 $this->getJson('/api/confidential/approvals',confHeaders('other'))->assertOk()->assertJsonCount(1,'approvals')->assertJsonPath('approvals.0.id',$id)->assertJsonPath('approvals.0.code','OSS-001');
 foreach(['owner','head','blocked'] as $user)$this->getJson('/api/confidential/approvals',confHeaders($user))->assertOk()->assertJsonCount(0,'approvals');
 $this->getJson('/api/confidential/approvals')->assertUnauthorized();
 $this->getJson('/api/confidential/approvals',confHeaders('super'))->assertForbidden();
 DB::table('confidential_requests')->where('id',$id)->update(['expires_at'=>now()->subMinute()]);
 $this->getJson('/api/confidential/approvals',confHeaders('other'))->assertJsonCount(0,'approvals');
 DB::table('confidential_requests')->where('id',$id)->update(['expires_at'=>now()->addMinutes(30),'status'=>'Revoked']);
 $this->getJson('/api/confidential/approvals',confHeaders('other'))->assertJsonCount(0,'approvals');
});

it('authorizes staff approval channels only for the owning Admin',function(){
 config(['broadcasting.connections.reverb.key'=>'fixture','broadcasting.connections.reverb.secret'=>'fixture-secret']);
 $data=['socket_id'=>'123.456','channel_name'=>'private-admin-other'];
 $this->postJson('/api/realtime/auth',$data,confHeaders('other'))->assertOk();
 foreach(['owner','head','super'] as $user)$this->postJson('/api/realtime/auth',$data,confHeaders($user))->assertForbidden();
});
it('shows pending access notifications only to Head Admin and removes reviewed requests',function(){
 $id=$this->postJson('/api/confidential/requests',['caseId'=>'case1','scope'=>'view','reason'=>'Case review'],confHeaders('other'))->assertCreated()->json('id');
 $this->getJson('/api/confidential/notifications')->assertUnauthorized();
 foreach(['owner','other','blocked','super'] as $user)$this->getJson('/api/confidential/notifications',confHeaders($user))->assertForbidden();
 $this->getJson('/api/confidential/notifications',confHeaders('head'))->assertOk()->assertJsonCount(1,'requests')->assertJsonPath('requests.0.id',$id)->assertJsonPath('requests.0.requester_name','other')->assertJsonPath('requests.0.code','OSS-001');
 $this->patchJson('/api/confidential/requests/'.$id,['decision'=>'Denied','minutes'=>30],confHeaders('head'))->assertOk();
 $this->getJson('/api/confidential/notifications',confHeaders('head'))->assertOk()->assertJsonCount(0,'requests');
});

it('restricts the access notification realtime channel to Head Admin',function(){
 config(['broadcasting.connections.reverb.key'=>'fixture','broadcasting.connections.reverb.secret'=>'fixture-secret']);
 $data=['socket_id'=>'123.456','channel_name'=>'private-head-admin'];
 foreach(['owner','other','blocked','super'] as $user)$this->postJson('/api/realtime/auth',$data,confHeaders($user))->assertForbidden();
 $this->postJson('/api/realtime/auth',$data,confHeaders('head'))->assertOk();
});
it('records approval expiry once and keeps readable case references in case history',function(){
 DB::table('confidential_cases')->insert(['id'=>'expiry-case','code'=>'OSS-EXPIRY','assigned_admin_id'=>'owner','created_at'=>now(),'updated_at'=>now()]);
 DB::table('confidential_requests')->insert(['id'=>(string)\Illuminate\Support\Str::uuid(),'case_id'=>'expiry-case','requester_id'=>'other','scope'=>'view','reason'=>'Case review','status'=>'Approved','expires_at'=>now()->subMinute(),'created_at'=>now(),'updated_at'=>now()]);
 $this->artisan('confidential:expire')->assertSuccessful();$this->artisan('confidential:expire')->assertSuccessful();
 expect(DB::table('system_audit')->where('action','Temporary access expired')->count())->toBe(1);
 expect(DB::table('confidential_requests')->value('status'))->toBe('Expired');
 $this->getJson('/api/confidential/cases/expiry-case/history',confHeaders('owner'))->assertOk()->assertJsonCount(1,'events');
});
function confUnlock($scope='view'){return ['password'=>'FixturePassword123','reason'=>'Review supporting documents','scope'=>$scope];}
it('allows assigned staff to view but requires separate print approval',function(){
    $this->postJson('/api/confidential/cases/case1/unlock',confUnlock(),confHeaders('owner'))->assertOk();
    $this->postJson('/api/confidential/cases/case1/unlock',confUnlock('print'),confHeaders('owner'))->assertForbidden();
    $this->postJson('/api/confidential/cases/case1/unlock',confUnlock(),confHeaders('other'))->assertForbidden();
    $this->postJson('/api/confidential/cases/case1/unlock',confUnlock(),confHeaders('super'))->assertForbidden();
    $this->postJson('/api/confidential/cases/case1/unlock',confUnlock(),confHeaders('blocked'))->assertForbidden();
});
it('requires password confirmation even for the assigned admin',function(){
    $this->postJson('/api/confidential/cases/case1/unlock',confUnlock()+[],confHeaders('owner'))->assertOk();
    $data=confUnlock();$data['password']='wrong';
    $this->postJson('/api/confidential/cases/case1/unlock',$data,confHeaders('owner'))->assertUnprocessable();
});
it('supports approval, expiry and immediate revocation checks',function(){
    $id=$this->postJson('/api/confidential/requests',['caseId'=>'case1','scope'=>'print','reason'=>'Assist with case review'],confHeaders('other'))->assertCreated()->json('id');
    $decision=['decision'=>'Approved','minutes'=>30,'note'=>'Approved for official review'];
    $this->patchJson('/api/confidential/requests/'.$id,$decision,confHeaders('other'))->assertForbidden();
    $this->patchJson('/api/confidential/requests/'.$id,$decision,confHeaders('head'))->assertOk();
    $this->postJson('/api/confidential/cases/case1/unlock',confUnlock('print'),confHeaders('other'))->assertOk();
    $this->getJson('/api/confidential/cases/case1/status',confHeaders('other'))->assertOk();
    DB::table('confidential_requests')->where('id',$id)->update(['expires_at'=>now()->subMinute()]);
    $this->getJson('/api/confidential/cases/case1/status',confHeaders('other'))->assertForbidden();
    DB::table('confidential_requests')->where('id',$id)->update(['expires_at'=>now()->addMinutes(20)]);
    $decision['decision']='Revoked';
    $this->patchJson('/api/confidential/requests/'.$id,$decision,confHeaders('head'))->assertOk();
    $this->postJson('/api/confidential/cases/case1/unlock',confUnlock(),confHeaders('other'))->assertForbidden();
    expect(DB::table('system_audit')->count())->toBeGreaterThan(2);
});
it('prevents self approval and restricts assignment to approvers',function(){
    $id=$this->postJson('/api/confidential/requests',['caseId'=>'case1','scope'=>'view','reason'=>'Review case assignment'],confHeaders('head'))->assertCreated()->json('id');
    $this->patchJson('/api/confidential/requests/'.$id,['decision'=>'Approved','minutes'=>30,'note'=>'Approved for review'],confHeaders('head'))->assertForbidden();
    $this->patchJson('/api/confidential/cases/case1',['adminId'=>'other'],confHeaders('owner'))->assertForbidden();
    $this->patchJson('/api/confidential/cases/case1',['adminId'=>'other'],confHeaders('head'))->assertOk();
    $this->getJson('/api/confidential/cases/case1/status',confHeaders('owner'))->assertForbidden();
});
it('limits request visibility and rejects duplicate pending requests',function(){
    $data=['caseId'=>'case1','scope'=>'view','reason'=>'Review supporting documents'];
    $this->postJson('/api/confidential/requests',$data,confHeaders('other'))->assertCreated();
    $this->postJson('/api/confidential/requests',$data,confHeaders('other'))->assertConflict();
    $this->getJson('/api/confidential',confHeaders('owner'))->assertJsonCount(0,'requests');
    $this->getJson('/api/confidential',confHeaders('head'))->assertJsonCount(1,'requests');
    $this->getJson('/api/confidential')->assertUnauthorized();
});
it('lets only Super Admin designate approvers and revokes approvals when permission is removed',function(){
    $this->patchJson('/api/admins/other',['confidentialApprover'=>true],confHeaders('owner'))->assertForbidden();
    $this->patchJson('/api/admins/other',['confidentialApprover'=>true],confHeaders('super'))->assertOk()->assertJsonPath('user.confidentialApprover',true)->assertJsonPath('user.confidentialAccess',true);
    $id=$this->postJson('/api/confidential/requests',['caseId'=>'case1','scope'=>'view','reason'=>'Assist with case review'],confHeaders('owner'))->assertCreated()->json('id');
    $this->patchJson('/api/confidential/requests/'.$id,['decision'=>'Approved','minutes'=>30,'note'=>'Approved for case review'],confHeaders('other'))->assertOk();
    $this->patchJson('/api/admins/other',['confidentialApprover'=>false],confHeaders('super'))->assertOk();
    expect(DB::table('confidential_requests')->where('id',$id)->value('status'))->toBe('Revoked');
});
it('blocks default-password accounts until rotation and revokes the old token',function(){
 DB::table('staff_users')->where('id','owner')->update(['password_hash'=>Hash::make('1234')]);$old=confHeaders('owner');
 $this->getJson('/api/confidential',$old)->assertForbidden();
 $this->postJson('/api/password',['username'=>'owner','password'=>'1234','new_password'=>'short'])->assertUnprocessable();
 $result=$this->postJson('/api/password',['username'=>'owner','password'=>'1234','new_password'=>'SecurePassword123!'])->assertOk()->json();
 $this->getJson('/api/confidential',$old)->assertUnauthorized();
 $this->getJson('/api/confidential',['Authorization'=>'Bearer '.$result['token']])->assertOk();
});
it('revokes the current staff token on logout',function(){
 $headers=confHeaders('owner');$this->postJson('/api/logout',[],$headers)->assertOk();
 $this->getJson('/api/confidential',$headers)->assertUnauthorized();
});

it('lets a regular Admin request access without exposing the record before approval',function(){
 $this->postJson('/api/confidential/requests',['caseId'=>'case1','scope'=>'view','reason'=>'Review this case for follow-up'],confHeaders('blocked'))->assertCreated();
 $this->getJson('/api/confidential',confHeaders('head'))->assertOk()->assertJsonPath('requests.0.requester_name','blocked');
 $this->postJson('/api/confidential/cases/case1/unlock',confUnlock(),confHeaders('blocked'))->assertForbidden();
});

it('lets Head Admin unlock view and print using a password without a request',function(){
 $this->getJson('/api/confidential/cases/case1/status?scope=print',confHeaders('head'))->assertOk();
 $this->postJson('/api/confidential/cases/case1/unlock',array_merge(confUnlock(),['password'=>'wrong']),confHeaders('head'))->assertUnprocessable();
 $this->postJson('/api/confidential/cases/case1/unlock',confUnlock('print'),confHeaders('head'))->assertOk();
 expect(DB::table('confidential_requests')->count())->toBe(0);
});
it('lists all active Admins and permits case assignment to a regular Admin',function(){
 $list=$this->getJson('/api/confidential',confHeaders('head'))->assertOk()->json('admins');expect(array_column($list,'id'))->toContain('blocked');
 $this->patchJson('/api/confidential/cases/case1',['adminId'=>'blocked'],confHeaders('head'))->assertOk();
 $this->postJson('/api/confidential/cases/case1/unlock',confUnlock(),confHeaders('blocked'))->assertOk();
 $this->postJson('/api/confidential/cases/case1/unlock',confUnlock('print'),confHeaders('blocked'))->assertForbidden();
});
it('allows Head Admin to approve and edit a decision without a note and invalidates unlocks',function(){
 $id=$this->postJson('/api/confidential/requests',['caseId'=>'case1','scope'=>'print','reason'=>'Prepare an authorized report'],confHeaders('blocked'))->assertCreated()->json('id');
 $this->patchJson('/api/confidential/requests/'.$id,['decision'=>'Approved','minutes'=>30],confHeaders('head'))->assertOk();
 $this->postJson('/api/confidential/cases/case1/unlock',confUnlock('print'),confHeaders('blocked'))->assertOk();
 $this->patchJson('/api/confidential/requests/'.$id,['decision'=>'Denied','minutes'=>30],confHeaders('head'))->assertOk();
 expect(\Illuminate\Support\Facades\Cache::get('conf-unlock:blocked:case1:print'))->toBeNull();
 $this->postJson('/api/confidential/cases/case1/unlock',confUnlock(),confHeaders('blocked'))->assertForbidden();
 $this->patchJson('/api/confidential/requests/'.$id,['decision'=>'Approved','minutes'=>60],confHeaders('head'))->assertOk();
});

it('lets Head Admin grant print permission and supersedes duplicate pending decisions',function(){
 $one=$this->postJson('/api/confidential/requests',['caseId'=>'case1','scope'=>'view','reason'=>'Case review'],confHeaders('blocked'))->assertCreated()->json('id');
 $two=$this->postJson('/api/confidential/requests',['caseId'=>'case1','scope'=>'print','reason'=>'Prepare report'],confHeaders('blocked'))->assertCreated()->json('id');
 $this->patchJson('/api/confidential/requests/'.$one,['decision'=>'Approved','minutes'=>30,'scope'=>'print'],confHeaders('head'))->assertOk();
 expect(DB::table('confidential_requests')->where('id',$two)->value('status'))->toBe('Revoked');
 $this->postJson('/api/confidential/cases/case1/unlock',confUnlock('print'),confHeaders('blocked'))->assertOk();
});

it('requires the Head Admin password to unlock combined confidential reports',function(){
 $path='/api/confidential/cases/rpt:all/unlock';
 $this->postJson($path,confUnlock('print'),confHeaders('owner'))->assertForbidden();
 $data=confUnlock('print');$data['password']='wrong';
 $this->postJson($path,$data,confHeaders('head'))->assertUnprocessable();
 $this->postJson($path,confUnlock('print'),confHeaders('head'))->assertOk()->assertJsonStructure(['expiresAt']);
 expect(DB::table('system_audit')->where('action','Unlocked confidential report with password')->count())->toBe(1);
});
