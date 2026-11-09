<?php

use App\Support\StaffAuth;
use Carbon\CarbonImmutable;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Schema;

beforeEach(function() {
    \Illuminate\Support\Facades\Queue::fake([\App\Jobs\DeliverAppointmentNotifications::class]);
    Schema::create('staff_users',function(Blueprint $t){$t->string('id')->primary();$t->string('full_name');$t->string('role');$t->string('password_hash');$t->boolean('is_active');});
    DB::table('staff_users')->insert([
        ['id'=>'admin','full_name'=>'OSS Admin','role'=>'ADMIN','password_hash'=>'test','is_active'=>true],
        ['id'=>'super','full_name'=>'Super Admin','role'=>'SUPER_ADMIN','password_hash'=>'test','is_active'=>true],
    ]);
    (require database_path('migrations/2026_10_12_000003_office_calendar.php'))->up();
    (require database_path('migrations/2026_10_12_000004_audit_and_notifications.php'))->up();
    Schema::create('queues',function(Blueprint $t){$t->string('id')->primary();$t->json('portal_payload');$t->timestamp('created_at')->useCurrent();});
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-12 10:00','Asia/Manila'));
});
afterEach(function(){CarbonImmutable::setTestNow();foreach(['shared_appointments','queues','notification_outbox','system_audit','calendar_audit','office_calendar','staff_users'] as $t)Schema::dropIfExists($t);});
function improvementHeaders(string $id='admin'): array{return ['Authorization'=>'Bearer '.StaffAuth::token(DB::table('staff_users')->where('id',$id)->first())];}
function notificationAccessFixture():void {
 Schema::create('shared_appointments',function(Blueprint $t){$t->string('visit_id');$t->string('service_key');});
 DB::table('shared_appointments')->insert(['visit_id'=>'VIS-TEST','service_key'=>'good_moral']);
}
function notificationData():array{return ['visitId'=>'VIS-TEST','email'=>'visitor@example.com','name'=>'Visitor','service'=>'Good Moral','date'=>'2026-10-14','time'=>'09:00','kind'=>'confirmation'];}
it('dispatches confirmation delivery automatically when office SMTP is configured',function(){
 config(['mail.default'=>'smtp','mail.mailers.smtp.username'=>'test','mail.mailers.smtp.password'=>'test']);
 $this->postJson('/api/notifications',notificationData(),improvementHeaders())->assertAccepted();
 \Illuminate\Support\Facades\Queue::assertPushed(\App\Jobs\DeliverAppointmentNotifications::class);
});
it('keeps audit history beyond 500 records available through server pagination',function(){
 $rows=[];for($i=0;$i<501;$i++)$rows[]=['id'=>'audit-page-'.$i,'actor_name'=>'System','category'=>'System','action'=>'Test event','changes'=>'[]','source'=>'server','created_at'=>now()];
 DB::table('system_audit')->insert($rows);
 $this->getJson('/api/audit?page=17',improvementHeaders('super'))->assertOk()->assertJsonPath('total',501)->assertJsonPath('last_page',17)->assertJsonCount(21,'data');
});
it('sends cancellation notices even when the old slot is past or the office is closed',function(){
 config(['mail.default'=>'smtp','mail.mailers.smtp.username'=>'test','mail.mailers.smtp.password'=>'test']);
 DB::table('notification_outbox')->insert(\App\Support\PrivateNotification::fields('visitor@gmail.com','Appointment cancelled','Your appointment has been cancelled.')+['visit_id'=>'VIS-CANCEL','scheduled_at'=>now()->subDay(),'send_at'=>now()->subMinute(),'kind'=>'cancelled','dedup_key'=>'cancel-test','actor_id'=>'admin','created_at'=>now(),'updated_at'=>now()]);
 Mail::shouldReceive('html')->once()->andReturn(null);$this->artisan('notifications:send')->assertSuccessful();
 expect(DB::table('notification_outbox')->where('visit_id','VIS-CANCEL')->value('status'))->toBe('sent');
});

it('requires staff identity for shared events and reserves audit viewing for Super Admin',function(){
    $this->postJson('/api/audit',[])->assertUnauthorized();
    $this->getJson('/api/audit',improvementHeaders())->assertForbidden();
    $data=['id'=>'local-1','category'=>'Appointments','action'=>'Scheduled VIS-TEST','target'=>'VIS-TEST','actor_name'=>'Forged name'];
    $this->postJson('/api/audit',$data,improvementHeaders())->assertOk();
    $this->postJson('/api/audit',$data,improvementHeaders())->assertOk();
    expect(DB::table('system_audit')->where('source','browser')->count())->toBe(1);
    $this->getJson('/api/audit?q=VIS-TEST&category=Appointments&actor=OSS',improvementHeaders('super'))->assertOk()->assertJsonPath('total',1)->assertJsonPath('data.0.actor_name','OSS Admin')->assertJsonPath('data.0.source','browser');
});
it('queues email and reminder without sending at request time and deduplicates retries',function(){
    Mail::shouldReceive('html')->never();
    $this->postJson('/api/notifications',notificationData(),improvementHeaders())->assertAccepted()->assertJsonPath('mailConfigured',false);
    $this->postJson('/api/notifications',notificationData(),improvementHeaders())->assertAccepted();
    expect(DB::table('notification_outbox')->count())->toBe(2);
    notificationAccessFixture();
    $this->getJson('/api/notifications?visitId=VIS-TEST',improvementHeaders())->assertOk()->assertJsonCount(2,'notifications');
    $this->getJson('/api/notifications?visitId=VIS-TEST')->assertUnauthorized();
    $this->postJson('/api/notifications',notificationData(),improvementHeaders('super'))->assertForbidden();
});
it('supersedes old pending messages when rescheduled and supports cancelling pending emails',function(){
    $this->postJson('/api/notifications',notificationData(),improvementHeaders())->assertAccepted();
    $data=notificationData();$data['date']='2026-10-15';$data['kind']='rescheduled';
    $this->postJson('/api/notifications',$data,improvementHeaders())->assertAccepted();
    expect(DB::table('notification_outbox')->where('status','superseded')->count())->toBe(2);
    notificationAccessFixture();
    $this->deleteJson('/api/notifications',['visitId'=>'VIS-TEST'],improvementHeaders())->assertOk()->assertJsonPath('cancelled',2);
});
it('rejects emails for closed days and lunch hours',function(){
    $data=notificationData();$data['date']='2026-10-17';
    $this->postJson('/api/notifications',$data,improvementHeaders())->assertUnprocessable();
    $data=notificationData();$data['time']='12:00';
    $this->postJson('/api/notifications',$data,improvementHeaders())->assertUnprocessable();
    expect(DB::table('notification_outbox')->count())->toBe(0);
});
it('sends due notifications through the configured transport only once',function(){
    $this->postJson('/api/notifications',notificationData(),improvementHeaders())->assertAccepted();
    config(['mail.default'=>'smtp','mail.mailers.smtp.username'=>'test','mail.mailers.smtp.password'=>'test']);
    Mail::shouldReceive('html')->once()->andReturn(null);
    $this->artisan('notifications:send')->assertSuccessful();
    $this->artisan('notifications:send')->assertSuccessful();
    expect(DB::table('notification_outbox')->where('status','sent')->count())->toBe(1);
    expect(DB::table('notification_outbox')->where('status','pending')->count())->toBe(1);
});
it('keeps emails pending without SMTP credentials',function(){
    $this->postJson('/api/notifications',notificationData(),improvementHeaders())->assertAccepted();
    Mail::shouldReceive('html')->never();
    $this->artisan('notifications:send')->assertExitCode(1);
    expect(DB::table('notification_outbox')->where('status','pending')->count())->toBe(2);
});
it('logs calendar mutations centrally without recording credentials',function(){
    $cfg=\App\Support\OfficeCalendar::get();$cfg['days']['2026-10-13']=['type'=>'closed','name'=>'Maintenance'];
    $this->putJson('/api/calendar',['calendar'=>$cfg,'effects'=>['affected'=>2,'decision'=>'review']],improvementHeaders())->assertOk();
    $this->getJson('/api/audit?category=Settings',improvementHeaders('super'))->assertOk()->assertJsonPath('total',1)->assertJsonPath('data.0.actor_id','admin');
});

it('pauses notification delivery if the calendar closes an existing slot',function(){
    $this->postJson('/api/notifications',notificationData(),improvementHeaders())->assertAccepted();
    $cfg=\App\Support\OfficeCalendar::get();$cfg['days']['2026-10-14']=['type'=>'closed','name'=>'Suspension'];
    DB::table('office_calendar')->where('id',1)->update(['payload'=>json_encode($cfg)]);
    config(['mail.default'=>'smtp','mail.mailers.smtp.username'=>'test','mail.mailers.smtp.password'=>'test']);
    Mail::shouldReceive('html')->never();
    $this->artisan('notifications:send')->assertSuccessful();
    expect(DB::table('notification_outbox')->where('kind','confirmation')->value('status'))->toBe('paused');
});

it('retries transport failures without claiming successful delivery',function(){
    $this->postJson('/api/notifications',notificationData(),improvementHeaders())->assertAccepted();
    config(['mail.default'=>'smtp','mail.mailers.smtp.username'=>'test','mail.mailers.smtp.password'=>'test']);
    Mail::shouldReceive('html')->once()->andThrow(new RuntimeException('Unavailable'));
    $this->artisan('notifications:send')->assertSuccessful();
    $row=DB::table('notification_outbox')->where('kind','confirmation')->first();
    expect($row->status)->toBe('pending')->and($row->attempts)->toBe(1)->and($row->sent_at)->toBeNull();
});

it('verifies emailed history codes server-side without exposing them in the response',function(){
    config(['mail.default'=>'smtp','mail.mailers.smtp.username'=>'test','mail.mailers.smtp.password'=>'test']);
    \Illuminate\Support\Facades\Cache::flush();$code=null;
    Mail::shouldReceive('html')->once()->withArgs(function($body,$callback)use(&$code){preg_match('/>(\d{6})<\//',$body,$m);$code=$m[1];return true;})->andReturn(null);
    DB::table('queues')->insert(['id'=>'mine','portal_payload'=>json_encode(['visitId'=>'VIS-MINE','email'=>'visitor@gmail.com'])]);
    DB::table('queues')->insert(['id'=>'other','portal_payload'=>json_encode(['visitId'=>'VIS-OTHER','email'=>'other@gmail.com'])]);
    $result=$this->postJson('/api/history/code',['email'=>'visitor@gmail.com'])->assertOk()->json();
    expect($result)->not->toHaveKey('code');
    $this->postJson('/api/history/verify',['challengeId'=>$result['challengeId'],'code'=>'000000'])->assertUnprocessable();
    $this->postJson('/api/history/verify',['challengeId'=>$result['challengeId'],'code'=>$code])->assertOk()->assertJsonCount(1,'queues')->assertJsonPath('queues.0.visitId','VIS-MINE');
    $this->postJson('/api/history/verify',['challengeId'=>$result['challengeId'],'code'=>$code])->assertUnprocessable();
});
it('does not claim to send verification email without Gmail credentials',function(){
    Mail::shouldReceive('html')->never();
    $this->postJson('/api/history/code',['email'=>'visitor@gmail.com'])->assertStatus(503);
});
it('queues encrypted verification mail without waiting for SMTP and escapes email contents',function(){
 config(['mail.default'=>'smtp','mail.mailers.smtp.username'=>'test','mail.mailers.smtp.password'=>'test']);
 \Illuminate\Support\Facades\Cache::flush();\Illuminate\Support\Facades\Queue::fake();Mail::shouldReceive('html')->never();
 $this->postJson('/api/history/code',['email'=>'visitor@gmail.com'])->assertOk()->assertJsonPath('queued',true);
 \Illuminate\Support\Facades\Queue::assertPushed(\App\Jobs\SendVerificationCode::class,fn($job)=>$job instanceof \Illuminate\Contracts\Queue\ShouldBeEncrypted&&$job->queue==='mail-verification');
 $html=\App\Support\OfficeMail::html('Your visit','<script>alert(1)</script>');expect($html)->toContain('&lt;script&gt;')->not->toContain('<script>');
});
it('embeds the PUP logo inside styled emails without depending on a localhost image URL',function(){
 config(['mail.default'=>'array']);
 \App\Support\OfficeMail::send('visitor@gmail.com','Your verification code','Enter your code.','123456');
 $message=Mail::mailer('array')->getSymfonyTransport()->messages()->last()->getOriginalMessage();
 expect($message->getHtmlBody())->toContain('cid:')->not->toContain('cid:uniserve-pup');
 expect($message->getAttachments())->toHaveCount(1);
 expect($message->getAttachments()[0]->getMediaType())->toBe('image');
});
it('locks the verification challenge after five wrong attempts',function(){
    config(['mail.default'=>'smtp','mail.mailers.smtp.username'=>'test','mail.mailers.smtp.password'=>'test']);
    \Illuminate\Support\Facades\Cache::flush();$code=null;
    Mail::shouldReceive('html')->once()->withArgs(function($body,$callback)use(&$code){preg_match('/>(\d{6})<\//',$body,$m);$code=$m[1];return true;})->andReturn(null);
    $id=$this->postJson('/api/history/code',['email'=>'visitor@gmail.com'])->assertOk()->json('challengeId');
    for($i=0;$i<5;$i++)$this->postJson('/api/history/verify',['challengeId'=>$id,'code'=>'000000'])->assertUnprocessable();
    $this->postJson('/api/history/verify',['challengeId'=>$id,'code'=>$code])->assertUnprocessable();
});
it('allows scoped notification cancellation tokens but rejects forged tokens',function(){
    $token=$this->postJson('/api/notifications',notificationData(),improvementHeaders())->assertAccepted()->json('cancelToken');
    $this->postJson('/api/notifications/cancel-token',['token'=>'forged'])->assertForbidden();
    $this->postJson('/api/notifications/cancel-token',['token'=>$token])->assertOk()->assertJsonPath('cancelled',2);
});
