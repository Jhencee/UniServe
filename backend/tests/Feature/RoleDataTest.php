<?php
use App\Support\{StaffAuth,VisitorAccess,QueueData};
use Illuminate\Support\Facades\{DB,Schema};
use Illuminate\Database\Schema\Blueprint;
use Carbon\CarbonImmutable;

beforeEach(function(){
 Schema::create('staff_users',function(Blueprint $t){$t->string('id')->primary();$t->string('full_name');$t->string('role');$t->string('password_hash');$t->boolean('is_active');$t->boolean('confidential_access')->default(false);$t->boolean('confidential_approver')->default(false);});
 foreach(['admin','head','super'] as $id)DB::table('staff_users')->insert(['id'=>$id,'full_name'=>$id,'role'=>$id==='super'?'SUPER_ADMIN':'ADMIN','password_hash'=>'test','is_active'=>true,'confidential_access'=>$id==='head','confidential_approver'=>$id==='head']);
 Schema::create('queues',function(Blueprint $t){$t->string('id')->primary();$t->string('status');$t->text('portal_payload');$t->timestamps();});
 foreach(['2026_10_12_000003_office_calendar.php','2026_10_12_000004_audit_and_notifications.php','2026_10_14_000006_shared_appointments.php','2026_10_15_000008_remaining_flows.php'] as $file)(require database_path('migrations/'.$file))->up();
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-13 10:00','Asia/Manila'));
 foreach(['normal'=>'good_moral','private'=>'incident_report'] as $id=>$service){$q=['id'=>$id,'visitId'=>'VIS-'.strtoupper($id),'number'=>'A-'.$id,'status'=>'Waiting','serviceKey'=>$service,'serviceLabel'=>$service,'source'=>'Walk-in','name'=>'Private Visitor','email'=>'owner@gmail.com','contact'=>'09123456789','attachments'=>[['dataUrl'=>'private-file']],'createdAt'=>'2026-10-13T09:00:00+08:00'];DB::table('queues')->insert(['id'=>$id,'status'=>'Waiting','portal_payload'=>QueueData::write($q),'created_at'=>now(),'updated_at'=>now()]);}
});
afterEach(function(){CarbonImmutable::setTestNow();foreach(['queues','staff_users','office_calendar','calendar_audit','system_audit','notification_outbox','shared_appointments','shared_transactions','shared_visitor_log','shared_chats','shared_system_settings','service_catalog'] as $table)Schema::dropIfExists($table);});
function roleDataHeaders($id){return ['Authorization'=>'Bearer '.StaffAuth::token(DB::table('staff_users')->where('id',$id)->first())];}

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
