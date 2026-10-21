<?php
use App\Support\{StaffAuth,VisitorAccess};
use Carbon\CarbonImmutable;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\{DB,Schema,Hash};
beforeEach(function(){
 Schema::create('staff_users',function(Blueprint $t){$t->string('id')->primary();$t->string('full_name');$t->string('role');$t->string('password_hash');$t->boolean('is_active');$t->boolean('confidential_access')->default(false);});
 DB::table('staff_users')->insert(['id'=>'admin','full_name'=>'Admin','role'=>'ADMIN','password_hash'=>Hash::make('FixturePassword123'),'is_active'=>true]);
 Schema::create('queues',function(Blueprint $t){$t->string('id')->primary();$t->string('queue_number')->nullable();$t->string('prefix')->nullable();$t->integer('seq')->nullable();$t->string('visitor_type');$t->string('visitor_name')->nullable();$t->string('service_label_text');$t->string('contact')->nullable();$t->string('id_number')->nullable();$t->string('source');$t->string('status');$t->json('portal_payload');$t->string('assigned_admin_id')->nullable();$t->string('assigned_admin_name')->nullable();$t->timestamp('called_at')->nullable();$t->timestamp('serving_at')->nullable();$t->timestamp('completed_at')->nullable();$t->timestamps();});
 foreach(['2026_10_12_000003_office_calendar.php','2026_10_12_000004_audit_and_notifications.php','2026_10_13_000005_confidential_access.php','2026_10_14_000006_shared_appointments.php','2026_10_14_000007_appointment_submission_key.php','2026_10_15_000008_remaining_flows.php','2026_10_15_000009_encrypt_queue_details.php'] as $file)(require database_path('migrations/'.$file))->up();
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-13 10:00','Asia/Manila'));
});
afterEach(function(){CarbonImmutable::setTestNow();foreach(['shared_chats','shared_system_settings','shared_transactions','shared_visitor_log','shared_appointments','service_catalog','confidential_requests','confidential_cases','notification_outbox','system_audit','calendar_audit','office_calendar','queues','staff_users'] as $t)Schema::dropIfExists($t);});
function appointmentHeaders(){return ['Authorization'=>'Bearer '.StaffAuth::token(DB::table('staff_users')->where('id','admin')->first())];}
function appointmentInput(){return ['type'=>'Student','name'=>'Student Name','email'=>'student@gmail.com','contact'=>'09123456789','serviceKey'=>'good_moral','isPWD'=>true,'attachments'=>[]];}
it('requires verification of the submitted Gmail when creating an appointment',function(){
 $this->postJson('/api/appointments',appointmentInput())->assertUnauthorized();
 $this->postJson('/api/appointments',appointmentInput(),['X-Visitor-Token'=>VisitorAccess::token('wrong@gmail.com')])->assertForbidden();
});
function readyFlowVisit(string $service='good_moral'):array{
 $d=appointmentInput();$d['serviceKey']=$service;
 $a=test()->verifiedPostJson('/api/appointments',$d)->assertCreated()->json('appointment');
 test()->patchJson('/api/appointments/'.$a['id'],['date'=>'2026-10-13','time'=>'10:30','revision'=>0],appointmentHeaders())->assertOk();
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-13 10:30','Asia/Manila'));
 return test()->postJson('/api/appointments/'.$a['id'].'/check-in',[],appointmentHeaders())->assertOk()->json();
}
it('accepts appointment requests at night but keeps maintenance intake blocked',function(){
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-18 23:00','Asia/Manila'));
 $this->verifiedPostJson('/api/appointments',appointmentInput())->assertCreated();
 DB::table('shared_system_settings')->where('id',1)->update(['payload'=>json_encode(['maintenanceMode'=>true])]);
 $this->verifiedPostJson('/api/appointments',appointmentInput())->assertStatus(503);
});
it('protects reschedule requests and retains details when recovering a no-show',function(){
 $a=$this->verifiedPostJson('/api/appointments',appointmentInput())->json('appointment');
 DB::table('shared_appointments')->where('id',$a['id'])->update(['status'=>'No-show']);
 $path='/api/appointments/'.$a['id'];
 $this->postJson($path.'/reschedule-request',['reason'=>'Please arrange another day'])->assertUnauthorized();
 $this->postJson($path.'/reschedule-request',['reason'=>'Please arrange another day'],['X-Visitor-Token'=>VisitorAccess::token('wrong@gmail.com')])->assertForbidden();
 $this->postJson($path.'/reschedule-request',['reason'=>'Please arrange another day'],['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->assertOk()->assertJsonPath('appointment.rescheduleRequested',true);
 $this->patchJson($path,['date'=>'2026-10-14','time'=>'10:00','revision'=>1],appointmentHeaders())->assertOk()->assertJsonPath('appointment.status','Booked')->assertJsonPath('appointment.rescheduleRequested',false)->assertJsonPath('appointment.name','Student Name')->assertJsonPath('appointment.scheduleHistory.0.status','No-show');
});
it('enforces slot capacity without changing the conflicting request',function(){
 $a=$this->verifiedPostJson('/api/appointments',appointmentInput())->json('appointment');
 $b=$this->verifiedPostJson('/api/appointments',appointmentInput())->json('appointment');
 foreach([$a,$b] as $index=>$item)$this->patchJson('/api/appointments/'.$item['id'],['date'=>'2026-10-14','time'=>'10:00','revision'=>0],appointmentHeaders())->assertStatus($index?409:200);
 expect(DB::table('shared_appointments')->where('id',$b['id'])->value('status'))->toBe('Requested');
});
it('limits an Admin to one visitor by default including direct calls',function(){
 $q=readyFlowVisit()['queue'];$headers=appointmentHeaders();
 $a=$this->verifiedPostJson('/api/appointments',appointmentInput())->json('appointment');
 $this->patchJson('/api/appointments/'.$a['id'],['date'=>'2026-10-13','time'=>'10:45','revision'=>0],$headers)->assertOk();
 $other=$this->postJson('/api/appointments/'.$a['id'].'/check-in',[],$headers)->assertOk()->json('queue');
 $this->postJson('/api/queue/call-next',[],$headers)->assertOk();
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-13 10:45','Asia/Manila'));
 $this->postJson('/api/queue/call-next',[],$headers)->assertConflict();
 $this->patchJson('/api/queue/'.$other['id'],['status'=>'Called'],$headers)->assertConflict();
 $this->patchJson('/api/queue/'.$q['id'],['status'=>'Serving'],$headers)->assertOk();
 $this->patchJson('/api/queue/'.$q['id'],['status'=>'Completed'],$headers)->assertOk();
 $this->postJson('/api/queue/call-next',[],$headers)->assertOk()->assertJsonPath('queue.id',$other['id']);
});
it('records transfer stages and keeps the appointment service aligned',function(){
 $r=readyFlowVisit();$q=$r['queue'];$path='/api/queue/'.$q['id'];$h=appointmentHeaders();
 $this->patchJson($path,['status'=>'Called'],$h)->assertOk();$this->patchJson($path,['status'=>'Serving'],$h)->assertOk();
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-13 10:40','Asia/Manila'));
 $this->patchJson($path,['status'=>'Waiting','serviceKey'=>'student_id'],$h)->assertOk()->assertJsonPath('queue.serviceHistory.0.serviceKey','good_moral')->assertJsonPath('queue.serviceHistory.0.outcome','Transferred')->assertJsonPath('queue.servingAt',null);
 $this->getJson('/api/appointments', $h)->assertJsonPath('appointments.0.service','Student ID-Related Requests');
 $log=json_decode(\Illuminate\Support\Facades\Crypt::decryptString(DB::table('shared_visitor_log')->value('payload')),true);
 expect($log['timeOut'])->not->toBeNull();expect($log['serviceHistory'][0]['serviceKey'])->toBe('good_moral');
 $this->patchJson($path,['status'=>'Called'],$h)->assertOk();$this->patchJson($path,['status'=>'Serving'],$h)->assertOk();$this->patchJson($path,['status'=>'Completed'],$h)->assertOk();
 $this->getJson('/api/service-records',$h)->assertJsonPath('transactions.0.serviceHistory.0.serviceKey','good_moral');
});
it('returns absent visitors with a new ordering timestamp',function(){
 $q=readyFlowVisit()['queue'];$path='/api/queue/'.$q['id'];$h=appointmentHeaders();
 $this->patchJson($path,['status'=>'Called'],$h)->assertOk();$this->patchJson($path,['status'=>'Skipped'],$h)->assertOk();
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-13 11:00','Asia/Manila'));
 $returned=$this->patchJson($path,['status'=>'Waiting'],$h)->assertOk()->json('queue.queueEnteredAt');
 expect(CarbonImmutable::parse($returned)->setTimezone('Asia/Manila')->format('Y-m-d H:i'))->toBe('2026-10-13 11:00');
});
it('recovers unfinished appointments without duplicating the queue or losing history',function(){
 $r=readyFlowVisit();$q=$r['queue'];$h=appointmentHeaders();
 $this->patchJson('/api/queue/'.$q['id'],['status'=>'Called'],$h)->assertOk();$this->patchJson('/api/queue/'.$q['id'],['status'=>'Serving'],$h)->assertOk();
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-14 09:00','Asia/Manila'));
 \App\Support\QueueDayClosure::run();
 $a=DB::table('shared_appointments')->first();
 $this->patchJson('/api/appointments/'.$a->id,['date'=>'2026-10-14','time'=>'10:00','revision'=>$a->revision],$h)->assertOk();
 $this->getJson('/api/appointments/visit/'.$a->visit_id,$h)->assertJsonPath('queue',null);
 $this->patchJson('/api/queue/'.$q['id'],['status'=>'Waiting'],$h)->assertConflict();
 $this->postJson('/api/appointments/'.$a->id.'/check-in',[],$h)->assertOk()->assertJsonPath('queue.id',$q['id'])->assertJsonPath('queue.serviceHistory.0.outcome','Unfinished');
 expect(DB::table('queues')->count())->toBe(1);
});
it('arranges a follow-up under the same Visit ID and retains uploads',function(){
 $r=readyFlowVisit();$q=$r['queue'];$h=appointmentHeaders();
 $a=$this->postJson('/api/queue/'.$q['id'].'/follow-up',['reason'=>'Bring the remaining requirements tomorrow'],$h)->assertOk()->assertJsonPath('appointment.visitId',$q['visitId'])->assertJsonPath('queue.status','Unfinished')->assertJsonPath('appointment.status','Requested')->json('appointment');
 $this->patchJson('/api/appointments/'.$a['id'],['date'=>'2026-10-14','time'=>'10:00','revision'=>$a['revision']],$h)->assertOk();
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-14 10:00','Asia/Manila'));
 $this->postJson('/api/appointments/'.$a['id'].'/check-in',[],$h)->assertOk()->assertJsonPath('queue.id',$q['id']);
 expect(DB::table('queues')->count())->toBe(1);
});
it('blocks transferring a confidential visit through a public target service',function(){
 DB::table('staff_users')->where('id','admin')->update(['confidential_access'=>true]);
 $q=readyFlowVisit('incident_report')['queue'];
 DB::table('staff_users')->where('id','admin')->update(['confidential_access'=>false]);
 $this->patchJson('/api/queue/'.$q['id'],['status'=>'Waiting','serviceKey'=>'other'],appointmentHeaders())->assertForbidden();
 DB::table('staff_users')->where('id','admin')->update(['confidential_access'=>true]);
 $this->patchJson('/api/queue/'.$q['id'],['status'=>'Waiting','serviceKey'=>'other'],appointmentHeaders())->assertConflict();
});
it('flags calendar conflicts and queues a closure notice while retaining the booking',function(){
 $a=$this->verifiedPostJson('/api/appointments',appointmentInput())->json('appointment');
 $this->patchJson('/api/appointments/'.$a['id'],['date'=>'2026-10-14','time'=>'10:00','revision'=>0],appointmentHeaders())->assertOk();
 $calendar=\App\Support\OfficeCalendar::get();$calendar['days']['2026-10-14']=['type'=>'closed','name'=>'Office meeting'];
 $this->putJson('/api/calendar',['calendar'=>$calendar,'effects'=>['affected'=>1,'decision'=>'review']],appointmentHeaders())->assertOk();
 $this->getJson('/api/appointments',appointmentHeaders())->assertJsonPath('appointments.0.status','Booked')->assertJsonPath('appointments.0.rescheduleRequested',true)->assertJsonPath('appointments.0.calendarReview',true);
 expect(DB::table('notification_outbox')->where('kind','calendar-change')->count())->toBe(1);
});
it('keeps case resolution separate from a completed visit and preserves it on completion retries',function(){
 DB::table('staff_users')->where('id','admin')->update(['confidential_access'=>true]);
 $q=readyFlowVisit('incident_report')['queue'];$h=appointmentHeaders();$path='/api/queue/'.$q['id'];
 $this->patchJson($path,['status'=>'Called'],$h)->assertOk();$this->patchJson($path,['status'=>'Serving'],$h)->assertOk();
 $q=$this->patchJson($path,['status'=>'Completed'],$h)->assertOk()->assertJsonPath('queue.caseStatus','Open')->json('queue');
 $record='/api/service-records/'.$q['transactionId'];
 $this->patchJson($record,['escalation'=>'Resolved'],$h)->assertForbidden();
 \Illuminate\Support\Facades\Cache::put('conf-unlock:admin:'.$q['transactionId'].':view',true,300);
 $this->patchJson($record,['escalation'=>'Resolved'],$h)->assertOk();
 $this->getJson('/api/visits/'.$q['visitId'],['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->assertOk()->assertJsonPath('queue.status','Completed')->assertJsonPath('queue.caseStatus','Resolved');
 $this->patchJson($path,['status'=>'Completed'],$h)->assertOk()->assertJsonPath('queue.caseStatus','Resolved');
});
it('accepts configured slot capacity and exposes the corresponding policy settings',function(){
 $settings=json_decode(DB::table('shared_system_settings')->where('id',1)->value('payload'),true);$settings['appointmentSlotCapacity']=2;
 DB::table('shared_system_settings')->where('id',1)->update(['payload'=>json_encode($settings)]);
 foreach(range(1,2) as $n){$a=$this->verifiedPostJson('/api/appointments',appointmentInput())->json('appointment');$this->patchJson('/api/appointments/'.$a['id'],['date'=>'2026-10-14','time'=>'10:00','revision'=>0],appointmentHeaders())->assertOk();}
 $this->getJson('/api/settings')->assertJsonPath('settings.appointmentSlotCapacity',2);
});
it('saves capacity and parallel-service settings through the Super Admin API',function(){
 DB::table('staff_users')->where('id','admin')->update(['role'=>'SUPER_ADMIN']);
 $settings=['maintenanceMode'=>false,'sessionTimeout'=>30,'gracePeriodMinutes'=>15,'noShowThresholdMinutes'=>60,'appointmentSlotCapacity'=>2,'allowParallelService'=>true];
 $this->putJson('/api/settings',['settings'=>$settings,'revision'=>0],appointmentHeaders())->assertOk()->assertJsonPath('settings.appointmentSlotCapacity',2)->assertJsonPath('settings.allowParallelService',true);
 $settings['appointmentSlotCapacity']=0;
 $this->putJson('/api/settings',['settings'=>$settings,'revision'=>1],appointmentHeaders())->assertUnprocessable();
});
it('marks a recovered but missed booking as no-show and allows another reschedule',function(){
 $r=readyFlowVisit();$q=$r['queue'];$h=appointmentHeaders();
 $a=$this->postJson('/api/queue/'.$q['id'].'/follow-up',['reason'=>'Return with additional documents'],$h)->json('appointment');
 $this->patchJson('/api/appointments/'.$a['id'],['date'=>'2026-10-14','time'=>'10:00','revision'=>$a['revision']],$h)->assertOk();
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-14 11:01','Asia/Manila'));
 $this->artisan('appointments:no-shows')->assertSuccessful();
 $row=DB::table('shared_appointments')->where('id',$a['id'])->first();expect($row->status)->toBe('No-show');
 $this->patchJson('/api/appointments/'.$a['id'],['date'=>'2026-10-15','time'=>'10:00','revision'=>$row->revision],$h)->assertOk();
});
it('records why a visit was not served without creating a completed transaction',function(){
 $q=readyFlowVisit()['queue'];
 $this->patchJson('/api/queue/'.$q['id'],['status'=>'Cancelled','closureReason'=>'Visitor left before service.'],appointmentHeaders())->assertOk()->assertJsonPath('queue.closureReason','Visitor left before service.');
 expect(DB::table('shared_transactions')->count())->toBe(0);expect(DB::table('shared_visitor_log')->count())->toBe(0);
});
it('does not let completion retries change the service or owning Admin',function(){
 $q=readyFlowVisit()['queue'];$h=appointmentHeaders();$path='/api/queue/'.$q['id'];
 foreach(['Called','Serving','Completed'] as $status)$this->patchJson($path,['status'=>$status],$h)->assertOk();
 $this->patchJson($path,['status'=>'Completed','serviceKey'=>'student_id'],$h)->assertConflict();
 $this->patchJson($path,['status'=>'Completed'],$h)->assertOk()->assertJsonPath('queue.assignedAdminId','admin');
 expect(DB::table('shared_transactions')->count())->toBe(1);
});
it('shares submitted requests with Admin and protects visitor retrieval',function(){
 $a=$this->verifiedPostJson('/api/appointments',appointmentInput())->assertCreated()->json('appointment');
 $this->getJson('/api/appointments',appointmentHeaders())->assertOk()->assertJsonPath('appointments.0.visitId',$a['visitId']);
 $this->getJson('/api/appointments/visit/'.$a['visitId'])->assertUnauthorized();
 $this->getJson('/api/appointments/visit/'.$a['visitId'],['X-Visitor-Token'=>VisitorAccess::token('wrong@gmail.com')])->assertForbidden();
 $this->getJson('/api/appointments/visit/'.$a['visitId'],['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->assertOk();
 expect(DB::table('shared_appointments')->value('payload'))->not->toContain('student@gmail.com');
});
it('accepts closed-hour requests while rejecting invalid services or file contents',function(){
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-13 12:30','Asia/Manila'));
 $this->verifiedPostJson('/api/appointments',appointmentInput())->assertCreated();
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-13 10:00','Asia/Manila'));
 $d=appointmentInput();$d['serviceKey']='invented';$this->verifiedPostJson('/api/appointments',$d)->assertUnprocessable();
 $d=appointmentInput();$d['attachments']=[['name'=>'bad.pdf','dataUrl'=>'data:application/pdf;base64,'.base64_encode('not a PDF')]];$this->verifiedPostJson('/api/appointments',$d)->assertUnprocessable();
});
it('validates schedules and creates reminder outbox atomically',function(){
 $a=$this->verifiedPostJson('/api/appointments',appointmentInput())->json('appointment');$path='/api/appointments/'.$a['id'];
 $this->patchJson($path,['date'=>'2026-10-14','time'=>'12:30','revision'=>0],appointmentHeaders())->assertUnprocessable();
 $this->patchJson($path,['date'=>'2026-10-14','time'=>'11:00','revision'=>0],appointmentHeaders())->assertOk()->assertJsonPath('appointment.status','Booked');
 expect(DB::table('notification_outbox')->count())->toBe(2);
 $this->patchJson($path,['date'=>'2026-10-14','time'=>'11:30','revision'=>0],appointmentHeaders())->assertConflict();
 $this->patchJson($path,['date'=>'2026-10-14','time'=>'11:30','revision'=>1],appointmentHeaders())->assertOk();
 expect(DB::table('notification_outbox')->where('status','superseded')->count())->toBe(2);
});
it('checks in once and completes log and transaction together',function(){
 $a=$this->verifiedPostJson('/api/appointments',appointmentInput())->json('appointment');
 $this->patchJson('/api/appointments/'.$a['id'],['date'=>'2026-10-13','time'=>'11:00','revision'=>0],appointmentHeaders())->assertOk();
 $visitor=['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')];
 $this->postJson('/api/appointments/'.$a['id'].'/check-in',[],$visitor)->assertForbidden();
 $q=$this->postJson('/api/appointments/'.$a['id'].'/check-in',[],appointmentHeaders())->assertOk()->json('queue');
 $this->postJson('/api/appointments/'.$a['id'].'/check-in',[],appointmentHeaders())->assertOk()->assertJsonPath('queue.id',$q['id']);
 expect(DB::table('queues')->count())->toBe(1);expect($q['number'])->toBeNull();expect($q['isPWD'])->toBeTrue();
 $path='/api/queue/'.$q['id'];
 $this->patchJson($path,['status'=>'Called'],appointmentHeaders())->assertConflict();
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-13 11:00','Asia/Manila'));
 $this->patchJson($path,['status'=>'Completed'],appointmentHeaders())->assertConflict();
 $this->patchJson($path,['status'=>'Called'],appointmentHeaders())->assertOk();
 $this->patchJson($path,['status'=>'Serving'],appointmentHeaders())->assertOk();
 $this->patchJson($path,['status'=>'Completed'],appointmentHeaders())->assertOk();
 $this->patchJson($path,['status'=>'Completed'],appointmentHeaders())->assertOk();
 expect(DB::table('shared_transactions')->count())->toBe(1);expect(DB::table('shared_visitor_log')->count())->toBe(1);
 $this->getJson('/api/service-records',appointmentHeaders())->assertOk()->assertJsonPath('visitorLog.0.name','Student Name');
 expect(DB::table('shared_appointments')->value('status'))->toBe('Completed');
});
it('cancels requests and prevents check-in after cancellation',function(){
 $a=$this->verifiedPostJson('/api/appointments',appointmentInput())->json('appointment');$v=['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')];
 $this->postJson('/api/appointments/'.$a['id'].'/cancel',[],$v)->assertOk();
 $this->postJson('/api/appointments/'.$a['id'].'/check-in',[],appointmentHeaders())->assertConflict();
});
it('reuses submission keys instead of creating duplicate requests on retry',function(){
 $d=appointmentInput();$d['submissionKey']=(string)\Illuminate\Support\Str::uuid();
 $a=$this->verifiedPostJson('/api/appointments',$d)->assertCreated()->json('appointment');
 $this->verifiedPostJson('/api/appointments',$d)->assertCreated()->assertJsonPath('appointment.id',$a['id']);
 expect(DB::table('shared_appointments')->count())->toBe(1);
});
it('protects chat ownership and rejects forged chat tokens',function(){
 $data=['visitorName'=>'Visitor Name','email'=>'student@gmail.com','contact'=>'09123456789','text'=>'Hello office'];
 $first=$this->postJson('/api/chats',$data,['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->assertCreated()->json();
 $second=$this->postJson('/api/chats',$data,['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->assertCreated()->json();
 $path='/api/chats/'.$first['chat']['id'];
 $this->getJson($path)->assertUnauthorized();
 $this->getJson($path,['X-Chat-Token'=>$second['chatToken']])->assertUnauthorized();
 $this->getJson($path,['X-Chat-Token'=>$first['chatToken']])->assertOk();
 $this->postJson($path.'/messages',['text'=>'Staff reply'],appointmentHeaders())->assertOk()->assertJsonPath('chat.messages.1.sender','staff');
 $this->getJson('/api/chats',['X-Visitor-Token'=>VisitorAccess::token('wrong@gmail.com')])->assertJsonCount(0,'chats');
 expect(DB::table('shared_chats')->value('payload'))->not->toContain('Hello office');
});
it('keeps personal details off the public queue and protects visit endpoints',function(){
 $a=$this->verifiedPostJson('/api/appointments',appointmentInput())->json('appointment');
 $this->patchJson('/api/appointments/'.$a['id'],['date'=>'2026-10-13','time'=>'11:00','revision'=>0],appointmentHeaders())->assertOk();
 $q=$this->postJson('/api/appointments/'.$a['id'].'/check-in',[],appointmentHeaders())->json('queue');
 $public=$this->getJson('/api/public-queue')->assertOk()->json('queues.0');
 expect($public)->not->toHaveKeys(['name','email','contact','idNumber','attachments']);
 $this->getJson('/api/visits/'.$a['visitId'])->assertUnauthorized();
 $this->postJson('/api/visits/'.$a['visitId'].'/cancel')->assertUnauthorized();
 $this->getJson('/api/visits/'.$a['visitId'],['X-Visitor-Token'=>VisitorAccess::token('wrong@gmail.com')])->assertForbidden();
 $this->getJson('/api/visits/'.$a['visitId'],['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->assertOk()->assertHeader('Cache-Control','no-store, private');
});
it('requires staff authorization for chat management and settings changes',function(){
 $c=$this->postJson('/api/chats',['visitorName'=>'Visitor Name','email'=>'student@gmail.com','contact'=>'09123456789','text'=>'Hello'],['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->json('chat');
 $this->deleteJson('/api/chats/'.$c['id'])->assertUnauthorized();
 $this->patchJson('/api/chats/'.$c['id'],['status'=>'Closed'],appointmentHeaders())->assertOk();
 $this->putJson('/api/settings',['settings'=>[],'revision'=>0],appointmentHeaders())->assertForbidden();
});
it('requires mailbox verification before chat creation and blocks forged attachments',function(){
 $d=['visitorName'=>'Visitor Name','email'=>'student@gmail.com','contact'=>'09123456789','text'=>'Hello'];
 $this->postJson('/api/chats',$d)->assertUnauthorized();
 $this->postJson('/api/chats',$d,['X-Visitor-Token'=>VisitorAccess::token('wrong@gmail.com')])->assertForbidden();
 $d['attachments']=[['name'=>'test.html','dataUrl'=>'javascript:alert(1)']];
 $this->postJson('/api/chats',$d,['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->assertUnprocessable();
});
it('allows feedback once only after completion and for the correct visitor',function(){
 $q=['id'=>'feedback-q','visitId'=>'VIS-FEEDBACK','email'=>'student@gmail.com','name'=>'Student','status'=>'Completed'];
 DB::table('queues')->insert(['id'=>$q['id'],'queue_number'=>'G-001','visitor_type'=>'Student','service_label_text'=>'Good Moral','source'=>'Walk-in','status'=>'Completed','visit_id'=>$q['visitId'],'email_hash'=>\App\Support\EmailIndex::key($q['email']),'portal_payload'=>\App\Support\QueueData::write($q)]);
 $path='/api/queue/'.$q['id'].'/feedback';
 $this->postJson($path,['rating'=>5])->assertUnauthorized();
 $this->postJson($path,['rating'=>5],['X-Visitor-Token'=>VisitorAccess::token('wrong@gmail.com')])->assertForbidden();
 $v=['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')];
 $this->postJson($path,['rating'=>5,'comment'=>'Helpful office'],$v)->assertOk();
 $this->postJson($path,['rating'=>1],$v)->assertConflict();
});
it('imports legacy records without overwriting existing records and refuses unsafe files',function(){
 $data=['origin'=>(string)\Illuminate\Support\Str::uuid(),'transactions'=>[['id'=>'legacy-t','code'=>'OSS-OLD','name'=>'Old Visitor','service'=>'good_moral','status'=>'Completed','createdAt'=>'2026-10-01T00:00:00Z']]];
 $this->postJson('/api/import-browser',$data)->assertUnauthorized();
 $this->postJson('/api/import-browser',$data,appointmentHeaders())->assertOk()->assertJsonPath('imported',1);
 $this->postJson('/api/import-browser',$data,appointmentHeaders())->assertOk()->assertJsonPath('imported',0);
 $other=$data;$other['origin']=(string)\Illuminate\Support\Str::uuid();$other['transactions'][0]['name']='Another Visitor';
 $this->postJson('/api/import-browser',$other,appointmentHeaders())->assertOk()->assertJsonPath('imported',1);
 expect(DB::table('shared_transactions')->count())->toBe(2);
 $data['transactions'][0]['id']='unsafe-t';$data['transactions'][0]['attachments']=[['name'=>'bad','dataUrl'=>'javascript:alert(1)']];
 $this->postJson('/api/import-browser',$data,appointmentHeaders())->assertUnprocessable();
});
it('accepts feedback from a scoped visit token without requiring another Gmail verification',function(){
 $a=$this->verifiedPostJson('/api/appointments',appointmentInput())->assertCreated()->json('appointment');
 $this->patchJson('/api/appointments/'.$a['id'],['date'=>'2026-10-13','time'=>'11:00','revision'=>0],appointmentHeaders())->assertOk();
 $q=$this->postJson('/api/appointments/'.$a['id'].'/check-in',[],appointmentHeaders())->assertOk()->json('queue');
 $q['status']='Completed';$q['feedback']=null;
 DB::table('queues')->where('id',$q['id'])->update(['status'=>'Completed','portal_payload'=>\App\Support\QueueData::write($q)]);
 $token=\Illuminate\Support\Facades\Crypt::encryptString(json_encode(['purpose'=>'visit','visitId'=>$q['visitId'],'expires'=>time()+3600]));
 $this->postJson('/api/queue/'.$q['id'].'/feedback',['rating'=>5],['X-Visit-Token'=>$token])->assertOk();
});
it('protects private WebSocket subscriptions and excludes personal records from socket messages',function(){
 config(['broadcasting.connections.reverb.key'=>'test-key','broadcasting.connections.reverb.secret'=>'test-secret']);
 $data=['socket_id'=>'123.456','channel_name'=>'private-office'];
 $this->postJson('/api/realtime/auth',$data)->assertUnauthorized();
 $this->postJson('/api/realtime/auth',$data,appointmentHeaders())->assertOk()->assertJsonPath('auth','test-key:'.hash_hmac('sha256','123.456:private-office','test-secret'));
 $data['channel_name']='private-unrecognized';$this->postJson('/api/realtime/auth',$data,appointmentHeaders())->assertForbidden();
 expect((new \App\Events\PortalChanged('queue',['public-queue']))->broadcastWith())->toBe(['resource'=>'queue']);
});
it('audits the appointment lifecycle once per change and records rejected visitor actions',function(){
 $a=$this->verifiedPostJson('/api/appointments',appointmentInput())->assertCreated()->json('appointment');
 expect(DB::table('system_audit')->where('action','Appointment request received')->count())->toBe(1);
 $this->patchJson('/api/appointments/'.$a['id'],['date'=>'2026-10-13','time'=>'11:00','revision'=>0],appointmentHeaders())->assertOk();
 expect(DB::table('system_audit')->where('action','Appointment scheduled')->count())->toBe(1);
 $this->postJson('/api/appointments/'.$a['id'].'/check-in',[],['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->assertForbidden();
 expect(DB::table('system_audit')->where('action','Access denied')->count())->toBe(1);
 $q=$this->postJson('/api/appointments/'.$a['id'].'/check-in',[],appointmentHeaders())->assertOk()->json('queue');
 $this->postJson('/api/appointments/'.$a['id'].'/check-in',[],appointmentHeaders())->assertOk();
 expect(DB::table('system_audit')->where('action','Appointment checked in')->count())->toBe(1);
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-13 11:00','Asia/Manila'));
 foreach(['Called','Serving','Completed','Completed'] as $status)$this->patchJson('/api/queue/'.$q['id'],['status'=>$status],appointmentHeaders())->assertOk();
 expect(DB::table('system_audit')->where('action','Service completed')->count())->toBe(1);
 expect(DB::table('system_audit')->where('action','Service started')->count())->toBe(1);
 $count=DB::table('system_audit')->count();$this->getJson('/api/queue',appointmentHeaders())->assertOk();expect(DB::table('system_audit')->count())->toBe($count);
});
it('queues one private cancellation email and stops the old appointment reminders',function(){
 $a=$this->verifiedPostJson('/api/appointments',appointmentInput())->assertCreated()->json('appointment');
 $this->patchJson('/api/appointments/'.$a['id'],['date'=>'2026-10-14','time'=>'11:00','revision'=>0],appointmentHeaders())->assertOk();
 $this->postJson('/api/appointments/'.$a['id'].'/cancel',[],appointmentHeaders())->assertOk();
 $this->postJson('/api/appointments/'.$a['id'].'/cancel',[],appointmentHeaders())->assertOk();
 expect(DB::table('notification_outbox')->where('kind','cancelled')->count())->toBe(1);
 expect(DB::table('notification_outbox')->where('kind','!=','cancelled')->where('status','cancelled')->count())->toBe(2);
 $mail=\App\Support\PrivateNotification::read(DB::table('notification_outbox')->where('kind','cancelled')->first());
 expect($mail['subject'])->toBe('Appointment cancelled');expect($mail['body'])->toContain($a['visitId'])->toContain('11:00 AM');
 expect(DB::table('notification_outbox')->where('kind','cancelled')->value('body'))->not->toContain('student@gmail.com');
});

it('restricts service privacy changes to the OSS Head and protects existing appointments',function(){
 $this->verifiedPostJson('/api/appointments',appointmentInput())->assertCreated();
 $data=['label'=>'Good Moral Character','icon'=>'cap','requirements'=>[],'confidential'=>true];
 $this->putJson('/api/services/good_moral',$data,appointmentHeaders())->assertForbidden();
 DB::table('staff_users')->where('id','admin')->update(['confidential_approver'=>true,'confidential_access'=>true]);
 $this->putJson('/api/services/good_moral',$data,appointmentHeaders())->assertOk();
 expect(\App\Support\ServicePrivacy::confidential('good_moral'))->toBeTrue();
 DB::table('staff_users')->where('id','admin')->update(['confidential_access'=>false]);
 $this->getJson('/api/appointments',appointmentHeaders())->assertOk()->assertJsonPath('appointments.0.restricted',true);
 expect(DB::table('system_audit')->where('action','Service marked confidential')->count())->toBe(1);
 DB::table('staff_users')->where('id','admin')->update(['confidential_access'=>true]);
 $data['confidential']=false;$this->putJson('/api/services/good_moral',$data,appointmentHeaders())->assertOk();
 expect(\App\Support\ServicePrivacy::confidential('good_moral'))->toBeFalse();
});

it('publishes rating totals without exposing feedback identities or comments',function(){
 foreach([5,3] as $i=>$rating)DB::table('queues')->insert(['id'=>'feedback-'.$i,'queue_number'=>'FB-'.$i,'visitor_type'=>'Student','source'=>'Walk-in','status'=>'Completed','service_label_text'=>'Service','portal_payload'=>\App\Support\QueueData::write(['name'=>'Private Name','email'=>'private@example.com','feedback'=>['rating'=>$rating,'comment'=>'Private comment']]),'created_at'=>now(),'updated_at'=>now()]);
 $response=$this->getJson('/api/public-feedback')->assertOk()->assertJsonPath('total',2)->assertJsonPath('average',4)->assertJsonPath('satisfied',50);
 expect($response->getContent())->not->toContain('Private Name')->not->toContain('private@example.com')->not->toContain('Private comment');
});

it('redacts confidential visitor log data before a completed transaction exists and keeps creation timestamps stable',function(){
 $actor=DB::table('staff_users')->where('id','admin')->first();
 $q=['id'=>'privacy-queue','visitId'=>'VIS-PRIVATE','name'=>'Private Student','visitorType'=>'Student','serviceKey'=>'incident_report','serviceLabel'=>'Incident Reports','source'=>'Walk-in','status'=>'Serving','email'=>'private@example.com','contact'=>'09123456789','createdAt'=>now()->toIso8601String(),'servingAt'=>now()->toIso8601String(),'assignedAdminId'=>'other'];
 DB::table('queues')->insert(['id'=>$q['id'],'queue_number'=>'P-001','visitor_type'=>'Student','source'=>'Walk-in','status'=>'Serving','service_label_text'=>'Incident Reports','portal_payload'=>\App\Support\QueueData::write($q),'created_at'=>now(),'updated_at'=>now()]);
 \App\Support\ServiceOutcome::save($q,$actor);$created=DB::table('shared_visitor_log')->value('created_at');
 $result=$this->getJson('/api/service-records',appointmentHeaders())->assertOk();expect($result->getContent())->not->toContain('Private Student')->not->toContain('private@example.com')->not->toContain('09123456789');
 \Carbon\CarbonImmutable::setTestNow(\Carbon\CarbonImmutable::now()->addMinute());$q['status']='Completed';$q['completedAt']=now()->toIso8601String();\App\Support\ServiceOutcome::save($q,$actor);
 expect(DB::table('shared_visitor_log')->value('created_at'))->toBe($created);expect(DB::table('shared_visitor_log')->count())->toBe(1);expect(DB::table('shared_transactions')->count())->toBe(1);
});

it('verifies an encrypted backup without replacing database records',function(){
 $path=tempnam(sys_get_temp_dir(),'uniserve-verify-');
 try{$before=DB::table('service_catalog')->count();file_put_contents($path,json_encode(['format'=>'uniserve-encrypted-v1','encrypted'=>\Illuminate\Support\Facades\Crypt::encryptString(json_encode(['service_catalog'=>[]]))]));$this->artisan('backup:restore',['file'=>$path,'--verify'=>true])->assertSuccessful();expect(DB::table('service_catalog')->count())->toBe($before);}finally{unlink($path);}
});

it('stops walk-ins at fixed cutoff while preserving queued visits and allows Head Admin override',function(){
 \Carbon\CarbonImmutable::setTestNow(\Carbon\CarbonImmutable::parse('2026-10-13 16:30','Asia/Manila'));
 $this->getJson('/api/walk-in-capacity')->assertOk()->assertJsonPath('accepting',false)->assertJsonPath('cutoff','4:30 PM');
 $this->postJson('/api/walk-in-capacity/override',['enabled'=>true,'counters'=>1,'reason'=>'Finish remaining visitors'],appointmentHeaders())->assertForbidden();
 DB::table('staff_users')->where('id','admin')->update(['confidential_approver'=>true]);
 $this->postJson('/api/walk-in-capacity/override',['enabled'=>true,'counters'=>1,'reason'=>'Extra counter available'],appointmentHeaders())->assertOk()->assertJsonPath('accepting',true);
 \Carbon\CarbonImmutable::setTestNow(\Carbon\CarbonImmutable::parse('2026-10-13 17:00','Asia/Manila'));
 $this->getJson('/api/walk-in-capacity')->assertOk()->assertJsonPath('accepting',false);
});
it('closes intake early when projected workload is too large and does not oscillate',function(){
 \Carbon\CarbonImmutable::setTestNow(\Carbon\CarbonImmutable::parse('2026-10-13 16:00','Asia/Manila'));
 for($i=0;$i<5;$i++)DB::table('queues')->insert(['id'=>'capacity-'.$i,'queue_number'=>'CP-'.$i,'visitor_type'=>'Student','source'=>'Walk-in','status'=>'Waiting','service_label_text'=>'Service','portal_payload'=>\App\Support\QueueData::write(['status'=>'Waiting','source'=>'Walk-in']),'created_at'=>now(),'updated_at'=>now()]);
 $this->getJson('/api/walk-in-capacity')->assertOk()->assertJsonPath('accepting',false);
 DB::table('queues')->where('id','like','capacity-%')->update(['status'=>'Completed']);
 $this->getJson('/api/walk-in-capacity')->assertOk()->assertJsonPath('accepting',false);
 expect(DB::table('queues')->count())->toBe(5);
});

it('protects document reviews and exposes correction instructions to the visit owner',function(){
 $a=$this->verifiedPostJson('/api/appointments',appointmentInput())->json('appointment');
 $row=DB::table('shared_appointments')->where('id',$a['id'])->first();
 $payload=\App\Http\Controllers\AppointmentController::present($row);
 $payload['attachments']=[['name'=>'Requirement.pdf','dataUrl'=>'data:application/pdf;base64,JVBERg==']];
 DB::table('shared_appointments')->where('id',$a['id'])->update(['payload'=>\Illuminate\Support\Facades\Crypt::encryptString(json_encode($payload))]);
 $path='/api/appointments/'.$a['id'].'/documents/0';
 $review=['status'=>'Needs correction','reason'=>'Bring a readable signed copy.','revision'=>0];
 $this->patchJson($path,$review,['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->assertUnauthorized();
 $this->patchJson($path,array_merge($review,['reason'=>'   ']),appointmentHeaders())->assertUnprocessable();
 $this->patchJson($path,$review,appointmentHeaders())->assertOk()->assertJsonPath('appointment.revision',1)->assertJsonPath('appointment.attachments.0.review.status','Needs correction');
 $this->patchJson($path,$review,appointmentHeaders())->assertConflict();
 $this->getJson('/api/appointments/visit/'.$a['visitId'],['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->assertOk()->assertJsonPath('appointment.attachments.0.review.reason','Bring a readable signed copy.');
 $this->getJson('/api/appointments/visit/'.$a['visitId'],['X-Visitor-Token'=>VisitorAccess::token('other@gmail.com')])->assertForbidden();
 DB::table('shared_appointments')->where('id',$a['id'])->update(['status'=>'Completed']);
 $this->patchJson($path,array_merge($review,['revision'=>1]),appointmentHeaders())->assertConflict();
});

it('keeps earlier-slot preferences owned, revisioned and cleared on schedule confirmation',function(){
 $a=$this->verifiedPostJson('/api/appointments',appointmentInput())->json('appointment');$path='/api/appointments/'.$a['id'].'/waitlist';
 $visitor=['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')];
 $this->patchJson($path,['enabled'=>true,'revision'=>0])->assertUnauthorized();
 $this->patchJson($path,['enabled'=>true,'revision'=>0],['X-Visitor-Token'=>VisitorAccess::token('other@gmail.com')])->assertForbidden();
 $this->patchJson($path,['enabled'=>true,'revision'=>0],$visitor)->assertOk()->assertJsonPath('appointment.earlierSlotOptIn',true)->assertJsonPath('appointment.revision',1);
 $this->patchJson($path,['enabled'=>false,'revision'=>0],$visitor)->assertConflict();
 $this->patchJson('/api/appointments/'.$a['id'],['date'=>'2026-10-14','time'=>'10:00','revision'=>1],appointmentHeaders())->assertOk()->assertJsonPath('appointment.earlierSlotOptIn',false);
 DB::table('shared_appointments')->where('id',$a['id'])->update(['status'=>'Cancelled']);
 $this->patchJson($path,['enabled'=>true,'revision'=>2],$visitor)->assertConflict();
});
it('allows authorized staff to assign dated follow-up tasks visible only to the owner',function(){
 $a=$this->verifiedPostJson('/api/appointments',appointmentInput())->json('appointment');$path='/api/appointments/'.$a['id'].'/follow-up-task';
 $task=['text'=>'Bring a signed original.','dueDate'=>'2026-10-20','completed'=>false,'revision'=>0];
 $this->patchJson($path,$task,['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->assertUnauthorized();
 $this->patchJson($path,array_merge($task,['text'=>'  ']),appointmentHeaders())->assertUnprocessable();
 $this->patchJson($path,array_merge($task,['dueDate'=>'invalid']),appointmentHeaders())->assertUnprocessable();
 $this->patchJson($path,$task,appointmentHeaders())->assertOk()->assertJsonPath('appointment.followUpTask.completed',false);
 $this->patchJson($path,$task,appointmentHeaders())->assertConflict();
 $this->getJson('/api/appointments/visit/'.$a['visitId'],['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->assertOk()->assertJsonPath('appointment.followUpTask.text','Bring a signed original.');
 $this->patchJson($path,array_merge($task,['revision'=>1,'completed'=>true]),appointmentHeaders())->assertOk()->assertJsonPath('appointment.followUpTask.completed',true);
 DB::table('shared_appointments')->where('id',$a['id'])->update(['service_key'=>'incident_report']);
 $this->patchJson($path,array_merge($task,['revision'=>2]),appointmentHeaders())->assertForbidden();
});
it('publishes service notices only after an authorized service update',function(){
 $service=['label'=>'Good Moral','desc'=>'Description','icon'=>'home','requirements'=>[],'templates'=>[],'announcement'=>'Bring your updated clearance.'];
 $this->putJson('/api/services/good_moral',$service,appointmentHeaders())->assertForbidden();
 DB::table('staff_users')->where('id','admin')->update(['confidential_approver'=>true]);
 $this->putJson('/api/services/good_moral',$service,appointmentHeaders())->assertOk();
 $catalog=$this->getJson('/api/services')->assertOk()->json('services');
 expect(collect($catalog)->firstWhere('key','good_moral')['announcement'])->toBe('Bring your updated clearance.');
});

it('reports priority queue positions consistently with the estimate order',function(){
 foreach([['id'=>'ordinary','isPWD'=>false],['id'=>'priority','isPWD'=>true]] as $q){$q+=['status'=>'Waiting','source'=>'Walk-in','createdAt'=>'2026-10-13T09:00:00+08:00'];DB::table('queues')->insert(['id'=>$q['id'],'visitor_type'=>'Student','source'=>'Walk-in','status'=>'Waiting','service_label_text'=>'Service','portal_payload'=>\App\Support\QueueData::write($q),'created_at'=>now(),'updated_at'=>now()]);}
 $this->getJson('/api/walk-in-capacity')->assertOk()->assertJsonPath('peopleAhead.priority',0)->assertJsonPath('peopleAhead.ordinary',1)->assertJsonPath('waitEstimates.priority',0)->assertJsonPath('waitEstimates.ordinary',10)->assertJsonPath('sampleCount',0);
});
it('refreshes follow-up tasks and appointment milestones on the authorized live queue',function(){
 $result=readyFlowVisit();$a=$result['appointment'];$q=$result['queue'];
 $this->patchJson('/api/appointments/'.$a['id'].'/follow-up-task',['text'=>'Bring the original.','dueDate'=>'2026-10-20','completed'=>false,'revision'=>$a['revision']],appointmentHeaders())->assertOk();
 $this->getJson('/api/visits/'.$q['visitId'],['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->assertOk()->assertJsonPath('queue.followUpTask.text','Bring the original.')->assertJsonStructure(['queue'=>['appointmentProgress'=>['createdAt','scheduledConfirmedAt']]]);
 $this->getJson('/api/visits/'.$q['visitId'],['X-Visitor-Token'=>VisitorAccess::token('other@gmail.com')])->assertForbidden();
});

it('authorizes appointment-only realtime channels for their verified owner',function(){
 config(['broadcasting.connections.reverb.key'=>'test-key','broadcasting.connections.reverb.secret'=>'test-secret']);
 $a=$this->verifiedPostJson('/api/appointments',appointmentInput())->json('appointment');
 $data=['socket_id'=>'123.456','channel_name'=>'private-visit-'.$a['visitId']];
 $this->postJson('/api/realtime/auth',$data)->assertUnauthorized();
 $this->postJson('/api/realtime/auth',$data,['X-Visitor-Token'=>VisitorAccess::token('other@gmail.com')])->assertForbidden();
 $this->postJson('/api/realtime/auth',$data,['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->assertOk()->assertJsonPath('auth','test-key:'.hash_hmac('sha256','123.456:'.$data['channel_name'],'test-secret'));
});
it('returns current queue milestones without reusing milestones after another visit is arranged',function(){
 $result=readyFlowVisit();$q=$result['queue'];$headers=appointmentHeaders();
 $this->patchJson('/api/queue/'.$q['id'],['status'=>'Called'],$headers)->assertOk();
 $this->patchJson('/api/queue/'.$q['id'],['status'=>'Serving'],$headers)->assertOk();
 $path='/api/appointments/visit/'.$q['visitId'];$visitor=['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')];
 $this->getJson($path,$visitor)->assertOk()->assertJsonStructure(['appointment'=>['checkedInAt','calledAt','servingAt']]);
 $this->postJson('/api/queue/'.$q['id'].'/follow-up',['reason'=>'Bring another signed document'],$headers)->assertOk();
 $a=$this->getJson($path,$visitor)->assertOk()->json('appointment');
 expect($a['status'])->toBe('Requested');expect(array_key_exists('checkedInAt',$a))->toBeFalse();expect(array_key_exists('servingAt',$a))->toBeFalse();
});

it('loads history only after verification and only for the verified owner',function(){
 $a=$this->verifiedPostJson('/api/appointments',appointmentInput())->json('appointment');
 $this->getJson('/api/history')->assertUnauthorized();
 $this->getJson('/api/history',['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->assertOk()->assertJsonPath('email','student@gmail.com')->assertJsonPath('appointments.0.id',$a['id']);
 $this->getJson('/api/history',['X-Visitor-Token'=>VisitorAccess::token('other@gmail.com')])->assertOk()->assertJsonCount(0,'appointments')->assertJsonCount(0,'queues');
});
