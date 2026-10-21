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
