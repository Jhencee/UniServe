<?php
use App\Support\{StaffAuth,WalkInCapacity};
use Carbon\CarbonImmutable;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\{DB,Schema,Cache};

beforeEach(function(){
 Schema::create('staff_users',function(Blueprint $t){$t->string('id')->primary();$t->string('full_name');$t->string('role');$t->string('password_hash');$t->boolean('is_active');$t->boolean('confidential_approver');});
 foreach(['head'=>true,'regular'=>false] as $id=>$head)DB::table('staff_users')->insert(['id'=>$id,'full_name'=>$id,'role'=>'ADMIN','password_hash'=>'test','is_active'=>true,'confidential_approver'=>$head]);
 (require database_path('migrations/2026_10_12_000003_office_calendar.php'))->up();
 (require database_path('migrations/2026_10_12_000004_audit_and_notifications.php'))->up();
 Schema::create('queues',function(Blueprint $t){$t->string('id');$t->string('status');$t->text('portal_payload');});
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-13 10:00','Asia/Manila'));
 Cache::flush();
});
afterEach(function(){CarbonImmutable::setTestNow();Cache::flush();foreach(['queues','office_calendar','calendar_audit','system_audit','notification_outbox','staff_users'] as $table)Schema::dropIfExists($table);});
function intakeHeaders($id='head'){return ['Authorization'=>'Bearer '.StaffAuth::token(DB::table('staff_users')->where('id',$id)->first())];}
function intakeChange($mode='closed'){return ['mode'=>$mode,'counters'=>1];}

it('allows only Head Admin to close intake without requiring a reason',function(){
 $this->postJson('/api/walk-in-capacity/override',intakeChange())->assertUnauthorized();
 $this->postJson('/api/walk-in-capacity/override',intakeChange(),intakeHeaders('regular'))->assertForbidden();
 $this->postJson('/api/walk-in-capacity/override',intakeChange(),intakeHeaders())->assertOk();
});
it('publishes the manual cutoff status and records the decision',function(){
 $this->postJson('/api/walk-in-capacity/override',intakeChange(),intakeHeaders())->assertOk()->assertJsonPath('accepting',false)->assertJsonPath('manualCutoff',true);
 $this->getJson('/api/walk-in-capacity')->assertOk()->assertJsonPath('message','Walk-in intake is closed for today. Book an appointment or return on the next opening day.');
 expect(DB::table('system_audit')->where('action','Walk-in intake closed by Head Admin')->exists())->toBeTrue();
});
it('restores automatic rules or allows extra walk-ins and clears manual closure',function(){
 foreach(['automatic','extra'] as $mode){
  $this->postJson('/api/walk-in-capacity/override',intakeChange(),intakeHeaders())->assertOk();
  $this->postJson('/api/walk-in-capacity/override',intakeChange($mode),intakeHeaders())->assertOk()->assertJsonPath('accepting',true)->assertJsonPath('manualCutoff',false)->assertJsonPath('override',$mode==='extra');
 }
});
it('expires the manual cutoff the next day',function(){
 $this->postJson('/api/walk-in-capacity/override',intakeChange(),intakeHeaders())->assertOk();
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-14 10:00','Asia/Manila'));
 expect(WalkInCapacity::status()['manualCutoff'])->toBeFalse();
 expect(WalkInCapacity::status()['accepting'])->toBeTrue();
});
it('keeps intake open until the scheduled time and closes exactly at that time',function(){
 $data=intakeChange('scheduled')+['cutoffTime'=>'11:00'];
 $this->postJson('/api/walk-in-capacity/override',$data,intakeHeaders())->assertOk()->assertJsonPath('accepting',true)->assertJsonPath('scheduledCutoff',true)->assertJsonPath('manualCutoffTime','11:00 AM')->assertJsonPath('closedAt',null);
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-13 11:00','Asia/Manila'));
 $this->getJson('/api/walk-in-capacity')->assertOk()->assertJsonPath('accepting',false)->assertJsonPath('manualCutoff',true)->assertJsonPath('closedTime','11:00 AM');
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-13 11:20','Asia/Manila'));
 expect(WalkInCapacity::status()['closedTime'])->toBe('11:00 AM');
});
it('records the immediate closure time and clears it when reopened',function(){
 $this->postJson('/api/walk-in-capacity/override',intakeChange(),intakeHeaders())->assertOk()->assertJsonPath('closedTime','10:00 AM')->assertJsonPath('closedAt','2026-10-13T10:00:00+08:00');
 $this->postJson('/api/walk-in-capacity/override',intakeChange('automatic'),intakeHeaders())->assertOk()->assertJsonPath('closedTime',null)->assertJsonPath('cutoffTime',null);
});
it('rejects missing invalid past and after-hours scheduled times',function(){
 foreach([null,'invalid','09:00','23:00'] as $time)$this->postJson('/api/walk-in-capacity/override',intakeChange('scheduled')+['cutoffTime'=>$time],intakeHeaders())->assertUnprocessable();
 expect(WalkInCapacity::status()['accepting'])->toBeTrue();
});
it('broadcasts the Head Admin cutoff details only to the private staff channel',function(){
 \Illuminate\Support\Facades\Event::fake([\App\Events\WalkInIntakeChanged::class,\App\Events\PortalChanged::class]);
 config(['broadcasting.default'=>'reverb']);
 $this->postJson('/api/walk-in-capacity/override',intakeChange(),intakeHeaders())->assertOk();
 \Illuminate\Support\Facades\Event::assertDispatched(\App\Events\WalkInIntakeChanged::class,function($event){
  return $event->broadcastOn()[0]->name==='private-office'&&count($event->broadcastOn())===1
   &&$event->broadcastWith()['mode']==='closed'&&$event->broadcastWith()['time']==='10:00 AM'
   &&!array_key_exists('reason',$event->broadcastWith());
 });
});
it('notifies once when a scheduled cutoff takes effect and not before',function(){
 \Illuminate\Support\Facades\Event::fake([\App\Events\WalkInIntakeChanged::class,\App\Events\PortalChanged::class]);
 config(['broadcasting.default'=>'reverb']);
 $this->postJson('/api/walk-in-capacity/override',intakeChange('scheduled')+['cutoffTime'=>'11:00'],intakeHeaders())->assertOk();
 \Illuminate\Support\Facades\Event::fake([\App\Events\WalkInIntakeChanged::class,\App\Events\PortalChanged::class]);
 $this->artisan('walk-ins:notify-cutoff')->assertSuccessful();
 \Illuminate\Support\Facades\Event::assertNotDispatched(\App\Events\WalkInIntakeChanged::class);
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-13 11:00','Asia/Manila'));
 $this->artisan('walk-ins:notify-cutoff')->assertSuccessful();
 $this->artisan('walk-ins:notify-cutoff')->assertSuccessful();
 \Illuminate\Support\Facades\Event::assertDispatchedTimes(\App\Events\WalkInIntakeChanged::class,1);
 \Illuminate\Support\Facades\Event::assertDispatched(\App\Events\WalkInIntakeChanged::class,fn($e)=>$e->mode==='closed'&&$e->time==='11:00 AM');
});
it('uses staffed capacity and active workload for waiting estimates',function(){
 foreach(['called'=>'Called','first'=>'Waiting','second'=>'Waiting'] as $id=>$status)DB::table('queues')->insert(['id'=>$id,'status'=>$status,'portal_payload'=>json_encode(['id'=>$id,'status'=>$status,'source'=>'Walk-in','createdAt'=>'2026-10-13T09:00:00+08:00'])]);
 Cache::put('walk-in-counters:2026-10-13',2,3600);
 $status=WalkInCapacity::status();
 expect($status['waitEstimates']['first'])->toBe(5);
 expect($status['waitEstimates']['second'])->toBe(10);
 expect($status['estimatedMinutes'])->toBe(15);
});
