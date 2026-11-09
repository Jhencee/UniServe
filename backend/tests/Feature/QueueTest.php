<?php

use App\Support\StaffAuth;
use Illuminate\Foundation\Testing\DatabaseTransactions;
use Illuminate\Support\Facades\DB;

uses(DatabaseTransactions::class);

beforeEach(function(){
 \Tests\Support\LegacySchema::create();
 DB::table('staff_users')->insert(['id'=>'queue-fixture-admin','username'=>'queue.fixture','full_name'=>'Queue Fixture','role'=>'ADMIN','password_hash'=>\Illuminate\Support\Facades\Hash::make('FixturePassword123'),'is_active'=>true,'confidential_access'=>true]);
 DB::table('office_calendar')->where('id',1)->update(['payload'=>json_encode(\App\Support\OfficeCalendar::defaults())]);
 \Carbon\CarbonImmutable::setTestNow(\Carbon\CarbonImmutable::parse('2026-10-13 10:00','Asia/Manila'));
});
afterEach(function(){\Carbon\CarbonImmutable::setTestNow();});


function walkInData(): array
{
    return ['visitorType' => 'Student', 'serviceKey' => 'good_moral', 'serviceLabel' => 'Good Moral',
        'name' => 'Queue Test', 'idNumber' => 'TEST-123', 'contact' => '09123456789', 'email' => 'queue.test@gmail.com'];
}

it('rejects new walk-ins without verification of the same email',function(){
    $this->postJson('/api/visits',walkInData())->assertUnauthorized();
    $this->postJson('/api/visits',walkInData(),['X-Visitor-Token'=>\App\Support\VisitorAccess::token('wrong@gmail.com')])->assertForbidden();
});

it('shares a started visit with the Admin Queue and updates the visitor ticket', function () {
    $q = $this->verifiedPostJson('/api/visits', walkInData())->assertCreated()->json('queue');
    expect($q['status'])->toBe('Waiting');
    $admin = DB::table('staff_users')->where('username', 'queue.fixture')->first();
    $headers = ['Authorization' => 'Bearer '.StaffAuth::token($admin)];
    $this->getJson('/api/queue', $headers)->assertOk()->assertJsonFragment(['visitId' => $q['visitId']]);
    $this->patchJson('/api/queue/'.$q['id'], ['status' => 'Called', 'calledAt' => now()->toIso8601String()], $headers)->assertOk();
    $this->getJson('/api/visits/'.$q['visitId'],['X-Visitor-Token'=>\App\Support\VisitorAccess::token('queue.test@gmail.com')])->assertOk()->assertJsonPath('queue.status', 'Called')->assertJsonPath('queue.assignedAdminId', $admin->id);
    $this->patchJson('/api/queue/'.$q['id'], ['status' => 'Serving'], $headers)->assertOk();
    $this->patchJson('/api/queue/'.$q['id'], ['status'=>'Serving'], $headers)->assertOk();
    $this->checkQueueRequirements($q['id'],$headers);
    $this->patchJson('/api/queue/'.$q['id'], ['status' => 'Completed'], $headers)->assertOk();
    $this->getJson('/api/visits/'.$q['visitId'],['X-Visitor-Token'=>\App\Support\VisitorAccess::token('queue.test@gmail.com')])->assertJsonPath('queue.status', 'Completed');
});

it('allocates unique queue numbers and synchronizes visitor cancellation', function () {
    $a = $this->verifiedPostJson('/api/visits', walkInData())->assertCreated()->json('queue');
    $b = $this->verifiedPostJson('/api/visits', walkInData())->assertCreated()->json('queue');
    expect($a['number'])->not->toBe($b['number']);
    $this->postJson('/api/visits/'.$a['visitId'].'/cancel',[],['X-Visitor-Token'=>\App\Support\VisitorAccess::token('queue.test@gmail.com')])->assertOk()->assertJsonPath('queue.status', 'Cancelled');
    expect(DB::table('queues')->where('id', $a['id'])->value('status'))->toBe('Cancelled');
});

it('protects queue details and modifications from unauthenticated visitors', function () {
    $this->getJson('/api/queue')->assertUnauthorized();
    $this->patchJson('/api/queue/unknown', ['status' => 'Completed'])->assertUnauthorized();
    $this->verifiedPostJson('/api/visits', [])->assertUnprocessable();
});

it('computes duplicate warnings on the server even when the visitor submits false', function () {
    $first=$this->verifiedPostJson('/api/visits',walkInData()+['possibleDuplicate'=>true])->assertCreated()->json('queue');
    expect($first['possibleDuplicate'])->toBeFalse();
    $second=$this->verifiedPostJson('/api/visits',walkInData()+['possibleDuplicate'=>false])->assertCreated()->json('queue');
    expect($second['possibleDuplicate'])->toBeTrue();
});

it('does not flag completed visits as active duplicates', function () {
    $first=$this->verifiedPostJson('/api/visits',walkInData())->assertCreated()->json('queue');
    DB::table('queues')->where('id',$first['id'])->update(['status'=>'Completed']);
    $this->verifiedPostJson('/api/visits',walkInData())->assertCreated()->assertJsonPath('queue.possibleDuplicate',false);
});

function servingChecklistVisit($test): array
{
    $service=DB::table('service_catalog')->where('key','good_moral')->first();
    $payload=json_decode($service->payload,true);$payload['requirements']=['Clearance','Student ID'];
    DB::table('service_catalog')->where('key','good_moral')->update(['payload'=>json_encode($payload)]);
    $q=$test->verifiedPostJson('/api/visits',walkInData())->assertCreated()->json('queue');
    $admin=DB::table('staff_users')->where('username','queue.fixture')->first();
    $headers=['Authorization'=>'Bearer '.StaffAuth::token($admin)];
    $test->patchJson('/api/queue/'.$q['id'],['status'=>'Called'],$headers)->assertOk();
    $test->patchJson('/api/queue/'.$q['id'],['status'=>'Serving'],$headers)->assertOk();
    return [$q,$headers];
}

it('saves requirement checks per visit and preserves independent items across reloads',function(){
    [$q,$headers]=servingChecklistVisit($this);
    $other=$this->verifiedPostJson('/api/visits',walkInData())->assertCreated()->json('queue');
    $url='/api/queue/'.$q['id'].'/requirements';
    foreach(['Clearance','Student ID'] as $label)$this->patchJson($url,['serviceKey'=>'good_moral','requirement'=>$label,'checked'=>true],$headers)->assertOk();
    $this->patchJson($url,['serviceKey'=>'good_moral','requirement'=>'Clearance','checked'=>false],$headers)->assertOk();
    $this->getJson('/api/queue',$headers)->assertOk();
    $stored=\App\Support\QueueData::read(DB::table('queues')->where('id',$q['id'])->value('portal_payload'));
    expect($stored['requirementChecks'][0]['checked'])->toBeFalse()->and($stored['requirementChecks'][1]['checked'])->toBeTrue();
    $untouched=\App\Support\QueueData::read(DB::table('queues')->where('id',$other['id'])->value('portal_payload'));
    expect($untouched)->not->toHaveKey('requirementChecks');
    expect(DB::table('system_audit')->where('action','Requirement checklist updated')->count())->toBe(3);
    $this->patchJson($url,['serviceKey'=>'good_moral','requirement'=>'Student ID','checked'=>true],$headers)->assertOk();
    expect(DB::table('system_audit')->where('action','Requirement checklist updated')->count())->toBe(3);
});

it('rejects visitor and other staff checklist edits',function(){
    [$q,$headers]=servingChecklistVisit($this);$url='/api/queue/'.$q['id'].'/requirements';
    $data=['serviceKey'=>'good_moral','requirement'=>'Clearance','checked'=>true];
    $this->patchJson($url,$data)->assertUnauthorized();
    $admin=(array)DB::table('staff_users')->where('username','queue.fixture')->first();$admin['id']='checklist-other';$admin['username']='checklist.other';$admin['email']=null;
    DB::table('staff_users')->insert($admin);$other=DB::table('staff_users')->where('id','checklist-other')->first();
    $this->patchJson($url,$data,['Authorization'=>'Bearer '.StaffAuth::token($other)])->assertForbidden();
    DB::table('staff_users')->where('id','checklist-other')->update(['role'=>'SUPER_ADMIN']);
    $other=DB::table('staff_users')->where('id','checklist-other')->first();
    $this->patchJson($url,$data,['Authorization'=>'Bearer '.StaffAuth::token($other)])->assertForbidden();
});

it('validates checklist entries against the current service and refuses ended visits',function(){
    [$q,$headers]=servingChecklistVisit($this);$url='/api/queue/'.$q['id'].'/requirements';
    $this->patchJson($url,['serviceKey'=>'wrong-service','requirement'=>'Clearance','checked'=>true],$headers)->assertConflict();
    $this->patchJson($url,['serviceKey'=>'good_moral','requirement'=>'Invented requirement','checked'=>true],$headers)->assertUnprocessable();
    $this->patchJson($url,['serviceKey'=>'good_moral','requirement'=>'Clearance','checked'=>'invalid'],$headers)->assertUnprocessable();
    $this->patchJson($url,['serviceKey'=>'good_moral','requirement'=>'Clearance','checked'=>true],$headers)->assertOk();
    $this->patchJson('/api/queue/'.$q['id'],['status'=>'Completed'],$headers)->assertConflict();
    $this->checkQueueRequirements($q['id'],$headers);
    $this->patchJson('/api/queue/'.$q['id'],['status'=>'Completed'],$headers)->assertOk();
    $this->patchJson($url,['serviceKey'=>'good_moral','requirement'=>'Clearance','checked'=>false],$headers)->assertConflict();
    $stored=\App\Support\QueueData::read(DB::table('queues')->where('id',$q['id'])->value('portal_payload'));
    expect($stored['requirementChecks'][0]['checked'])->toBeTrue();
});

it('does not allow checklist changes after confidential access is removed',function(){
    [$q,$headers]=servingChecklistVisit($this);
    $service=DB::table('service_catalog')->where('key','good_moral')->first();$payload=json_decode($service->payload,true);$payload['confidential']=true;
    DB::table('service_catalog')->where('key','good_moral')->update(['payload'=>json_encode($payload)]);
    DB::table('staff_users')->where('username','queue.fixture')->update(['confidential_access'=>false]);
    $this->patchJson('/api/queue/'.$q['id'].'/requirements',['serviceKey'=>'good_moral','requirement'=>'Clearance','checked'=>true],$headers)->assertForbidden();
});

it('saves checklist items on existing queue tables without an updated timestamp column',function(){
    [$q,$headers]=servingChecklistVisit($this);
    \Illuminate\Support\Facades\Schema::table('queues',function(\Illuminate\Database\Schema\Blueprint $table){$table->dropColumn('updated_at');});
    try {
        $this->patchJson('/api/queue/'.$q['id'].'/requirements',['serviceKey'=>'good_moral','requirement'=>'Clearance','checked'=>true],$headers)
            ->assertOk()->assertJsonPath('queue.requirementChecks.0.checked',true);
        $stored=\App\Support\QueueData::read(DB::table('queues')->where('id',$q['id'])->value('portal_payload'));
        expect($stored['requirementChecks'][0]['requirement'])->toBe('Clearance');
    } finally {
        \Illuminate\Support\Facades\Schema::table('queues',function(\Illuminate\Database\Schema\Blueprint $table){$table->timestamp('updated_at')->nullable();});
    }
});

it('counts only accepted uploads matched to distinct requirements of the linked appointment service',function(){
    [$q,$headers]=servingChecklistVisit($this);
    $files=[['name'=>'clearance.pdf','review'=>['status'=>'Accepted','requirement'=>'Clearance','serviceKey'=>'good_moral']],['name'=>'duplicate.pdf','review'=>['status'=>'Accepted','requirement'=>'Clearance','serviceKey'=>'good_moral']],['name'=>'id.pdf','review'=>['status'=>'Pending review','requirement'=>'Student ID']],['name'=>'unmatched.pdf','review'=>['status'=>'Accepted']]];
    DB::table('shared_appointments')->insert(['id'=>'checklist-appointment','visit_id'=>'APT-CHECKLIST','email'=>\App\Support\EmailIndex::key('queue.test@gmail.com'),'service_key'=>'good_moral','status'=>'Checked-in','date'=>'2026-10-13','time'=>'10:00','queue_id'=>$q['id'],'payload'=>\Illuminate\Support\Facades\Crypt::encryptString(json_encode(['attachments'=>$files,'createdAt'=>now()->toIso8601String(),'service'=>'Good Moral Character','serviceKey'=>'good_moral','name'=>'Queue Test','type'=>'Student','email'=>'queue.test@gmail.com'])),'created_at'=>now(),'updated_at'=>now()]);
    $stored=\App\Support\QueueData::read(DB::table('queues')->where('id',$q['id'])->value('portal_payload'));$stored['appointmentId']='checklist-appointment';$stored['source']='Appointment';
    DB::table('queues')->where('id',$q['id'])->update(['portal_payload'=>\App\Support\QueueData::write($stored)]);
    $readiness=\App\Support\QueueData::requirements($stored);
    expect($readiness['checked'])->toBe(1)->and($readiness['ready'])->toBeFalse()->and($readiness['items'][0]['source'])->toBe('upload');
    $this->patchJson('/api/queue/'.$q['id'],['status'=>'Completed'],$headers)->assertConflict();
    expect(DB::table('shared_transactions')->count())->toBe(0);
    DB::table('shared_appointments')->where('id','checklist-appointment')->update(['service_key'=>'another-service']);
    expect(\App\Support\QueueData::requirements($stored)['checked'])->toBe(0);
    DB::table('shared_appointments')->where('id','checklist-appointment')->update(['service_key'=>'good_moral']);
    $this->patchJson('/api/queue/'.$q['id'].'/requirements',['serviceKey'=>'good_moral','requirement'=>'Student ID','checked'=>true],$headers)->assertOk()->assertJsonPath('queue.requirementReadiness.ready',true);
    $this->patchJson('/api/queue/'.$q['id'],['status'=>'Completed'],$headers)->assertOk();
    expect(DB::table('shared_transactions')->count())->toBe(1);
});
