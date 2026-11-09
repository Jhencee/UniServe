<?php
use App\Support\{StaffAuth,VisitorAccess,QueueData};
use Illuminate\Support\Facades\{DB,Schema,Cache};
use Illuminate\Database\Schema\Blueprint;
use Carbon\CarbonImmutable;

beforeEach(function(){
 Schema::create('staff_users',function(Blueprint $t){$t->string('id')->primary();$t->string('full_name');$t->string('role');$t->string('password_hash');$t->boolean('is_active');$t->boolean('confidential_access')->default(false);$t->boolean('confidential_approver')->default(false);});
 foreach(['admin','head','super'] as $id)DB::table('staff_users')->insert(['id'=>$id,'full_name'=>$id,'role'=>$id==='super'?'SUPER_ADMIN':'ADMIN','password_hash'=>'test','is_active'=>true,'confidential_access'=>$id==='head','confidential_approver'=>$id==='head']);
 Schema::create('queues',function(Blueprint $t){$t->string('id')->primary();$t->string('status');$t->text('portal_payload');$t->timestamps();});
 foreach(['2026_10_12_000003_office_calendar.php','2026_10_12_000004_audit_and_notifications.php','2026_10_14_000006_shared_appointments.php','2026_10_15_000008_remaining_flows.php'] as $file)(require database_path('migrations/'.$file))->up();
 Schema::create('confidential_cases',function(Blueprint $t){$t->string('id')->primary();$t->string('code');$t->string('assigned_admin_id')->nullable();$t->timestamps();});
 Schema::create('confidential_requests',function(Blueprint $t){$t->string('id')->primary();$t->string('case_id');$t->string('requester_id');$t->string('scope');$t->string('status');$t->timestamp('expires_at')->nullable();});
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-13 10:00','Asia/Manila'));
 foreach(['normal'=>'good_moral','private'=>'incident_report'] as $id=>$service){$q=['id'=>$id,'visitId'=>'VIS-'.strtoupper($id),'number'=>'A-'.$id,'status'=>'Waiting','serviceKey'=>$service,'serviceLabel'=>$service,'source'=>'Walk-in','name'=>'Private Visitor','email'=>'owner@gmail.com','contact'=>'09123456789','attachments'=>[['dataUrl'=>'private-file']],'createdAt'=>'2026-10-13T09:00:00+08:00'];DB::table('queues')->insert(['id'=>$id,'status'=>'Waiting','portal_payload'=>QueueData::write($q),'created_at'=>now(),'updated_at'=>now()]);}
});
afterEach(function(){CarbonImmutable::setTestNow();foreach(['confidential_requests','confidential_cases','queues','staff_users','office_calendar','calendar_audit','system_audit','notification_outbox','shared_appointments','shared_transactions','shared_visitor_log','shared_chats','shared_system_settings','service_catalog'] as $table)Schema::dropIfExists($table);});
function roleDataHeaders($id){return ['Authorization'=>'Bearer '.StaffAuth::token(DB::table('staff_users')->where('id',$id)->first())];}

it('identifies locked visitor log cases and reveals details only after Head Admin unlock',function(){
 roleAuditAppointment();
 $log=['id'=>'log-private','visitId'=>'VIS-PRIVATE','name'=>'Private Visitor','email'=>'owner@gmail.com','timeIn'=>now()->toIso8601String(),'timeOut'=>now()->toIso8601String(),'shared'=>true];
 DB::table('shared_visitor_log')->insert(['id'=>'log-private','queue_id'=>'private','payload'=>Illuminate\Support\Facades\Crypt::encryptString(json_encode($log)),'created_at'=>now(),'updated_at'=>now()]);
 $locked=$this->getJson('/api/service-records',roleDataHeaders('head'))->assertOk()->json('visitorLog.0');
 expect($locked['restricted'])->toBeTrue()->and($locked['confidentialCaseId'])->toBe('private-case')->and(array_key_exists('email',$locked))->toBeFalse();
 Cache::put('conf-unlock:head:private-case:view',true,300);
 $this->getJson('/api/service-records',roleDataHeaders('head'))->assertOk()->assertJsonPath('visitorLog.0.email','owner@gmail.com');
 Cache::forget('conf-unlock:head:private-case:view');
 $locked=$this->getJson('/api/service-records',roleDataHeaders('head'))->assertOk()->json('visitorLog.0');expect($locked['restricted'])->toBeTrue();
});

it('keeps the update feed staff-only and hides private contents from system alerts',function(){
 roleAuditAppointment();
 $row=DB::table('shared_appointments')->where('id','private-appt')->first();$a=json_decode(Illuminate\Support\Facades\Crypt::decryptString($row->payload),true);
 $a['followUpTask']=['text'=>'Bring signed document','dueDate'=>'2026-10-14','completed'=>false];$a['attachments']=[['review'=>['status'=>'Needs correction','reason'=>'Add your signature']]];$a['calendarReview']=true;
 DB::table('shared_appointments')->where('id',$row->id)->update(['payload'=>Illuminate\Support\Facades\Crypt::encryptString(json_encode($a))]);
 $this->getJson('/api/attention')->assertUnauthorized();
 $this->getJson('/api/attention',['X-Visitor-Token'=>VisitorAccess::token('owner@gmail.com')])->assertUnauthorized();
 $this->getJson('/api/attention',['X-Visitor-Token'=>VisitorAccess::token('other@gmail.com')])->assertUnauthorized();
 $this->getJson('/api/attention',roleDataHeaders('super'))->assertOk()->assertJsonCount(0,'notifications');
 $admin=$this->getJson('/api/attention',roleDataHeaders('admin'))->assertOk()->json('notifications');expect(collect($admin)->pluck('title')->all())->toContain('Confidential case assigned to you');
 expect(json_encode($admin))->not->toContain('Bring signed document')->not->toContain('Add your signature');
});

it('routes access decisions and mail failures to authorized recipients only',function(){
 roleAuditAppointment();
 DB::table('confidential_requests')->insert(['id'=>'denied-update','case_id'=>'private-case','requester_id'=>'admin','scope'=>'view','status'=>'Denied']);
 DB::table('notification_outbox')->insert(App\Support\PrivateNotification::fields('owner@gmail.com','PRIVATE SUBJECT','PRIVATE BODY')+['visit_id'=>'VIS-PRIVATE','scheduled_at'=>now(),'send_at'=>now(),'kind'=>'confirmation','status'=>'failed','attempts'=>5,'dedup_key'=>'failed-update','actor_id'=>'system','created_at'=>now(),'updated_at'=>now()]);
 $admin=$this->getJson('/api/attention',roleDataHeaders('admin'))->assertOk()->json('notifications');expect(collect($admin)->pluck('title')->all())->toContain('Access request denied')->not->toContain('Appointment email failed');
 Cache::put('conf-unlock:admin:private-case:view',true,300);
 $admin=$this->getJson('/api/attention',roleDataHeaders('admin'))->assertOk()->json('notifications');expect(collect($admin)->pluck('title')->all())->toContain('Appointment email failed');
 $head=$this->getJson('/api/attention',roleDataHeaders('head'))->assertOk()->json('notifications');expect(collect($head)->pluck('title')->all())->not->toContain('Access request denied','Appointment email failed');
 $super=$this->getJson('/api/attention',roleDataHeaders('super'))->assertOk()->json('notifications');expect(collect($super)->pluck('title')->all())->toContain('Email delivery needs attention');
 expect(json_encode($super))->not->toContain('VIS-PRIVATE')->not->toContain('owner@gmail.com')->not->toContain('PRIVATE BODY');
});

it('keeps approved viewers read only while assigned staff can edit unlocked tasks',function(){
 roleAuditAppointment();
 DB::table('staff_users')->insert(['id'=>'viewer','full_name'=>'Viewer','role'=>'ADMIN','password_hash'=>'test','is_active'=>true,'confidential_access'=>true,'confidential_approver'=>false]);
 DB::table('confidential_requests')->insert(['id'=>'view-grant','case_id'=>'private-case','requester_id'=>'viewer','scope'=>'view','status'=>'Approved','expires_at'=>now()->addMinutes(5)]);
 Cache::put('conf-unlock:viewer:private-case:view',true,300);
 $this->getJson('/api/appointments/visit/VIS-PRIVATE',roleDataHeaders('viewer'))->assertOk()->assertJsonPath('appointment.permissions.editFollowUp',false);
 $record=collect($this->getJson('/api/service-records',roleDataHeaders('viewer'))->assertOk()->json('transactions'))->firstWhere('id','private-case');expect($record['permissions']['editCase'])->toBeFalse();
 $task=['text'=>'Unauthorized replacement','dueDate'=>'2026-10-14','completed'=>true,'completionNotes'=>'Completed by assigned staff','revision'=>0];
 $this->patchJson('/api/appointments/private-appt/follow-up-task',$task,roleDataHeaders('viewer'))->assertForbidden();
 $this->patchJson('/api/service-records/private-case',['escalation'=>'Resolved'],roleDataHeaders('viewer'))->assertForbidden();
 $this->getJson('/api/appointments/visit/VIS-PRIVATE',roleDataHeaders('viewer'))->assertJsonPath('appointment.followUpTask.text','PRIVATE TASK')->assertJsonPath('appointment.revision',0);
 Cache::put('conf-unlock:admin:private-case:view',true,300);
 $this->getJson('/api/appointments/visit/VIS-PRIVATE',roleDataHeaders('admin'))->assertJsonPath('appointment.permissions.editFollowUp',true);
 $this->patchJson('/api/appointments/private-appt/follow-up-task',$task,roleDataHeaders('admin'))->assertOk()->assertJsonPath('appointment.followUpTask.text','Unauthorized replacement');
});

it('resolves missing queue transaction links and fails closed when no case exists',function(){
 roleAuditAppointment();
 $q=QueueData::read(DB::table('queues')->where('id','private')->value('portal_payload'));unset($q['transactionId']);$q['assignedAdminId']='head';
 DB::table('queues')->where('id','private')->update(['portal_payload'=>QueueData::write($q)]);
 $record=collect($this->getJson('/api/queue',roleDataHeaders('head'))->assertOk()->json('queues'))->firstWhere('id','private');expect($record['restricted'])->toBeTrue()->and(array_key_exists('email',$record))->toBeFalse();
 Cache::put('conf-unlock:head:private-case:view',true,300);
 $record=collect($this->getJson('/api/queue',roleDataHeaders('head'))->assertOk()->json('queues'))->firstWhere('id','private');expect($record['email'])->toBe('owner@gmail.com');
 DB::table('shared_transactions')->where('id','private-case')->delete();
 $record=collect($this->getJson('/api/queue',roleDataHeaders('head'))->assertOk()->json('queues'))->firstWhere('id','private');expect($record['restricted'])->toBeTrue()->and(array_key_exists('email',$record))->toBeFalse();
});

it('names the required role in permission errors',function(){
 $this->getJson('/api/queue',roleDataHeaders('super'))->assertForbidden()->assertJsonPath('message','Admin access required.');
 $this->getJson('/api/reports',roleDataHeaders('admin'))->assertForbidden()->assertJsonPath('message','Super Admin access required.');
});

function roleAuditAppointment():void {
 $q=QueueData::read(DB::table('queues')->where('id','private')->value('portal_payload'));
 $q['status']='Completed';$q['transactionId']='private-case';$q['appointmentId']='private-appt';
 DB::table('queues')->where('id','private')->update(['status'=>'Completed','portal_payload'=>QueueData::write($q)]);
 DB::table('confidential_cases')->insert(['id'=>'private-case','code'=>'CASE-PRIVATE','assigned_admin_id'=>'admin']);
 DB::table('shared_transactions')->insert(['id'=>'private-case','queue_id'=>'private','payload'=>Illuminate\Support\Facades\Crypt::encryptString(json_encode(['id'=>'private-case','visitId'=>'VIS-PRIVATE','service'=>'incident_report','name'=>'Private Visitor','email'=>'owner@gmail.com'])),'created_at'=>now(),'updated_at'=>now()]);
 DB::table('shared_appointments')->insert(['id'=>'private-appt','visit_id'=>'VIS-PRIVATE','email'=>App\Support\EmailIndex::key('owner@gmail.com'),'service_key'=>'incident_report','status'=>'Completed','date'=>'2026-10-13','time'=>'10:30','queue_id'=>'private','payload'=>Illuminate\Support\Facades\Crypt::encryptString(json_encode(['name'=>'Private Visitor','email'=>'owner@gmail.com','type'=>'Student','createdAt'=>now()->toIso8601String(),'service'=>'Incident report','serviceKey'=>'incident_report','contact'=>'09123456789','attachments'=>[['dataUrl'=>'PRIVATE FILE']],'followUpTask'=>['text'=>'PRIVATE TASK']])),'created_at'=>now(),'updated_at'=>now()]);
}

it('restricts nested confidential queue data using a safe field list',function(){
 $q=QueueData::read(DB::table('queues')->where('id','private')->value('portal_payload'));
 $q+=['followUpTask'=>['text'=>'Private task'],'serviceHistory'=>[['reason'=>'Private concern']],'futurePrivateField'=>'Private content','idType'=>'Private identity'];
 DB::table('queues')->where('id','private')->update(['portal_payload'=>QueueData::write($q)]);
 foreach(['admin','head'] as $user){$record=collect($this->getJson('/api/queue',roleDataHeaders($user))->assertOk()->json('queues'))->firstWhere('id','private');
  expect($record['restricted'])->toBeTrue();foreach(['email','followUpTask','serviceHistory','futurePrivateField','idType'] as $field)expect(array_key_exists($field,$record))->toBeFalse();
 }
});

it('enforces case permissions and unlock expiry on completed confidential appointments',function(){
 roleAuditAppointment();
 foreach(['admin','head'] as $user){
  $record=$this->getJson('/api/appointments',roleDataHeaders($user))->assertOk()->json('appointments.0');expect($record['restricted'])->toBeTrue();
  foreach(['email','ticketHtml','followUpTask'] as $field)expect(array_key_exists($field,$record))->toBeFalse();
  $this->getJson('/api/appointments/visit/VIS-PRIVATE',roleDataHeaders($user))->assertForbidden();
  $this->patchJson('/api/appointments/private-appt/follow-up-task',['text'=>'Updated task','dueDate'=>'2026-10-14','completed'=>false,'revision'=>0],roleDataHeaders($user))->assertForbidden();
 }
 Cache::put('conf-unlock:admin:private-case:view',true,300);
 $this->getJson('/api/appointments/visit/VIS-PRIVATE',roleDataHeaders('admin'))->assertOk()->assertJsonPath('appointment.name','Private Visitor')->assertJsonPath('queue.name','Private Visitor');
 Cache::forget('conf-unlock:admin:private-case:view');
 $this->getJson('/api/appointments/visit/VIS-PRIVATE',roleDataHeaders('admin'))->assertForbidden();
 DB::table('confidential_cases')->where('id','private-case')->update(['assigned_admin_id'=>null]);
 Cache::put('conf-unlock:admin:private-case:view',true,300);
 DB::table('confidential_requests')->insert(['id'=>'audit-grant','case_id'=>'private-case','requester_id'=>'admin','scope'=>'view','status'=>'Approved','expires_at'=>now()->addMinutes(5)]);
 $this->getJson('/api/appointments/visit/VIS-PRIVATE',roleDataHeaders('admin'))->assertOk();
 DB::table('confidential_requests')->where('id','audit-grant')->update(['expires_at'=>now()->subMinute()]);
 $this->getJson('/api/appointments/visit/VIS-PRIVATE',roleDataHeaders('admin'))->assertForbidden();
 DB::table('confidential_requests')->where('id','audit-grant')->update(['expires_at'=>now()->addMinutes(5),'status'=>'Revoked']);
 $this->getJson('/api/appointments/visit/VIS-PRIVATE',roleDataHeaders('admin'))->assertForbidden();
 $this->getJson('/api/appointments/visit/VIS-PRIVATE',['X-Visitor-Token'=>VisitorAccess::token('owner@gmail.com')])->assertOk();
 $this->getJson('/api/appointments/visit/VIS-PRIVATE',roleDataHeaders('super'))->assertForbidden();
});

it('protects confidential notification status and cancellation',function(){
 roleAuditAppointment();
 foreach(['admin','head','super'] as $user){
  $this->getJson('/api/notifications?visitId=VIS-PRIVATE',roleDataHeaders($user))->assertForbidden();
  $this->deleteJson('/api/notifications',['visitId'=>'VIS-PRIVATE'],roleDataHeaders($user))->assertForbidden();
 }
 $this->deleteJson('/api/notifications',['visitId'=>'VIS-PRIVATE'])->assertUnauthorized();
 Cache::put('conf-unlock:admin:private-case:view',true,300);
 $this->getJson('/api/notifications?visitId=VIS-PRIVATE',roleDataHeaders('admin'))->assertOk();
 $this->deleteJson('/api/notifications',['visitId'=>'VIS-PRIVATE'],roleDataHeaders('admin'))->assertOk();
});

it('returns anonymous feedback aggregates and public queue references for Super Admin',function(){
 foreach(['normal'=>5,'private'=>2] as $id=>$rating){$q=QueueData::read(DB::table('queues')->where('id',$id)->value('portal_payload'));$q['status']='Completed';$q['feedback']=['rating'=>$rating,'comment'=>'PRIVATE COMMENT'];DB::table('queues')->where('id',$id)->update(['status'=>'Completed','portal_payload'=>QueueData::write($q)]);}
 $result=$this->getJson('/api/reports',roleDataHeaders('super'))->assertOk()->json();
 expect($result['feedbackSummary']['responses'])->toBe(2)->and($result['feedbackSummary']['average'])->toEqual(3.5)->and($result['feedbackSummary']['satisfactionPercent'])->toBe(50)->and($result['feedbackSummary']['responseRate'])->toBe(100)->and($result['feedbackSummary']['withComment'])->toBe(2);
 expect($result['queues'][0]['number'])->toBe('A-normal')->and($result['queues'][0]['visitId'])->toBe('VIS-NORMAL');
 expect(json_encode($result))->not->toContain('PRIVATE COMMENT')->not->toContain('owner@gmail.com')->not->toContain('Private Visitor');
 foreach($result['queues'] as $row)expect(array_key_exists('feedback',$row))->toBeFalse();
});

it('previews and restores an encrypted backup only after explicit confirmation',function(){
 \Illuminate\Support\Facades\Storage::fake('local');
 $headers=roleDataHeaders('super');
 $backup=$this->getJson('/api/backup',$headers)->assertOk()->json();
 $preview=$this->postJson('/api/backup/preview',['backup'=>$backup],$headers)->assertOk()->json();
 expect(DB::table('queues')->count())->toBe(2);
 $this->postJson('/api/backup/restore',['token'=>$preview['token'],'confirmation'=>'no'],$headers)->assertUnprocessable();
 DB::table('queues')->delete();
 $result=$this->postJson('/api/backup/restore',['token'=>$preview['token'],'confirmation'=>'RESTORE'],$headers)->assertOk()->assertJsonPath('restored',true)->json();
 expect(DB::table('queues')->count())->toBe(2);
 \Illuminate\Support\Facades\Storage::disk('local')->assertExists($result['recoveryBackup']);
 $this->postJson('/api/backup/restore',['token'=>$preview['token'],'confirmation'=>'RESTORE'],$headers)->assertUnprocessable();
});

it('rejects unauthorized or damaged backup uploads without changing records',function(){
 $backup=$this->getJson('/api/backup',roleDataHeaders('super'))->assertOk()->json();
 $this->postJson('/api/backup/preview',['backup'=>$backup])->assertUnauthorized();
 $this->postJson('/api/backup/preview',['backup'=>$backup],roleDataHeaders('admin'))->assertForbidden();
 $backup['encrypted']='damaged';
 $this->postJson('/api/backup/preview',['backup'=>$backup],roleDataHeaders('super'))->assertUnprocessable();
 expect(DB::table('queues')->count())->toBe(2);
});

it('rolls back all restored tables if a backup violates database constraints',function(){
 \Illuminate\Support\Facades\Storage::fake('local');
 $headers=roleDataHeaders('super');$backup=$this->getJson('/api/backup',$headers)->assertOk()->json();
 $tables=json_decode(\Illuminate\Support\Facades\Crypt::decryptString($backup['encrypted']),true);
 $tables['queues'][]=$tables['queues'][0];
 $backup['encrypted']=\Illuminate\Support\Facades\Crypt::encryptString(json_encode($tables));
 $preview=$this->postJson('/api/backup/preview',['backup'=>$backup],$headers)->assertOk()->json();
 $this->postJson('/api/backup/restore',['token'=>$preview['token'],'confirmation'=>'RESTORE'],$headers)->assertServerError();
 expect(DB::table('queues')->count())->toBe(2);
 expect(DB::table('staff_users')->count())->toBe(3);
});

it('public queue never returns private contact details or uploads',function(){
 $rows=$this->getJson('/api/public-queue')->assertOk()->json('queues');
 foreach($rows as $row)foreach(['name','email','contact','attachments','idNumber'] as $field)expect(array_key_exists($field,$row))->toBeFalse();
});
it('visitor tracking returns only the verified owner’s visit',function(){
 $this->getJson('/api/visits/VIS-NORMAL')->assertUnauthorized();
 $this->getJson('/api/visits/VIS-NORMAL',['X-Visitor-Token'=>VisitorAccess::token('other@gmail.com')])->assertForbidden();
 $this->getJson('/api/visits/VIS-NORMAL',['X-Visitor-Token'=>VisitorAccess::token('owner@gmail.com')])->assertOk()->assertJsonPath('queue.name','Private Visitor');
});
it('Admin sees ordinary queue details while confidential intake remains masked until assigned',function(){
 foreach(['admin','head'] as $role){$rows=collect($this->getJson('/api/queue',roleDataHeaders($role))->assertOk()->json('queues'))->keyBy('id');expect($rows['normal']['email'])->toBe('owner@gmail.com');expect($rows['private']['restricted'])->toBeTrue();expect(array_key_exists('email',$rows['private']))->toBeFalse();}
 $q=QueueData::read(DB::table('queues')->where('id','private')->value('portal_payload'));$q['assignedAdminId']='head';DB::table('queues')->where('id','private')->update(['portal_payload'=>QueueData::write($q)]);
 $rows=collect($this->getJson('/api/queue',roleDataHeaders('head'))->assertOk()->json('queues'))->keyBy('id');expect($rows['private']['email'])->toBe('owner@gmail.com');
});
it('Super Admin receives restricted reports and cannot enter Admin records or queue',function(){
 $this->getJson('/api/queue',roleDataHeaders('super'))->assertForbidden();
 $this->getJson('/api/service-records',roleDataHeaders('super'))->assertForbidden();
 $this->getJson('/api/reports',roleDataHeaders('admin'))->assertForbidden();
 $rows=$this->getJson('/api/reports',roleDataHeaders('super'))->assertOk()->json('queues');
 foreach($rows as $row)foreach(['name','email','contact','attachments'] as $field)expect(array_key_exists($field,$row))->toBeFalse();
});

it('Super Admin reports retain scheduling metrics without disclosing visitor details',function(){
 $q=QueueData::read(DB::table('queues')->where('id','normal')->value('portal_payload'));
 $q['source']='Appointment';$q['scheduledAt']='2026-10-13T11:00:00+08:00';$q['queueEnteredAt']='2026-10-13T10:00:00+08:00';
 DB::table('queues')->where('id','normal')->update(['portal_payload'=>QueueData::write($q)]);
 DB::table('shared_appointments')->insert(['id'=>'late-test','visit_id'=>'VIS-LATE','email'=>'private-index','service_key'=>'good_moral','status'=>'Checked-in','date'=>'2026-10-13','time'=>'09:00','payload'=>Illuminate\Support\Facades\Crypt::encryptString(json_encode(['name'=>'Private Name','email'=>'private@gmail.com','attachments'=>[['dataUrl'=>'secret']],'arrivalStatus'=>'Late','checkedInAt'=>'2026-10-13T09:20:00+08:00'])),'created_at'=>now(),'updated_at'=>now()]);
 $result=$this->getJson('/api/reports',roleDataHeaders('super'))->assertOk()->json();
 expect($result['appointments'][0]['arrivalStatus'])->toBe('Late');
 expect($result['appointments'][0]['time'])->toBe('09:00');
 $queue=collect($result['queues'])->firstWhere('id','normal');
 expect($queue['scheduledAt'])->toBe($q['scheduledAt']);
 expect($queue['queueEnteredAt'])->toBe($q['queueEnteredAt']);
 expect($queue['serviceKey'])->toBe('good_moral');
 foreach([...$result['queues'],...$result['appointments']] as $row)foreach(['name','email','contact','attachments'] as $field)expect(array_key_exists($field,$row))->toBeFalse();
});

it('authorizes fresh report snapshots independently of client flags and view unlocks',function(){
 roleAuditAppointment();
 $this->postJson('/api/report-data',['kind'=>'combined','includeConf'=>true])->assertUnauthorized();
 $this->postJson('/api/report-data',['kind'=>'combined','includeConf'=>true],roleDataHeaders('head'))->assertForbidden();
 Cache::put('conf-unlock:head:private-case:view',true,300);
 $this->postJson('/api/report-data',['kind'=>'transaction','id'=>'private-case','includeConf'=>true],roleDataHeaders('head'))->assertForbidden();
 $redacted=$this->postJson('/api/report-data',['kind'=>'combined','includeConf'=>false],roleDataHeaders('head'))->assertOk()->json();
 expect(json_encode($redacted))->not->toContain('owner@gmail.com')->not->toContain('PRIVATE TASK');
 Cache::put('report-print:head:rpt:all',true,300);
 $this->postJson('/api/report-data',['kind'=>'combined','includeConf'=>true],roleDataHeaders('head'))->assertOk()->assertJsonPath('transactions.0.name','Private Visitor');
 $this->postJson('/api/report-data',['kind'=>'combined','includeConf'=>true],roleDataHeaders('admin'))->assertForbidden();
 Cache::forget('report-print:head:rpt:all');
 $this->postJson('/api/report-data',['kind'=>'combined','includeConf'=>true],roleDataHeaders('head'))->assertForbidden();
});

it('does not expose unrelated transactions in logbook or appointment report snapshots',function(){
 roleAuditAppointment();
 $this->postJson('/api/report-data',['kind'=>'logbook','includeConf'=>true],roleDataHeaders('head'))->assertOk()->assertJsonCount(0,'transactions');
 $this->postJson('/api/report-data',['kind'=>'appointment','id'=>'private-appt','includeConf'=>true],roleDataHeaders('head'))->assertForbidden();
 Cache::put('conf-unlock:head:private-case:print',true,300);
 $this->postJson('/api/report-data',['kind'=>'appointment','id'=>'private-appt','includeConf'=>true],roleDataHeaders('head'))->assertOk()->assertJsonCount(0,'transactions')->assertJsonPath('appointments.0.name','Private Visitor');
 Cache::forget('conf-unlock:head:private-case:print');
});

it('keeps service report unlocks scoped to the selected service and blocks other roles',function(){
 roleAuditAppointment();
 Cache::put('report-print:head:svc:incident_report',true,300);
 $this->postJson('/api/report-data',['kind'=>'service','serviceKey'=>'incident_report','includeConf'=>true],roleDataHeaders('head'))->assertOk()->assertJsonPath('transactions.0.name','Private Visitor');
 $this->postJson('/api/report-data',['kind'=>'combined','includeConf'=>true],roleDataHeaders('head'))->assertForbidden();
 $this->postJson('/api/report-data',['kind'=>'service','serviceKey'=>'concern','includeConf'=>true],roleDataHeaders('head'))->assertForbidden();
 $redacted=$this->postJson('/api/report-data',['kind'=>'service','serviceKey'=>'incident_report','includeConf'=>false],roleDataHeaders('admin'))->assertOk()->json('transactions.0');
 expect($redacted['restricted'])->toBeTrue()->and(array_key_exists('email',$redacted))->toBeFalse();
 $this->postJson('/api/report-data',['kind'=>'combined','includeConf'=>false],roleDataHeaders('super'))->assertForbidden();
 Cache::forget('report-print:head:svc:incident_report');
});

it('rechecks View and Print approvals on output even when an unlock remains cached',function(){
 roleAuditAppointment();
 DB::table('confidential_requests')->insert(['id'=>'report-permission','case_id'=>'private-case','requester_id'=>'admin','scope'=>'view','status'=>'Approved','expires_at'=>now()->addMinutes(5)]);
 Cache::put('conf-unlock:admin:private-case:print',true,300);
 $payload=['kind'=>'transaction','id'=>'private-case','includeConf'=>true];
 $this->postJson('/api/report-data',$payload,roleDataHeaders('admin'))->assertForbidden();
 DB::table('confidential_requests')->where('id','report-permission')->update(['scope'=>'print']);
 $this->postJson('/api/report-data',$payload,roleDataHeaders('admin'))->assertOk()->assertJsonPath('transactions.0.name','Private Visitor');
 DB::table('confidential_requests')->where('id','report-permission')->update(['status'=>'Revoked']);
 $this->postJson('/api/report-data',$payload,roleDataHeaders('admin'))->assertForbidden();
 DB::table('confidential_requests')->where('id','report-permission')->update(['status'=>'Approved','expires_at'=>now()->subMinute()]);
 $this->postJson('/api/report-data',$payload,roleDataHeaders('admin'))->assertForbidden();
 Cache::forget('conf-unlock:admin:private-case:print');
});
