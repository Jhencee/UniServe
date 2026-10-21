<?php
use App\Support\{StaffAuth,QueueData};
use Carbon\CarbonImmutable;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\{DB,Schema};

beforeEach(function(){
 Schema::create('staff_users',function(Blueprint $t){$t->string('id');$t->string('full_name');$t->string('role');$t->string('password_hash');$t->boolean('is_active');});
 foreach(['one','two'] as $id)DB::table('staff_users')->insert(['id'=>$id,'full_name'=>$id,'role'=>'ADMIN','password_hash'=>'test','is_active'=>true]);
 (require database_path('migrations/2026_10_12_000003_office_calendar.php'))->up();
 (require database_path('migrations/2026_10_12_000004_audit_and_notifications.php'))->up();
 Schema::create('queues',function(Blueprint $t){$t->string('id')->primary();$t->string('status');$t->text('portal_payload');foreach(['assigned_admin_id','assigned_admin_name','service_label_text'] as $field)$t->string($field)->nullable();foreach(['called_at','serving_at','completed_at'] as $field)$t->timestamp($field)->nullable();});
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-13 10:00','Asia/Manila'));
 foreach(['a','b','c'] as $id){$q=['id'=>$id,'visitId'=>'VIS-'.$id,'number'=>$id,'status'=>'Waiting','source'=>'Walk-in','serviceKey'=>'other','serviceLabel'=>'Other','createdAt'=>'2026-10-13T09:00:00+08:00'];DB::table('queues')->insert(['id'=>$id,'status'=>'Waiting','portal_payload'=>QueueData::write($q)]);}
});
afterEach(function(){CarbonImmutable::setTestNow();foreach(['shared_system_settings','queues','office_calendar','calendar_audit','system_audit','notification_outbox','staff_users'] as $table)Schema::dropIfExists($table);});
function multipleQueueHeaders($id='one'){return ['Authorization'=>'Bearer '.StaffAuth::token(DB::table('staff_users')->where('id',$id)->first())];}
it('allows one admin to call and serve multiple visitors while retaining separate ownership',function(){
 $headers=multipleQueueHeaders();
 Schema::create('shared_system_settings',function(Blueprint $t){$t->integer('id');$t->text('payload');});
 DB::table('shared_system_settings')->insert(['id'=>1,'payload'=>json_encode(['allowParallelService'=>true])]);
 $first=$this->postJson('/api/queue/call-next',[],$headers)->assertOk()->json('queue.id');
 $second=$this->postJson('/api/queue/call-next',[],$headers)->assertOk()->json('queue.id');
 expect($second)->not->toBe($first);
 foreach([$first,$second] as $id)$this->patchJson('/api/queue/'.$id,['status'=>'Serving'],$headers)->assertOk();
 expect(DB::table('queues')->where('assigned_admin_id','one')->where('status','Serving')->count())->toBe(2);
 $this->patchJson('/api/queue/'.$first,['status'=>'Completed'],multipleQueueHeaders('two'))->assertConflict();
 $this->patchJson('/api/queue/'.$first,['status'=>'Completed'],$headers)->assertOk();
 expect(DB::table('queues')->where('id',$second)->value('status'))->toBe('Serving');
 $this->postJson('/api/queue/call-next',[],multipleQueueHeaders('two'))->assertOk()->assertJsonPath('queue.assignedAdminId','two');
});
it('transfers called visits back to waiting and returns skipped visitors',function(){
 $headers=multipleQueueHeaders();
 $this->patchJson('/api/queue/a',['status'=>'Called'],$headers)->assertOk();
 $this->patchJson('/api/queue/a',['status'=>'Waiting','serviceKey'=>'other'],$headers)->assertOk()->assertJsonPath('queue.calledAt',null)->assertJsonPath('queue.servingAt',null);
 $this->patchJson('/api/queue/b',['status'=>'Called'],$headers)->assertOk();
 $this->patchJson('/api/queue/b',['status'=>'Skipped'],$headers)->assertOk();
 $this->patchJson('/api/queue/b',['status'=>'Waiting'],$headers)->assertOk()->assertJsonPath('queue.status','Waiting');
});
it('retains yesterday’s active visits as Unfinished and never completes them',function(){
 foreach(['a'=>'Waiting','b'=>'Serving','c'=>'Skipped'] as $id=>$status){
  $q=QueueData::read(DB::table('queues')->where('id',$id)->value('portal_payload'));
  $q['createdAt']='2026-10-12T09:00:00+08:00';$q['status']=$status;
  DB::table('queues')->where('id',$id)->update(['status'=>$status,'portal_payload'=>QueueData::write($q)]);
 }
 expect(\App\Support\QueueDayClosure::run())->toBe(3);
 expect(\App\Support\QueueDayClosure::run())->toBe(0);
 expect(DB::table('queues')->count())->toBe(3);
 expect(DB::table('queues')->where('status','Unfinished')->count())->toBe(3);
 $served=QueueData::read(DB::table('queues')->where('id','b')->value('portal_payload'));
 expect($served['previousStatus'])->toBe('Serving');expect($served['completedAt']??null)->toBeNull();
 $this->patchJson('/api/queue/b',['status'=>'Completed'],multipleQueueHeaders())->assertConflict();
 $this->getJson('/api/public-queue')->assertOk()->assertJsonCount(0,'queues');
 expect(\App\Support\WalkInCapacity::status()['estimatedMinutes'])->toBe(0);
});
it('uses Philippine dates and keeps today’s visits while closing yesterday via fallback',function(){
 $q=QueueData::read(DB::table('queues')->where('id','a')->value('portal_payload'));
 $q['createdAt']='2026-10-12T15:59:00Z';DB::table('queues')->where('id','a')->update(['portal_payload'=>QueueData::write($q)]);
 $this->getJson('/api/queue',multipleQueueHeaders())->assertOk();
 expect(DB::table('queues')->where('id','a')->value('status'))->toBe('Unfinished');
 expect(DB::table('queues')->where('id','b')->value('status'))->toBe('Waiting');
});
