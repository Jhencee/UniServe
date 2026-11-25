<?php
use App\Support\{StaffAuth,VisitorAccess};
use Carbon\CarbonImmutable;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\{DB,Schema,Hash};
beforeEach(function(){
 Schema::create('staff_users',function(Blueprint $t){$t->string('id')->primary();$t->string('full_name');$t->string('role');$t->string('password_hash');$t->boolean('is_active');$t->boolean('confidential_access')->default(false);});
 DB::table('staff_users')->insert(['id'=>'admin','full_name'=>'Admin','role'=>'ADMIN','password_hash'=>Hash::make('FixturePassword123'),'is_active'=>true]);
 Schema::create('queue_counters',function(Blueprint $t){$t->string('day_key');$t->string('prefix');$t->integer('last_seq')->default(0);$t->primary(['day_key','prefix']);});
 Schema::create('queues',function(Blueprint $t){$t->string('id')->primary();$t->string('queue_number')->nullable();$t->string('prefix')->nullable();$t->integer('seq')->nullable();$t->string('visitor_type');$t->string('visitor_name')->nullable();$t->string('service_label_text');$t->string('contact')->nullable();$t->string('id_number')->nullable();$t->string('source');$t->string('status');$t->json('portal_payload');$t->string('assigned_admin_id')->nullable();$t->string('assigned_admin_name')->nullable();$t->timestamp('called_at')->nullable();$t->timestamp('serving_at')->nullable();$t->timestamp('completed_at')->nullable();$t->timestamps();});
 foreach(['2026_10_12_000003_office_calendar.php','2026_10_12_000004_audit_and_notifications.php','2026_10_13_000005_confidential_access.php','2026_10_14_000006_shared_appointments.php','2026_10_14_000007_appointment_submission_key.php','2026_10_15_000008_remaining_flows.php','2026_10_15_000009_encrypt_queue_details.php'] as $file)(require database_path('migrations/'.$file))->up();
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-13 10:00','Asia/Manila'));
});
afterEach(function(){CarbonImmutable::setTestNow();foreach(['queue_counters','shared_chats','shared_system_settings','shared_transactions','shared_visitor_log','shared_appointments','service_catalog','confidential_requests','confidential_cases','notification_outbox','system_audit','calendar_audit','office_calendar','queues','staff_users'] as $t)Schema::dropIfExists($t);});
it('supports verified institutional email without allowing mailbox impersonation',function(){
 $d=appointmentInput();$d['email']='student@iskolarngbayan.pup.edu.ph';
 $this->verifiedPostJson('/api/appointments',$d)->assertCreated();
 $this->postJson('/api/appointments',$d,['X-Visitor-Token'=>VisitorAccess::token('other@university.edu.ph')])->assertForbidden();
});
it('requires the student domain while allowing guest email addresses',function(){
 $d=appointmentInput();$d['type']='Student';
 $this->verifiedPostJson('/api/appointments',$d)->assertUnprocessable()->assertJsonValidationErrors('email');
 $d['type']='Guest';
 $this->verifiedPostJson('/api/appointments',$d)->assertCreated();
});
it('releases an elapsed unconfirmed request once without classifying it as a no-show',function(){
 $a=$this->verifiedPostJson('/api/appointments',appointmentInput())->assertCreated()->json('appointment');
 CarbonImmutable::setTestNow(CarbonImmutable::parse($a['date'].' '.$a['time'],'Asia/Manila')->addMinute());
 expect(\App\Support\VisitProcess::expireRequests())->toBe(1);
 expect(\App\Support\VisitProcess::expireRequests())->toBe(0);
 $this->getJson('/api/appointments/visit/'.$a['requestReference'],['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->assertOk()->assertJsonPath('appointment.status','Requested')->assertJsonPath('appointment.date',null)->assertJsonPath('appointment.needsRescheduling',true);
 expect(DB::table('notification_outbox')->where('kind','request-expired')->count())->toBe(1);
});
it('rejects early arrival without an audited staff override and preserves scheduled call ordering',function(){
 $a=$this->verifiedPostJson('/api/appointments',appointmentInput())->json('appointment');$h=appointmentHeaders();
 $this->patchJson('/api/appointments/'.$a['id'],['date'=>'2026-10-13','time'=>'15:00','revision'=>0],$h)->assertOk();
 $this->postJson('/api/appointments/'.$a['id'].'/check-in',[],$h)->assertConflict();
 $this->postJson('/api/appointments/'.$a['id'].'/check-in',['arrivalOverrideReason'=>'Visitor requires early assisted check-in'],$h)->assertOk();
 $this->postJson('/api/queue/call-next',[],$h)->assertConflict();
 expect(DB::table('system_audit')->where('action','like','Arrival window overridden:%')->count())->toBe(1);
});
it('lets only the verified visitor replace a rejected document and preserves its encrypted history',function(){
 $pdf='data:application/pdf;base64,'.base64_encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");
 $d=appointmentInput();$d['attachments']=[['name'=>'original.pdf','dataUrl'=>$pdf]];
 $a=$this->verifiedPostJson('/api/appointments',$d)->assertCreated()->json('appointment');$path='/api/appointments/'.$a['id'].'/documents/0';
 $this->patchJson($path,['status'=>'Needs correction','reason'=>'Upload a signed copy','revision'=>0],appointmentHeaders())->assertOk();
 $replacement=['name'=>'corrected.pdf','dataUrl'=>$pdf,'revision'=>1];
 $this->putJson($path,$replacement,['X-Visitor-Token'=>VisitorAccess::token('other@gmail.com')])->assertForbidden();
 $this->putJson($path,$replacement,appointmentHeaders())->assertForbidden();
 $this->putJson($path,$replacement,['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->assertOk()->assertJsonPath('appointment.attachments.0.review.status','Pending review')->assertJsonMissingPath('appointment.documentVersions');
 $this->putJson($path,$replacement,['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->assertConflict();
 $payload=DB::table('shared_appointments')->where('id',$a['id'])->value('payload');expect($payload)->not->toContain('original.pdf');
 $raw=json_decode(\Illuminate\Support\Facades\Crypt::decryptString($payload),true);expect($raw['documentVersions'][0][0]['name'])->toBe('original.pdf');
 $this->patchJson('/api/appointments/'.$a['id'].'/waitlist',['enabled'=>true,'revision'=>2],['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->assertOk();
 $this->getJson('/api/appointments',appointmentHeaders())->assertOk()->assertJsonPath('appointments.0.documentVersions.0.0.name','original.pdf');
 $this->getJson('/api/appointments/'.$a['id'].'/document-history',['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->assertUnauthorized();
 $this->getJson('/api/appointments/'.$a['id'].'/document-history',appointmentHeaders())->assertOk()->assertJsonPath('versions.0.0.name','original.pdf');
});
it('accepts additional requirements only from the verified visitor and allows staff review',function(){
 $pdf='data:application/pdf;base64,'.base64_encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF");
 $input=appointmentInput();$input['type']='Guest';
 $a=$this->verifiedPostJson('/api/appointments',$input)->assertCreated()->json('appointment');
 $path='/api/appointments/'.$a['id'].'/documents';$file=['name'=>'missing.pdf','dataUrl'=>$pdf,'revision'=>$a['revision']];
 $this->postJson($path,$file)->assertUnauthorized();
 $this->postJson($path,$file,['X-Visitor-Token'=>VisitorAccess::token('other@gmail.com')])->assertForbidden();
 $this->postJson($path,$file,appointmentHeaders())->assertForbidden();
 $this->postJson($path,$file,['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->assertOk()->assertJsonPath('appointment.attachments.0.review.status','Pending review');
 $this->postJson($path,$file,['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->assertConflict();
 $this->patchJson($path.'/0',['status'=>'Accepted','revision'=>$a['revision']+1],appointmentHeaders())->assertOk()->assertJsonPath('appointment.attachments.0.review.status','Accepted');
});
it('keeps multiple follow-up tasks with owners history and mandatory completion notes',function(){
 $a=$this->verifiedPostJson('/api/appointments',appointmentInput())->json('appointment');$path='/api/appointments/'.$a['id'].'/follow-up-task';$h=appointmentHeaders();
 $task=['text'=>'Bring the original','dueDate'=>'2026-10-20','completed'=>false,'ownerId'=>'admin','revision'=>0];
 $a=$this->patchJson($path,$task,$h)->assertOk()->json('appointment');$taskId=$a['followUpTasks'][0]['id'];
 $task['text']='Attend follow-up consultation';$task['revision']=1;
 $this->patchJson($path,$task,$h)->assertOk()->assertJsonCount(2,'appointment.followUpTasks');
 $task['taskId']=$taskId;$task['revision']=2;$task['completed']=true;
 $this->patchJson($path,$task,$h)->assertUnprocessable();
 $task['completionNotes']='Original checked at the counter';
 $this->patchJson($path,$task,$h)->assertOk()->assertJsonCount(2,'appointment.followUpTasks')->assertJsonCount(2,'appointment.followUpTasks.0.history')->assertJsonPath('appointment.followUpTasks.0.completed',true)->assertJsonPath('appointment.followUpTasks.1.completed',false);
});
it('requires staff authentication and an identity check for no-email assisted intake',function(){
 $d=['assisted'=>true,'visitorType'=>'Guest','serviceKey'=>'good_moral','serviceLabel'=>'Good Moral','name'=>'Assisted Visitor','contact'=>'09123456789','email'=>null,'identityCheck'=>'Government ID checked at counter'];
 $this->postJson('/api/visits',$d)->assertUnauthorized();
 $this->postJson('/api/visits',array_merge($d,['identityCheck'=>'']),appointmentHeaders())->assertUnprocessable();
 $this->postJson('/api/visits',$d,appointmentHeaders())->assertCreated()->assertJsonPath('queue.assisted',true)->assertJsonMissingPath('visitToken');
 expect(DB::table('queues')->count())->toBe(1);
});
it('requires resolution and reopening notes and rejects conflicting case edits',function(){
 DB::table('staff_users')->where('id','admin')->update(['confidential_access'=>true]);
 $q=readyFlowVisit('incident_report')['queue'];$h=appointmentHeaders();
 foreach(['Called','Serving','Completed'] as $status){if($status==='Completed')$this->checkQueueRequirements($q['id'],$h);$q=$this->patchJson('/api/queue/'.$q['id'],['status'=>$status],$h)->assertOk()->json('queue');}
 \Illuminate\Support\Facades\Cache::put('conf-unlock:admin:'.$q['transactionId'].':view',true,300);
 $path='/api/service-records/'.$q['transactionId'];
 $change=['escalation'=>'Resolved','ownerId'=>'admin','dueDate'=>'2026-10-20','nextAction'=>'Confirm outcome with visitor','revision'=>0];
 $this->patchJson($path,$change,$h)->assertUnprocessable();
 $change['notes']='Visitor confirmed the concern was addressed';$this->patchJson($path,$change,$h)->assertOk();
 $this->patchJson($path,$change,$h)->assertConflict();
 $change['revision']=1;$change['escalation']='For Review';$change['notes']='';$this->patchJson($path,$change,$h)->assertUnprocessable();
 $change['notes']='Visitor submitted new information';$this->patchJson($path,$change,$h)->assertOk();
 $record=collect($this->getJson('/api/service-records',$h)->json('transactions'))->firstWhere('id',$q['transactionId']);
 expect($record['caseStatus'])->toBe('For Review');expect($record['caseHistory'])->toHaveCount(2);
});
it('delivers document correction notices even when the associated time is past or closed',function(){
 $a=$this->verifiedPostJson('/api/appointments',appointmentInput())->json('appointment');
 \App\Support\VisitProcess::notify(DB::table('shared_appointments')->where('id',$a['id'])->first(),'document-correction','A signed document is required.');
 DB::table('notification_outbox')->update(['scheduled_at'=>'2026-10-11 04:00:00','send_at'=>'2026-10-11 04:00:00']);
 config(['mail.default'=>'smtp','mail.mailers.smtp.username'=>'test','mail.mailers.smtp.password'=>'test']);
 \Illuminate\Support\Facades\Mail::shouldReceive('html')->once()->andReturnNull();
 $this->artisan('notifications:send')->assertSuccessful();
 expect(DB::table('notification_outbox')->value('status'))->toBe('sent');
});
function appointmentHeaders(){return ['Authorization'=>'Bearer '.StaffAuth::token(DB::table('staff_users')->where('id','admin')->first())];}
function appointmentInput(){
 $day=CarbonImmutable::now('Asia/Manila')->startOfDay();$slots=[];
 while(!$slots){$slots=\App\Support\AppointmentSlots::slots($day->toDateString(),'Office of Student Services');if(!$slots)$day=$day->addDay();}
 return ['office'=>'Office of Student Services','date'=>$day->toDateString(),'time'=>$slots[0],'type'=>'Guest','name'=>'Student Name','email'=>'student@gmail.com','contact'=>'09123456789','serviceKey'=>'good_moral','isPWD'=>true,'attachments'=>[]];}
it('requires verification of the submitted Gmail when creating an appointment',function(){
 $this->postJson('/api/appointments',appointmentInput())->assertUnauthorized();
 $this->postJson('/api/appointments',appointmentInput(),['X-Visitor-Token'=>VisitorAccess::token('wrong@gmail.com')])->assertForbidden();
});
function readyFlowVisit(string $service='good_moral'):array{
 $d=appointmentInput();$d['serviceKey']=$service;
 $a=test()->verifiedPostJson('/api/appointments',$d)->assertCreated()->json('appointment');
 test()->patchJson('/api/appointments/'.$a['id'],['date'=>'2026-10-13','time'=>'10:30','revision'=>0],appointmentHeaders())->assertOk();
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-13 10:30','Asia/Manila'));
 return test()->postJson('/api/appointments/'.$a['id'].'/check-in',['arrivalOverrideReason'=>'Fixture arrival reviewed by staff'],appointmentHeaders())->assertOk()->json();
}
it('handles a verified document pickup without creating a second transaction',function(){
 Schema::table('queues',fn(Blueprint $table)=>$table->dropColumn('updated_at'));
 $q=readyFlowVisit()['queue'];$staff=appointmentHeaders();$visitor=['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')];$path='/api/queue/'.$q['id'];
 $this->patchJson($path,['status'=>'Called'],$staff)->assertOk();$this->patchJson($path,['status'=>'Serving'],$staff)->assertOk();$this->checkQueueRequirements($q['id'],$staff);
 $q=$this->patchJson($path,['status'=>'Completed','documentPreparation'=>true],$staff)->assertOk()->assertJsonPath('queue.pickupStatus','Preparing')->json('queue');$record='/api/service-records/'.$q['transactionId'].'/pickup';$join='/api/visits/'.$q['visitId'].'/pickup';
 $this->getJson('/api/service-records',$staff)->assertOk()->assertJsonPath('transactions.0.pickupStatus','Preparing');
 $this->getJson('/api/visits/'.$q['visitId'],$visitor)->assertOk()->assertJsonPath('queue.pickupStatus','Preparing');
 $this->postJson($join,[],$visitor)->assertConflict();
 $this->patchJson($record,['status'=>'Ready'])->assertUnauthorized();$this->patchJson($record,['status'=>'Ready'],$staff)->assertOk()->assertJsonPath('emailQueued',true);
 $notice=DB::table('notification_outbox')->where('kind','document-ready')->first();expect($notice)->not->toBeNull();
 $this->getJson('/api/service-records',$staff)->assertOk()->assertJsonPath('transactions.0.pickupEmailStatus','pending');
 $mail=\App\Support\PrivateNotification::read($notice);expect($mail['recipient'])->toBe('student@gmail.com')->and($mail['subject'])->toBe('Document ready for pickup')->and($mail['body'])->toContain($q['visitId'],'Check My Visit');
 expect($notice->body)->not->toContain('student@gmail.com',$q['visitId']);
 $this->patchJson($record,['status'=>'Ready'],$staff)->assertOk()->assertJsonPath('emailQueued',false);expect(DB::table('notification_outbox')->where('kind','document-ready')->count())->toBe(1);
 $this->postJson($join,[],['X-Visitor-Token'=>VisitorAccess::token('other@gmail.com')])->assertForbidden();
 $pickup=$this->postJson($join,[],$visitor)->assertCreated()->json('queue');
 expect($pickup['pickupOfVisitId'])->toBe($q['visitId']);expect($pickup['pickupTransactionId'])->toBe($q['transactionId']);
 $this->getJson('/api/service-records',$staff)->assertOk()->assertJsonPath('transactions.0.firstVisit.visitId',$q['visitId'])->assertJsonPath('transactions.0.pickupVisit.visitId',$pickup['visitId'])->assertJsonPath('transactions.0.pickupVisit.status','Waiting')->assertJsonMissingPath('transactions.0.pickupVisit.email');
 $this->getJson('/api/visits/'.$pickup['visitId'],$visitor)->assertOk()->assertJsonPath('queue.pickupProgress.original.visitId',$q['visitId'])->assertJsonPath('queue.pickupProgress.pickup.visitId',$pickup['visitId'])->assertJsonPath('queue.pickupProgress.documentStatus','Ready');
 $this->patchJson($record,['status'=>'Claimed','identityCheck'=>'Student ID checked'],$staff)->assertConflict();
 $this->getJson('/api/queue',$staff)->assertOk()->assertJsonFragment(['required'=>2,'checked'=>0,'ready'=>false]);
 $this->postJson($join,[],$visitor)->assertOk()->assertJsonPath('queue.id',$pickup['id']);
 $this->patchJson('/api/queue/'.$pickup['id'],['status'=>'Called'],$staff)->assertOk();$this->patchJson('/api/queue/'.$pickup['id'],['status'=>'Serving'],$staff)->assertOk();$this->patchJson('/api/queue/'.$pickup['id'],['status'=>'Completed'],$staff)->assertConflict();
 $checks='/api/queue/'.$pickup['id'].'/requirements';
 $this->patchJson($checks,['serviceKey'=>$pickup['serviceKey'],'requirement'=>'Document claimed','checked'=>true,'identityCheck'=>'Student ID checked'],$staff)->assertConflict();
 $this->patchJson($checks,['serviceKey'=>$pickup['serviceKey'],'requirement'=>'Identity verified','checked'=>true],$staff)->assertOk()->assertJsonPath('queue.requirementReadiness.ready',false);
 $this->patchJson($checks,['serviceKey'=>$pickup['serviceKey'],'requirement'=>'Document claimed','checked'=>true],$staff)->assertUnprocessable();
 $this->patchJson($checks,['serviceKey'=>$pickup['serviceKey'],'requirement'=>'Document claimed','checked'=>true,'identityCheck'=>'Student ID checked'],$staff)->assertOk()->assertJsonPath('queue.requirementReadiness.ready',true);
 expect(DB::table('notification_outbox')->where('kind','document-ready')->value('status'))->toBe('cancelled');
 $this->getJson('/api/visits/'.$pickup['visitId'],$visitor)->assertOk()->assertJsonPath('queue.pickupStatus','Claimed');
 $this->patchJson($checks,['serviceKey'=>$pickup['serviceKey'],'requirement'=>'Document claimed','checked'=>false],$staff)->assertConflict();
 $this->patchJson('/api/queue/'.$pickup['id'],['status'=>'Completed'],$staff)->assertOk();
 $this->postJson('/api/queue/'.$q['id'].'/feedback',['rating'=>5],$visitor)->assertOk();
 $this->postJson('/api/queue/'.$pickup['id'].'/feedback',['rating'=>5],$visitor)->assertConflict();
 $this->getJson('/api/visits/'.$q['visitId'],$visitor)->assertOk()->assertJsonPath('queue.feedback.rating',5);
 $this->getJson('/api/service-records',$staff)->assertOk()->assertJsonPath('transactions.0.pickupVisit.status','Completed')->assertJsonPath('transactions.0.pickupStatus','Claimed');
 expect(DB::table('shared_transactions')->count())->toBe(1);
 $this->patchJson($record,['status'=>'Claimed','identityCheck'=>'ID checked'],$staff)->assertConflict();
 $this->getJson('/api/visits/'.$q['visitId'],$visitor)->assertOk()->assertJsonPath('queue.pickupStatus','Claimed');
 $this->getJson('/api/visits/'.$q['visitId'],$visitor)->assertOk()->assertJsonPath('queue.pickupProgress.pickup.visitId',$pickup['visitId'])->assertJsonPath('queue.pickupProgress.documentStatus','Claimed');
 $this->postJson('/api/report-data',['kind'=>'transaction','id'=>$q['transactionId'],'includeConf'=>false],$staff)->assertOk()->assertJsonPath('transactions.0.pickupStatus','Claimed')->assertJsonPath('transactions.0.pickupIdentityCheck','Student ID checked')->assertJsonPath('transactions.0.pickupVisit.visitId',$pickup['visitId'])->assertJsonPath('transactions.0.pickupVisit.status','Completed')->assertJsonMissingPath('transactions.0.pickupVisit.email');
 $this->postJson($join,[],$visitor)->assertConflict();
});
it('keeps check-in, service and completion times consistent across visitor log and reports',function(){
 $q=readyFlowVisit()['queue'];$staff=appointmentHeaders();$path='/api/queue/'.$q['id'];
 CarbonImmutable::setTestNow(CarbonImmutable::parse($q['checkedInAt'])->addMinutes(5));
 $this->patchJson($path,['status'=>'Called'],$staff)->assertOk();
 CarbonImmutable::setTestNow(CarbonImmutable::parse($q['checkedInAt'])->addMinutes(10));
 $this->patchJson($path,['status'=>'Serving'],$staff)->assertOk();$this->checkQueueRequirements($q['id'],$staff);
 CarbonImmutable::setTestNow(CarbonImmutable::parse($q['checkedInAt'])->addMinutes(25));
 $completed=$this->patchJson($path,['status'=>'Completed','documentPreparation'=>true],$staff)->assertOk()->json('queue');
 $record=$this->getJson('/api/service-records',$staff)->assertOk()->json();
 expect($record['visitorLog'][0]['timeIn'])->toBe($q['checkedInAt'])->and($record['transactions'][0]['waitingTimeMin'])->toEqual(10)->and($record['transactions'][0]['serviceTimeMin'])->toEqual(15)->and($record['transactions'][0]['totalTimeMin'])->toEqual(25)->and($record['transactions'][0]['firstVisit']['completedAt'])->toBe($completed['completedAt']);
 $log=DB::table('shared_visitor_log')->where('queue_id',$q['id'])->first();$stored=json_decode(\Illuminate\Support\Facades\Crypt::decryptString($log->payload),true);$stored['timeIn']=$completed['servingAt'];DB::table('shared_visitor_log')->where('id',$log->id)->update(['payload'=>\Illuminate\Support\Facades\Crypt::encryptString(json_encode($stored))]);
 $this->getJson('/api/service-records',$staff)->assertOk()->assertJsonPath('visitorLog.0.timeIn',$q['checkedInAt']);
 $this->postJson('/api/report-data',['kind'=>'logbook','includeConf'=>false],$staff)->assertOk()->assertJsonPath('visitorLog.0.timeIn',$q['checkedInAt']);
});
it('sends a document ready email using the shared office template',function(){
 \Illuminate\Support\Facades\Queue::fake();$q=readyFlowVisit()['queue'];$staff=appointmentHeaders();$path='/api/queue/'.$q['id'];
 $this->patchJson($path,['status'=>'Called'],$staff)->assertOk();$this->patchJson($path,['status'=>'Serving'],$staff)->assertOk();$this->checkQueueRequirements($q['id'],$staff);
 $q=$this->patchJson($path,['status'=>'Completed','documentPreparation'=>true],$staff)->assertOk()->json('queue');
 DB::table('notification_outbox')->update(['status'=>'cancelled']);config(['mail.default'=>'smtp','mail.mailers.smtp.username'=>'fixture','mail.mailers.smtp.password'=>'fixture']);
 $this->patchJson('/api/service-records/'.$q['transactionId'].'/pickup',['status'=>'Ready'],$staff)->assertOk()->assertJsonPath('emailQueued',true);
 \Illuminate\Support\Facades\Queue::assertPushed(\App\Jobs\DeliverAppointmentNotifications::class);
 DB::table('notification_outbox')->where('kind','document-ready')->update(['status'=>'paused']);
 \Illuminate\Support\Facades\Mail::shouldReceive('html')->once()->withArgs(fn($html,$callback)=>str_contains($html,'Document ready for pickup')&&str_contains($html,'UniServe')&&str_contains($html,$q['visitId'])&&str_contains($html,'<ol')&&str_contains($html,'<strong>Check My Visit</strong>')&&str_contains($html,'<strong>valid ID</strong>')&&is_callable($callback))->andReturnNull();
 $this->artisan('notifications:send')->assertSuccessful();expect(DB::table('notification_outbox')->where('kind','document-ready')->value('status'))->toBe('sent');
 $this->getJson('/api/service-records',$staff)->assertOk()->assertJsonPath('transactions.0.pickupEmailStatus','sent');
});
it('does not send a stale pickup email after the document is claimed',function(){
 \Illuminate\Support\Facades\Queue::fake();$q=readyFlowVisit()['queue'];$staff=appointmentHeaders();$path='/api/queue/'.$q['id'];
 $this->patchJson($path,['status'=>'Called'],$staff)->assertOk();$this->patchJson($path,['status'=>'Serving'],$staff)->assertOk();$this->checkQueueRequirements($q['id'],$staff);
 $q=$this->patchJson($path,['status'=>'Completed'],$staff)->assertOk()->json('queue');
 DB::table('notification_outbox')->update(['status'=>'cancelled']);config(['mail.default'=>'smtp','mail.mailers.smtp.username'=>'fixture','mail.mailers.smtp.password'=>'fixture']);
 $this->patchJson('/api/service-records/'.$q['transactionId'].'/pickup',['status'=>'Ready'],$staff)->assertOk();
 $row=DB::table('queues')->where('id',$q['id'])->first();$original=\App\Support\QueueData::read($row->portal_payload);$original['pickupStatus']='Claimed';DB::table('queues')->where('id',$q['id'])->update(['portal_payload'=>\App\Support\QueueData::write($original)]);
 \Illuminate\Support\Facades\Mail::shouldReceive('html')->never();$this->artisan('notifications:send')->assertSuccessful();
 expect(DB::table('notification_outbox')->where('kind','document-ready')->value('status'))->toBe('superseded');
});
it('logs arrival at appointment check-in and preserves it through service',function(){
 $r=readyFlowVisit();$q=$r['queue'];$h=appointmentHeaders();
 $readLog=fn()=>json_decode(\Illuminate\Support\Facades\Crypt::decryptString(DB::table('shared_visitor_log')->where('queue_id',$q['id'])->value('payload')),true);
 $arrival=$readLog()['timeIn'];
 expect($arrival)->toBe($q['checkedInAt']);expect($readLog()['timeOut'])->toBeNull();
 $this->postJson('/api/appointments/'.$r['appointment']['id'].'/check-in',[],$h)->assertOk();
 expect(DB::table('shared_visitor_log')->count())->toBe(1);
 CarbonImmutable::setTestNow(CarbonImmutable::now()->addMinutes(10));
 $this->patchJson('/api/queue/'.$q['id'],['status'=>'Called'],$h)->assertOk();
 $this->patchJson('/api/queue/'.$q['id'],['status'=>'Serving'],$h)->assertOk();
 expect($readLog()['timeIn'])->toBe($arrival);
 $this->checkQueueRequirements($q['id'],$h);
 $this->patchJson('/api/queue/'.$q['id'],['status'=>'Completed'],$h)->assertOk();
 expect($readLog()['timeIn'])->toBe($arrival);expect($readLog()['timeOut'])->not->toBeNull();
 expect(DB::table('shared_visitor_log')->count())->toBe(1);
});

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
 $this->patchJson('/api/appointments/'.$a['id'],['date'=>'2026-10-13','time'=>'11:00','revision'=>0],$headers)->assertOk();
 $other=$this->postJson('/api/appointments/'.$a['id'].'/check-in',[],$headers)->assertOk()->json('queue');
 $this->postJson('/api/queue/call-next',[],$headers)->assertOk();
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-13 11:00','Asia/Manila'));
 $headers=appointmentHeaders(); // A new staff session is required after the simulated idle/day boundary.
 $this->postJson('/api/queue/call-next',[],$headers)->assertConflict();
 $this->patchJson('/api/queue/'.$other['id'],['status'=>'Called'],$headers)->assertConflict();
 $this->patchJson('/api/queue/'.$q['id'],['status'=>'Serving'],$headers)->assertOk();
 $this->checkQueueRequirements($q['id'],$headers);
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
 expect($log['timeOut'])->toBeNull();expect($log['serviceHistory'][0]['serviceKey'])->toBe('good_moral');
 $this->patchJson($path,['status'=>'Called'],$h)->assertOk();$this->patchJson($path,['status'=>'Serving'],$h)->assertOk();$this->checkQueueRequirements($q['id'],$h);$this->patchJson($path,['status'=>'Completed'],$h)->assertOk();
 $this->getJson('/api/service-records',$h)->assertJsonPath('transactions.0.serviceHistory.0.serviceKey','good_moral');
});
it('returns absent visitors with a new ordering timestamp',function(){
 $q=readyFlowVisit()['queue'];$path='/api/queue/'.$q['id'];$h=appointmentHeaders();
 $this->patchJson($path,['status'=>'Called'],$h)->assertOk();$this->patchJson($path,['status'=>'Skipped'],$h)->assertOk();
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-13 11:00','Asia/Manila'));
 $h=appointmentHeaders(); // A new staff session is required after the simulated idle/day boundary.
 $returned=$this->patchJson($path,['status'=>'Waiting'],$h)->assertOk()->json('queue.queueEnteredAt');
 expect(CarbonImmutable::parse($returned)->setTimezone('Asia/Manila')->format('Y-m-d H:i'))->toBe('2026-10-13 11:00');
});
it('recovers unfinished appointments without duplicating the queue or losing history',function(){
 $r=readyFlowVisit();$q=$r['queue'];$h=appointmentHeaders();
 $this->patchJson('/api/queue/'.$q['id'],['status'=>'Called'],$h)->assertOk();$this->patchJson('/api/queue/'.$q['id'],['status'=>'Serving'],$h)->assertOk();
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-14 09:00','Asia/Manila'));
 $h=appointmentHeaders(); // A new staff session is required after the simulated idle/day boundary.
 \App\Support\QueueDayClosure::run();
 $a=DB::table('shared_appointments')->first();
 $this->patchJson('/api/appointments/'.$a->id,['date'=>'2026-10-14','time'=>'10:00','revision'=>$a->revision],$h)->assertOk();
 $this->getJson('/api/appointments/visit/'.$a->visit_id,$h)->assertJsonPath('queue',null);
 $this->patchJson('/api/queue/'.$q['id'],['status'=>'Waiting'],$h)->assertConflict();
 $this->postJson('/api/appointments/'.$a->id.'/check-in',['arrivalOverrideReason'=>'Fixture arrival reviewed by staff'],$h)->assertOk()->assertJsonPath('queue.id',$q['id'])->assertJsonPath('queue.serviceHistory.0.outcome','Unfinished');
 expect(DB::table('queues')->count())->toBe(1);
});
it('arranges a follow-up under the same Visit ID and retains uploads',function(){
 $r=readyFlowVisit();$q=$r['queue'];$h=appointmentHeaders();
 $a=$this->postJson('/api/queue/'.$q['id'].'/follow-up',['reason'=>'Bring the remaining requirements tomorrow'],$h)->assertOk()->assertJsonPath('appointment.visitId',$q['visitId'])->assertJsonPath('queue.status','Unfinished')->assertJsonPath('appointment.status','Requested')->json('appointment');
 $this->patchJson('/api/appointments/'.$a['id'],['date'=>'2026-10-14','time'=>'10:00','revision'=>$a['revision']],$h)->assertOk();
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-14 10:00','Asia/Manila'));
 $h=appointmentHeaders(); // A new staff session is required after the simulated idle/day boundary.
 $this->postJson('/api/appointments/'.$a['id'].'/check-in',['arrivalOverrideReason'=>'Fixture arrival reviewed by staff'],$h)->assertOk()->assertJsonPath('queue.id',$q['id']);
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
 $this->checkQueueRequirements($q['id'],$h);
 $q=$this->patchJson($path,['status'=>'Completed'],$h)->assertOk()->assertJsonPath('queue.caseStatus','Open')->json('queue');
 $record='/api/service-records/'.$q['transactionId'];
 $this->patchJson($record,['escalation'=>'Resolved','ownerId'=>'admin','dueDate'=>'2026-10-20','nextAction'=>'Confirm resolution with visitor','notes'=>'Concern resolved after review','revision'=>0],$h)->assertForbidden();
 \Illuminate\Support\Facades\Cache::put('conf-unlock:admin:'.$q['transactionId'].':view',true,300);
 $this->patchJson($record,['escalation'=>'Resolved','ownerId'=>'admin','dueDate'=>'2026-10-20','nextAction'=>'Confirm resolution with visitor','notes'=>'Concern resolved after review','revision'=>0],$h)->assertOk();
 $this->getJson('/api/visits/'.$q['visitId'],['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->assertOk()->assertJsonPath('queue.status','Completed')->assertJsonPath('queue.caseStatus','Resolved');
 $this->patchJson($path,['status'=>'Completed'],$h)->assertOk()->assertJsonPath('queue.caseStatus','Resolved');
});
it('reserves a slot for one appointment even when an older configuration allows more',function(){
 $settings=json_decode(DB::table('shared_system_settings')->where('id',1)->value('payload'),true);$settings['appointmentSlotCapacity']=2;
 DB::table('shared_system_settings')->where('id',1)->update(['payload'=>json_encode($settings)]);
 $d=appointmentInput();$query='/api/appointment-slots?'.http_build_query(['date'=>$d['date'],'office'=>$d['office']]);
 $this->verifiedPostJson('/api/appointments',$d)->assertCreated();
 expect($this->getJson($query)->assertOk()->json('slots'))->not->toContain($d['time']);
 $this->verifiedPostJson('/api/appointments',$d)->assertConflict();
});
it('enforces one appointment per slot while saving parallel-service settings',function(){
 DB::table('staff_users')->where('id','admin')->update(['role'=>'SUPER_ADMIN']);
 $settings=['maintenanceMode'=>false,'sessionTimeout'=>30,'gracePeriodMinutes'=>15,'noShowThresholdMinutes'=>60,'appointmentSlotCapacity'=>1,'allowParallelService'=>true];
 $this->putJson('/api/settings',['settings'=>$settings,'revision'=>0],appointmentHeaders())->assertOk()->assertJsonPath('settings.appointmentSlotCapacity',1)->assertJsonPath('settings.allowParallelService',true);
 $settings['appointmentSlotCapacity']=2;
 $this->putJson('/api/settings',['settings'=>$settings,'revision'=>1],appointmentHeaders())->assertUnprocessable();
});
it('marks a recovered but missed booking as no-show and allows another reschedule',function(){
 $r=readyFlowVisit();$q=$r['queue'];$h=appointmentHeaders();
 $a=$this->postJson('/api/queue/'.$q['id'].'/follow-up',['reason'=>'Return with additional documents'],$h)->json('appointment');
 $this->patchJson('/api/appointments/'.$a['id'],['date'=>'2026-10-14','time'=>'10:00','revision'=>$a['revision']],$h)->assertOk();
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-14 11:01','Asia/Manila'));
 $h=appointmentHeaders(); // A new staff session is required after the simulated idle/day boundary.
 $this->artisan('appointments:no-shows')->assertSuccessful();
 $row=DB::table('shared_appointments')->where('id',$a['id'])->first();expect($row->status)->toBe('No-show');
 $this->patchJson('/api/appointments/'.$a['id'],['date'=>'2026-10-15','time'=>'10:00','revision'=>$row->revision],$h)->assertOk();
});
it('records why a visit was not served without creating a completed transaction',function(){
 $q=readyFlowVisit()['queue'];
 $this->patchJson('/api/queue/'.$q['id'],['status'=>'Cancelled','closureReason'=>'Visitor left before service.'],appointmentHeaders())->assertOk()->assertJsonPath('queue.closureReason','Visitor left before service.');
 expect(DB::table('shared_transactions')->count())->toBe(0);expect(DB::table('shared_visitor_log')->count())->toBe(1);
 $log=json_decode(\Illuminate\Support\Facades\Crypt::decryptString(DB::table('shared_visitor_log')->value('payload')),true);expect($log['timeOut'])->not->toBeNull();
});
it('does not let completion retries change the service or owning Admin',function(){
 $q=readyFlowVisit()['queue'];$h=appointmentHeaders();$path='/api/queue/'.$q['id'];
 foreach(['Called','Serving','Completed'] as $status){if($status==='Completed')$this->checkQueueRequirements($q['id'],$h);$this->patchJson($path,['status'=>$status],$h)->assertOk();}
 $this->patchJson($path,['status'=>'Completed','serviceKey'=>'student_id'],$h)->assertConflict();
 $this->patchJson($path,['status'=>'Completed'],$h)->assertOk()->assertJsonPath('queue.assignedAdminId','admin');
 expect(DB::table('shared_transactions')->count())->toBe(1);
});
it('shares submitted requests with Admin and protects visitor retrieval',function(){
 $a=$this->verifiedPostJson('/api/appointments',appointmentInput())->assertCreated()->json('appointment');
 $this->getJson('/api/appointments',appointmentHeaders())->assertOk()->assertJsonPath('appointments.0.visitId',$a['visitId']);
 $this->getJson('/api/appointments/visit/'.($a['visitId']??$a['requestReference']))->assertUnauthorized();
 $this->getJson('/api/appointments/visit/'.($a['visitId']??$a['requestReference']),['X-Visitor-Token'=>VisitorAccess::token('wrong@gmail.com')])->assertForbidden();
 $this->getJson('/api/appointments/visit/'.($a['visitId']??$a['requestReference']),['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->assertOk();
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
 $q=$this->postJson('/api/appointments/'.$a['id'].'/check-in',['arrivalOverrideReason'=>'Fixture arrival reviewed by staff'],appointmentHeaders())->assertOk()->json('queue');
 $this->postJson('/api/appointments/'.$a['id'].'/check-in',['arrivalOverrideReason'=>'Fixture arrival reviewed by staff'],appointmentHeaders())->assertOk()->assertJsonPath('queue.id',$q['id']);
 expect(DB::table('queues')->count())->toBe(1);expect($q['number'])->toBeNull();expect($q['isPWD'])->toBeTrue();
 $path='/api/queue/'.$q['id'];
 $this->patchJson($path,['status'=>'Called'],appointmentHeaders())->assertConflict();
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-13 11:00','Asia/Manila'));
 $this->patchJson($path,['status'=>'Completed'],appointmentHeaders())->assertConflict();
 $this->patchJson($path,['status'=>'Called'],appointmentHeaders())->assertOk();
 $this->patchJson($path,['status'=>'Serving'],appointmentHeaders())->assertOk();
 $this->checkQueueRequirements($q['id'],appointmentHeaders());
 $this->patchJson($path,['status'=>'Completed'],appointmentHeaders())->assertOk();
 $this->patchJson($path,['status'=>'Completed'],appointmentHeaders())->assertOk();
 expect(DB::table('shared_transactions')->count())->toBe(1);expect(DB::table('shared_visitor_log')->count())->toBe(1);
 $this->getJson('/api/service-records',appointmentHeaders())->assertOk()->assertJsonPath('visitorLog.0.name','Student Name');
 expect(DB::table('shared_appointments')->value('status'))->toBe('Completed');
});
it('cancels requests and prevents check-in after cancellation',function(){
 $a=$this->verifiedPostJson('/api/appointments',appointmentInput())->json('appointment');$v=['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')];
 $this->postJson('/api/appointments/'.$a['id'].'/cancel',[],$v)->assertOk();
 $this->postJson('/api/appointments/'.$a['id'].'/check-in',['arrivalOverrideReason'=>'Fixture arrival reviewed by staff'],appointmentHeaders())->assertConflict();
});
it('reuses submission keys instead of creating duplicate requests on retry',function(){
 $d=appointmentInput();$d['submissionKey']=(string)\Illuminate\Support\Str::uuid();
 $a=$this->verifiedPostJson('/api/appointments',$d)->assertCreated()->json('appointment');
 $this->verifiedPostJson('/api/appointments',$d)->assertCreated()->assertJsonPath('appointment.id',$a['id']);
 expect(DB::table('shared_appointments')->count())->toBe(1);
});
it('protects chat ownership and rejects forged chat tokens',function(){
 \Illuminate\Support\Facades\Queue::fake();
 $data=['visitorName'=>'Visitor Name','visitorType'=>'Guest','email'=>'student@gmail.com','text'=>'Hello office'];
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
 $a=\App\Http\Controllers\AppointmentController::present(DB::table('shared_appointments')->where('id',$a['id'])->first());
 $q=$this->postJson('/api/appointments/'.$a['id'].'/check-in',['arrivalOverrideReason'=>'Fixture arrival reviewed by staff'],appointmentHeaders())->json('queue');
 $public=$this->getJson('/api/public-queue')->assertOk()->json('queues.0');
 expect($public)->not->toHaveKeys(['name','email','contact','idNumber','attachments']);
 $this->getJson('/api/visits/'.$a['visitId'])->assertUnauthorized();
 $this->postJson('/api/visits/'.$a['visitId'].'/cancel')->assertUnauthorized();
 $this->getJson('/api/visits/'.$a['visitId'],['X-Visitor-Token'=>VisitorAccess::token('wrong@gmail.com')])->assertForbidden();
 $this->getJson('/api/visits/'.$a['visitId'],['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->assertOk()->assertHeader('Cache-Control','no-store, private');
});
it('requires staff authorization for chat management and settings changes',function(){
 \Illuminate\Support\Facades\Queue::fake();
 $c=$this->postJson('/api/chats',['visitorName'=>'Visitor Name','visitorType'=>'Guest','email'=>'student@gmail.com','text'=>'Hello'],['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->json('chat');
 $this->deleteJson('/api/chats/'.$c['id'])->assertUnauthorized();
 $this->patchJson('/api/chats/'.$c['id'],['status'=>'Closed'],appointmentHeaders())->assertOk();
 $this->putJson('/api/settings',['settings'=>[],'revision'=>0],appointmentHeaders())->assertForbidden();
});
it('requires verified chat email and queues the private code without returning it',function(){
 \Illuminate\Support\Facades\Queue::fake();
 $d=['visitorName'=>'Visitor Name','visitorType'=>'Guest','email'=>'student@gmail.com','text'=>'Hello'];
 $this->postJson('/api/chats',$d)->assertUnauthorized();
 $this->postJson('/api/chats',$d,['X-Visitor-Token'=>VisitorAccess::token('other@gmail.com')])->assertForbidden();
 $headers=['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')];
 $result=$this->postJson('/api/chats',$d,$headers)->assertCreated()->assertJsonMissingPath('chatCode');
 $id=$result->json('chat.id'); $token=$result->json('chatToken');
 $this->getJson('/api/chats/'.$id)->assertUnauthorized();
 $this->getJson('/api/chats/'.$id,['X-Chat-Token'=>$token])->assertOk();
 $jobs=\Illuminate\Support\Facades\Queue::pushed(\App\Jobs\SendChatCode::class);expect($jobs)->toHaveCount(1);
 $code=$jobs->first()->code;expect($jobs->first()->email)->toBe('student@gmail.com');
 $this->postJson('/api/chats/resume',['code'=>$code])->assertOk()->assertJsonPath('chat.id',$id)->assertJsonStructure(['chatToken']);
 $this->postJson('/api/chats/resume',['code'=>str_repeat('A',32)])->assertNotFound();
 $d['attachments']=[['name'=>'test.html','dataUrl'=>'javascript:alert(1)']];
 $this->postJson('/api/chats',$d,$headers)->assertUnprocessable();
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
 $q=$this->postJson('/api/appointments/'.$a['id'].'/check-in',['arrivalOverrideReason'=>'Fixture arrival reviewed by staff'],appointmentHeaders())->assertOk()->json('queue');
 $q['status']='Completed';$q['feedback']=null;
 DB::table('queues')->where('id',$q['id'])->update(['status'=>'Completed','portal_payload'=>\App\Support\QueueData::write($q)]);
 $token=\Illuminate\Support\Facades\Crypt::encryptString(json_encode(['purpose'=>'visit','visitId'=>$q['visitId'],'expires'=>time()+3600]));
 $this->postJson('/api/queue/'.$q['id'].'/feedback',['rating'=>5],['X-Visit-Token'=>$token])->assertOk();
});
it('protects private WebSocket subscriptions and excludes personal records from socket messages',function(){
 config(['reverb.public.host'=>'updates.example.com','reverb.public.port'=>443,'reverb.public.scheme'=>'wss']);
 $this->getJson('/api/realtime/config')->assertOk()->assertJsonPath('host','updates.example.com')->assertJsonPath('port',443)->assertJsonPath('scheme','wss')->assertJsonMissingPath('secret');
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
 $q=$this->postJson('/api/appointments/'.$a['id'].'/check-in',['arrivalOverrideReason'=>'Fixture arrival reviewed by staff'],appointmentHeaders())->assertOk()->json('queue');
 $this->postJson('/api/appointments/'.$a['id'].'/check-in',['arrivalOverrideReason'=>'Fixture arrival reviewed by staff'],appointmentHeaders())->assertOk();
 expect(DB::table('system_audit')->where('action','Appointment checked in')->count())->toBe(1);
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-13 11:00','Asia/Manila'));
 foreach(['Called','Serving','Completed','Completed'] as $status){if($status==='Completed')$this->checkQueueRequirements($q['id'],appointmentHeaders());$this->patchJson('/api/queue/'.$q['id'],['status'=>$status],appointmentHeaders())->assertOk();}
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
 $this->getJson('/api/appointments/visit/'.($a['visitId']??$a['requestReference']),['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->assertOk()->assertJsonPath('appointment.attachments.0.review.reason','Bring a readable signed copy.');
 $this->getJson('/api/appointments/visit/'.($a['visitId']??$a['requestReference']),['X-Visitor-Token'=>VisitorAccess::token('other@gmail.com')])->assertForbidden();
 DB::table('shared_appointments')->where('id',$a['id'])->update(['status'=>'Completed']);
 $this->patchJson($path,array_merge($review,['revision'=>1]),appointmentHeaders())->assertOk()->assertJsonPath('appointment.revision',2);
 DB::table('shared_appointments')->where('id',$a['id'])->update(['status'=>'Cancelled']);
 $this->patchJson($path,array_merge($review,['revision'=>2]),appointmentHeaders())->assertConflict();
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
 $this->getJson('/api/appointments/visit/'.($a['visitId']??$a['requestReference']),['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->assertOk()->assertJsonPath('appointment.followUpTask.text','Bring a signed original.');
 $this->patchJson($path,array_merge($task,['revision'=>1,'completed'=>true,'completionNotes'=>'Original documents checked']),appointmentHeaders())->assertOk()->assertJsonPath('appointment.followUpTask.completed',true);
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
 $first=$this->patchJson('/api/appointments/'.$a['id'].'/follow-up-task',['text'=>'Bring the original.','dueDate'=>'2026-10-20','completed'=>false,'revision'=>$a['revision']],appointmentHeaders())->assertOk()->json('appointment');
 $this->patchJson('/api/appointments/'.$a['id'].'/follow-up-task',['text'=>'Submit the form.','dueDate'=>'2026-10-21','completed'=>false,'revision'=>$first['revision']],appointmentHeaders())->assertOk();
 $this->getJson('/api/visits/'.$q['visitId'],['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->assertOk()->assertJsonPath('queue.followUpTask.text','Submit the form.')->assertJsonCount(2,'queue.followUpTasks')->assertJsonPath('queue.followUpTasks.0.text','Bring the original.')->assertJsonPath('queue.followUpTasks.1.text','Submit the form.')->assertJsonStructure(['queue'=>['appointmentProgress'=>['createdAt','scheduledConfirmedAt']]]);
 $this->getJson('/api/visits/'.$q['visitId'],['X-Visitor-Token'=>VisitorAccess::token('other@gmail.com')])->assertForbidden();
});

it('authorizes appointment-only realtime channels for their verified owner',function(){
 config(['broadcasting.connections.reverb.key'=>'test-key','broadcasting.connections.reverb.secret'=>'test-secret']);
 $a=$this->verifiedPostJson('/api/appointments',appointmentInput())->json('appointment');
 $data=['socket_id'=>'123.456','channel_name'=>'private-visit-'.($a['visitId']??$a['requestReference'])];
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
it('issues the Visit ID only on scheduling and preserves the request reference',function(){
 \Illuminate\Support\Facades\Queue::fake();
 $a=$this->verifiedPostJson('/api/appointments',appointmentInput())->assertCreated()->assertJsonPath('appointment.visitId',null)->json('appointment');
 expect($a['requestReference'])->toStartWith('APT-');
 expect($a['ticketHtml'])->toContain('Request reference','Awaiting schedule confirmation')->not->toContain('VIS-');
 $booked=$this->patchJson('/api/appointments/'.$a['id'],['date'=>'2026-10-14','time'=>'10:00','revision'=>0],appointmentHeaders())->assertOk()->json('appointment');
 expect($booked['visitId'])->toStartWith('VIS-');
 expect($booked['requestReference'])->toBe($a['requestReference']);
 $this->getJson('/api/appointments/visit/'.$a['requestReference'],['X-Visitor-Token'=>VisitorAccess::token('student@gmail.com')])->assertOk()->assertJsonPath('appointment.visitId',$booked['visitId']);
 $rescheduled=$this->patchJson('/api/appointments/'.$a['id'],['date'=>'2026-10-14','time'=>'11:00','revision'=>1],appointmentHeaders())->assertOk()->json('appointment');
 expect($rescheduled['visitId'])->toBe($booked['visitId']);
 $email=\App\Support\OfficeMail::html('Appointment confirmation','');
 expect($email)->not->toContain('ticket-v2','ticket-number');
 \Illuminate\Support\Facades\Queue::assertNotPushed(\App\Jobs\SendVisitTicket::class);
});

it('reserves requested slots and releases them on cancellation',function(){
 $d=appointmentInput();$query='/api/appointment-slots?'.http_build_query(['date'=>$d['date'],'office'=>$d['office']]);
 expect($this->getJson($query)->assertOk()->json('slots'))->toContain($d['time']);
 $a=$this->verifiedPostJson('/api/appointments',$d)->assertCreated()->assertJsonPath('appointment.office',$d['office'])->assertJsonPath('appointment.date',$d['date'])->json('appointment');
 expect($this->getJson($query)->assertOk()->json('slots'))->not->toContain($d['time']);
 $this->verifiedPostJson('/api/appointments',$d)->assertConflict();
 $this->postJson('/api/appointments/'.$a['id'].'/cancel',[],appointmentHeaders())->assertOk();
 expect($this->getJson($query)->assertOk()->json('slots'))->toContain($d['time']);
});
it('isolates office capacity and approves a request in its reserved slot',function(){
 DB::table('shared_system_settings')->where('id',1)->update(['payload'=>json_encode(['appointmentOffices'=>['Office of Student Services','Registrar']])]);
 $d=appointmentInput();$a=$this->verifiedPostJson('/api/appointments',$d)->assertCreated()->json('appointment');
 $other=$d;$other['office']='Registrar';$this->verifiedPostJson('/api/appointments',$other)->assertCreated();
 $path='/api/appointments/'.$a['id'];
 $this->patchJson($path,['date'=>$d['date'],'time'=>$d['time'],'revision'=>0],appointmentHeaders())->assertOk()->assertJsonPath('appointment.status','Booked');
});
it('requires a valid office and future slot on the office calendar',function(){
 $d=appointmentInput();unset($d['office']);$this->verifiedPostJson('/api/appointments',$d)->assertUnprocessable();
 $d=appointmentInput();$d['office']='Invented';$this->verifiedPostJson('/api/appointments',$d)->assertUnprocessable();
 foreach([['2026-10-13','09:00'],['2026-10-14','12:00'],['2026-10-18','09:00'],['2026-10-14','09:15']] as [$date,$time]){
  $d=appointmentInput();$d['date']=$date;$d['time']=$time;$this->verifiedPostJson('/api/appointments',$d)->assertConflict();
 }
});
it('rescheduling releases the previous slot and cannot take another pending request slot',function(){
 $d=appointmentInput();$a=$this->verifiedPostJson('/api/appointments',$d)->assertCreated()->json('appointment');
 $next=appointmentInput();$b=$this->verifiedPostJson('/api/appointments',$next)->assertCreated()->json('appointment');
 $this->patchJson('/api/appointments/'.$a['id'],['date'=>$next['date'],'time'=>$next['time'],'revision'=>0],appointmentHeaders())->assertConflict();
 $free=appointmentInput();$this->patchJson('/api/appointments/'.$a['id'],['date'=>$free['date'],'time'=>$free['time'],'revision'=>0],appointmentHeaders())->assertOk();
 expect($this->getJson('/api/appointment-slots?'.http_build_query(['date'=>$d['date'],'office'=>$d['office']]))->json('slots'))->toContain($d['time']);
});

it('shows staff full slot counts and excludes the appointment being edited',function(){
 $d=appointmentInput();$a=$this->verifiedPostJson('/api/appointments',$d)->assertCreated()->json('appointment');
 $query='/api/appointment-slots?'.http_build_query(['date'=>$d['date'],'office'=>$d['office']]);
 $this->getJson($query)->assertOk()->assertJsonMissingPath('availability');
 $staff=$this->getJson($query,appointmentHeaders())->assertOk()->json('availability');
 $slot=collect($staff)->firstWhere('time',$d['time']);
 expect($slot['status'])->toBe('full')->and($slot['occupied'])->toBe(1)->and($slot['remaining'])->toBe(0)->and($slot['available'])->toBeFalse();
 expect($slot['pending'])->toBe(1)->and($slot['confirmed'])->toBe(0);
 $edited=$this->getJson($query.'&exclude='.$a['id'],appointmentHeaders())->assertOk()->json('availability');
 $slot=collect($edited)->firstWhere('time',$d['time']);
 expect($slot['occupied'])->toBe(0)->and($slot['remaining'])->toBe(1)->and($slot['available'])->toBeTrue();
 $this->getJson($query.'&exclude='.$a['id'],appointmentHeaders())->assertOk()->assertJsonPath('currentReservation.time',$d['time']);
 $this->patchJson('/api/appointments/'.$a['id'],['date'=>$d['date'],'time'=>$d['time'],'revision'=>0],appointmentHeaders())->assertOk();
 $confirmed=collect($this->getJson($query,appointmentHeaders())->assertOk()->json('availability'))->firstWhere('time',$d['time']);
 expect($confirmed['pending'])->toBe(0)->and($confirmed['confirmed'])->toBe(1);
});

it('matches document reviews only to requirements listed for the appointment service',function(){
 $data=appointmentInput();$data['attachments']=[['name'=>'id.pdf','dataUrl'=>'data:application/pdf;base64,'.base64_encode('%PDF-1.4 test')]];
 $a=$this->verifiedPostJson('/api/appointments',$data)->assertCreated()->json('appointment');
 $path='/api/appointments/'.$a['id'].'/documents/0';
 $this->patchJson($path,['status'=>'Accepted','requirement'=>'Invented requirement','revision'=>0],appointmentHeaders())->assertUnprocessable();
 $this->patchJson($path,['status'=>'Accepted','requirement'=>'Valid School ID','revision'=>0],appointmentHeaders())->assertOk()->assertJsonPath('appointment.attachments.0.review.requirement','Valid School ID');
 $this->patchJson($path,['status'=>'Needs correction','reason'=>'Bring a readable copy.','revision'=>1],appointmentHeaders())->assertOk()->assertJsonPath('appointment.attachments.0.review.requirement','Valid School ID');
});
