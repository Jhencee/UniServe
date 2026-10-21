<?php

use App\Support\OfficeCalendar;
use App\Support\StaffAuth;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;

beforeEach(function () {
    Schema::create('staff_users', function (Blueprint $t) {
        $t->string('id')->primary(); $t->string('full_name'); $t->string('role'); $t->string('password_hash'); $t->boolean('is_active');
    });
    DB::table('staff_users')->insert([
        ['id'=>'admin','full_name'=>'Calendar Admin','role'=>'ADMIN','password_hash'=>'test','is_active'=>true],
        ['id'=>'super','full_name'=>'Super Admin','role'=>'SUPER_ADMIN','password_hash'=>'test','is_active'=>true],
    ]);
    (require database_path('migrations/2026_10_12_000003_office_calendar.php'))->up();
    Schema::create('queues', function (Blueprint $t) {
        $t->string('id')->primary(); $t->json('portal_payload');
        foreach (['queue_number','prefix','visitor_type','service_label_text','visitor_name','id_number','contact','source','status'] as $column) $t->string($column)->nullable();
        $t->unsignedInteger('seq'); $t->timestamp('created_at')->useCurrent();
    });
    Schema::create('queue_counters', function (Blueprint $t) { $t->date('day_key'); $t->string('prefix'); $t->unsignedInteger('last_seq'); $t->primary(['day_key','prefix']); });
});

afterEach(function () {
    CarbonImmutable::setTestNow();
    foreach (['queue_counters','queues','calendar_audit','office_calendar','staff_users'] as $table) Schema::dropIfExists($table);
});

function calendarHeaders(string $id = 'admin'): array
{
    return ['Authorization'=>'Bearer '.StaffAuth::token(DB::table('staff_users')->where('id',$id)->first())];
}

it('publishes defaults but restricts changes and audit access', function () {
    $this->getJson('/api/calendar')->assertOk()->assertJsonPath('calendar.lunch.start','12:00');
    $this->putJson('/api/calendar',[])->assertUnauthorized();
    $this->getJson('/api/calendar/audit',calendarHeaders())->assertForbidden();
    $this->getJson('/api/calendar/audit',calendarHeaders('super'))->assertOk();
});

it('allows calendar save preflight from the local frontend', function () {
    $this->options('/api/calendar', [], ['Origin'=>'http://127.0.0.1:5500','Access-Control-Request-Method'=>'PUT','Access-Control-Request-Headers'=>'authorization,content-type'])->assertHeader('Access-Control-Allow-Origin','http://127.0.0.1:5500')->assertHeader('Access-Control-Allow-Methods','GET, POST, PUT, PATCH, DELETE, OPTIONS');
});

it('saves changes atomically with actor, effects and revision conflicts', function () {
    $cfg = OfficeCalendar::get(); $cfg['days']['2026-10-13'] = ['type'=>'closed','name'=>'Maintenance'];
    $payload = ['calendar'=>$cfg,'effects'=>['affected'=>3,'decision'=>'review']];
    $this->putJson('/api/calendar',$payload,calendarHeaders())->assertOk()->assertJsonPath('calendar.revision',1);
    $this->putJson('/api/calendar',$payload,calendarHeaders())->assertConflict();
    $this->getJson('/api/calendar/audit',calendarHeaders('super'))->assertOk()->assertJsonPath('entries.0.actor_id','admin')->assertJsonPath('entries.0.effects.affected',3)->assertJsonPath('entries.0.after.days.2026-10-13.name','Maintenance');
    expect(DB::table('calendar_audit')->count())->toBe(1);
});

it('rejects invalid calendar dates and inverted time ranges', function () {
    $cfg = OfficeCalendar::get(); $cfg['lunch']['end']='11:00';
    $this->putJson('/api/calendar',['calendar'=>$cfg,'effects'=>['affected'=>0,'decision'=>'keep']],calendarHeaders())->assertUnprocessable();
    $cfg = OfficeCalendar::get(); $cfg['days']['2026-02-30']=['type'=>'holiday','name'=>'Invalid'];
    $this->putJson('/api/calendar',['calendar'=>$cfg,'effects'=>['affected'=>0,'decision'=>'keep']],calendarHeaders())->assertUnprocessable();
    $cfg = OfficeCalendar::get(); $cfg['days']['2026-10-12']=['type'=>'special'];
    $this->putJson('/api/calendar',['calendar'=>$cfg,'effects'=>['affected'=>0,'decision'=>'keep']],calendarHeaders())->assertUnprocessable();
    expect(DB::table('calendar_audit')->count())->toBe(0);
});

it('blocks walkins during lunch while keeping existing visit lookup available', function () {
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-12 12:15','Asia/Manila'));
    $this->verifiedPostJson('/api/visits',['visitorType'=>'Student','serviceKey'=>'other','serviceLabel'=>'Other','name'=>'Lunch Visitor','contact'=>'09123456789','email'=>'test@gmail.com'])->assertConflict()->assertJsonPath('availability.reason','Closed for lunch')->assertJsonPath('availability.nextOpening','2026-10-12T13:00:00+08:00');
    DB::table('queues')->insert(['id'=>'existing','seq'=>1,'portal_payload'=>json_encode(['visitId'=>'VIS-EXISTING','status'=>'Waiting','email'=>'test@gmail.com'])]);
    $this->getJson('/api/visits/VIS-EXISTING',['X-Visitor-Token'=>\App\Support\VisitorAccess::token('test@gmail.com')])->assertOk()->assertJsonPath('queue.status','Waiting');
});

it('issues unique shared walkin numbers during open hours and blocks a saved closure', function () {
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-12 10:00','Asia/Manila'));
    $visitor = ['visitorType'=>'Student','serviceKey'=>'other','serviceLabel'=>'Other','name'=>'Visitor','contact'=>'09123456789','email'=>'test@gmail.com'];
    $first = $this->verifiedPostJson('/api/visits',$visitor)->assertCreated()->json('queue');
    $second = $this->verifiedPostJson('/api/visits',$visitor)->assertCreated()->json('queue');
    expect($first['number'])->not->toBe($second['number']);
    expect($first['visitId'])->toMatch('/^VIS-[A-Z2-9]{8}$/');
    $this->getJson('/api/queue',calendarHeaders())->assertOk()->assertJsonCount(2,'queues');
    $cfg = OfficeCalendar::get(); $cfg['days']['2026-10-12']=['type'=>'closed','name'=>'Suspension'];
    $this->putJson('/api/calendar',['calendar'=>$cfg,'effects'=>['affected'=>0,'decision'=>'keep']],calendarHeaders())->assertOk();
    $this->verifiedPostJson('/api/visits',$visitor)->assertConflict()->assertJsonPath('availability.reason','Closed today, Suspension');
    expect(DB::table('queues')->count())->toBe(2);
});

it('keeps older Visit ID formats working when entered without internal separators',function(){
    DB::table('queues')->insert(['id'=>'legacy','seq'=>1,'portal_payload'=>json_encode(['visitId'=>'VIS-ABCD-EFGH','status'=>'Waiting','email'=>'test@gmail.com'])]);
    $this->getJson('/api/visits/VIS-ABCDEFGH',['X-Visitor-Token'=>\App\Support\VisitorAccess::token('test@gmail.com')])->assertOk()->assertJsonPath('queue.visitId','VIS-ABCD-EFGH');
});

it('finds the next opening across holidays and respects special half days', function () {
    $cfg = OfficeCalendar::get();
    expect(OfficeCalendar::status(CarbonImmutable::parse('2026-06-12 10:00','Asia/Manila'),$cfg)['nextOpening'])->toBe('2026-06-15T08:00:00+08:00');
    $cfg['days']['2026-10-12']=['type'=>'special','start'=>'08:00','end'=>'12:00'];
    expect(OfficeCalendar::status(CarbonImmutable::parse('2026-10-12 12:00','Asia/Manila'),$cfg)['nextOpening'])->toBe('2026-10-13T08:00:00+08:00');
});

it('preserves disability priority for student and guest walkins', function (string $type) {
    CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-12 10:00','Asia/Manila'));
    $q = $this->verifiedPostJson('/api/visits', ['visitorType'=>$type,'serviceKey'=>'other','serviceLabel'=>'Other','name'=>'Priority Visitor','contact'=>'09123456789','email'=>'test@gmail.com','isPWD'=>true])->assertCreated()->assertJsonPath('queue.isPWD',true)->json('queue');
    $this->getJson('/api/visits/'.$q['visitId'],['X-Visitor-Token'=>\App\Support\VisitorAccess::token('test@gmail.com')])->assertOk()->assertJsonPath('queue.isPWD',true);
    $this->getJson('/api/queue',calendarHeaders())->assertOk()->assertJsonFragment(['isPWD'=>true]);
})->with(['Student','Guest']);
