<?php

use App\Support\{DatabaseBackup, StaffAuth, SystemAudit};
use Illuminate\Support\Facades\{Cache, Crypt, DB, Hash, Storage, Schema};

beforeEach(function(){
    if(DB::getDriverName()!=='sqlite'||DB::connection()->getDatabaseName()!==':memory:')throw new RuntimeException('Oversight tests require isolated SQLite memory.');
    $this->artisan('migrate:fresh',['--force'=>true])->assertSuccessful();
    Storage::fake('local');
    Cache::flush();
    config(['services.turnstile.enabled'=>false,'backups.scheduled'=>false]);
    foreach(['super'=>'SUPER_ADMIN','admin'=>'ADMIN'] as $id=>$role)DB::table('staff_users')->insert([
        'id'=>$id,'username'=>$id,'full_name'=>ucfirst($id),'role'=>$role,
        'password_hash'=>Hash::make('TestingStrong!Password42'),'is_active'=>true,'confidential_access'=>$role==='ADMIN',
    ]);
});
afterEach(function(){ Schema::dropAllTables(); });
function oversightHeaders(string $id='super'):array { $headers=['Authorization'=>'Bearer '.StaffAuth::token(DB::table('staff_users')->where('id',$id)->first())];if($id==='super')test()->postJson('/api/password/confirm',['password'=>'TestingStrong!Password42'],$headers)->assertOk();return $headers; }

it('restricts oversight and backup history to authenticated Super Admins',function(){
    foreach(['/api/system/oversight','/api/backup/history'] as $path){
        $this->getJson($path)->assertUnauthorized();
        $this->getJson($path,oversightHeaders('admin'))->assertForbidden();
        $this->getJson($path,oversightHeaders())->assertOk()->assertHeader('Cache-Control','no-store, private');
    }
});

it('allows the exact deployed frontend origin without wildcard access',function(){
    config(['cors.allowed_origins'=>['https://oss.uniserve.vercel.app'],'cors.allowed_origins_patterns'=>[]]);
    $this->withHeaders(['Origin'=>'https://oss.uniserve.vercel.app','Access-Control-Request-Method'=>'GET','Access-Control-Request-Headers'=>'authorization,content-type'])
        ->options('/api/system/oversight')->assertNoContent()->assertHeader('Access-Control-Allow-Origin','https://oss.uniserve.vercel.app');
    $this->withHeaders(['Origin'=>'https://untrusted.example','Access-Control-Request-Method'=>'GET'])
        ->options('/api/system/oversight')->assertHeader('Access-Control-Allow-Origin','https://oss.uniserve.vercel.app');
});

it('reports evidence without treating unknown signins or unobserved workers as healthy',function(){
    SystemAudit::record(DB::table('staff_users')->where('id','admin')->first(),'Authentication','Signed in');
    DB::table('system_audit')->where('action','Signed in')->update(['created_at'=>now()->subDays(100)]);
    SystemAudit::record(null,'Authentication','Sign-in failed');
    Cache::put('system:scheduler-heartbeat',now()->toIso8601String(),600);
    $data=$this->getJson('/api/system/oversight',oversightHeaders())->assertOk()
        ->assertJsonPath('health.api.state','responding')->assertJsonPath('health.scheduler.state','observed')
        ->assertJsonPath('health.worker.state','unverified')->assertJsonPath('security.failedOrDenied24h',1)->json();
    $accounts=collect($data['accounts'])->keyBy('id');
    expect($accounts['admin']['reviewInactive'])->toBeTrue()->and($accounts['super']['lastSignIn'])->toBeNull();
    expect(json_encode($data))->not->toContain('password_hash')->not->toContain('TestingStrong');
});

it('exports complete encrypted server data and detects a damaged saved file',function(){
    $backup=$this->getJson('/api/backup',oversightHeaders())->assertOk()->json();
    $tables=DatabaseBackup::decode($backup);
    expect(array_keys($tables))->toBe(DatabaseBackup::tables());
    $history=$this->getJson('/api/backup/history',oversightHeaders())->assertOk()->json('backups');
    expect($history)->toHaveCount(1)->and($history[0]['restoreTested'])->toBeFalse();
    $id=$history[0]['id'];
    $this->getJson('/api/backup/files/'.$id,oversightHeaders())->assertOk()->assertJsonPath('format','uniserve-encrypted-v1');
    $this->getJson('/api/backup/files/'.$id,oversightHeaders('admin'))->assertForbidden();
    Storage::disk('local')->put('activity-backups/'.$id.'.json','damaged');
    $this->getJson('/api/backup/files/'.$id,oversightHeaders())->assertUnprocessable();
});

it('rejects incomplete backups before replacement',function(){
    $backup=$this->getJson('/api/backup',oversightHeaders())->assertOk()->json();
    $tables=DatabaseBackup::decode($backup);unset($tables['queues']);
    $backup['encrypted']=Crypt::encryptString(json_encode($tables));
    $this->postJson('/api/backup/preview',['backup'=>$backup],oversightHeaders())->assertUnprocessable();
    expect(DB::table('staff_users')->count())->toBe(2);
});

it('saves recovery history and invalidates pre-restore staff tokens',function(){
    $headers=oversightHeaders();
    $document='data:application/pdf;base64,JVBERg==';
    DB::table('shared_chats')->insert(['id'=>'document-fixture','email'=>'fixture-index','status'=>'Open',
        'payload'=>Crypt::encryptString(json_encode(['attachments'=>[['dataUrl'=>$document]]])),'created_at'=>now(),'updated_at'=>now()]);
    DB::table('notification_outbox')->insert(['visit_id'=>'VIS-TEST','recipient'=>'fixture@example.test','subject'=>'Fixture','body'=>'Fixture',
        'scheduled_at'=>now(),'send_at'=>now(),'status'=>'pending','kind'=>'appointment','dedup_key'=>'fixture-key','actor_id'=>'super','created_at'=>now(),'updated_at'=>now()]);
    $backup=$this->getJson('/api/backup',$headers)->assertOk()->json();
    $preview=$this->postJson('/api/backup/preview',['backup'=>$backup],$headers)->assertOk()->json();
    $reference=Cache::get('backup-restore:'.$preview['token']);
    expect($reference)->toHaveKeys(['actor','path'])->and(array_key_exists('backup',$reference))->toBeFalse();
    Storage::disk('local')->assertExists($reference['path']);
    DB::table('shared_chats')->delete();
    $this->postJson('/api/backup/restore',['token'=>$preview['token'],'confirmation'=>'RESTORE'],$headers)->assertOk();
    $restored=json_decode(Crypt::decryptString(DB::table('shared_chats')->where('id','document-fixture')->value('payload')),true);
    expect($restored['attachments'][0]['dataUrl'])->toBe($document);
    expect(DB::table('notification_outbox')->value('status'))->toBe('paused');
    Storage::disk('local')->assertMissing($reference['path']);
    $this->getJson('/api/system/oversight',$headers)->assertUnauthorized();
    $history=$this->getJson('/api/backup/history',oversightHeaders())->assertOk()->json('backups');
    expect(collect($history)->where('kind','pre-restore'))->toHaveCount(1);
    $this->getJson('/api/backup/history',oversightHeaders())->assertJsonCount(1,'restores');
});

it('prunes only expired temporary previews and keeps saved recovery backups',function(){
    $this->artisan('backup:create')->assertSuccessful();
    $history=DatabaseBackup::history();
    $path='backup-previews/'.\Illuminate\Support\Str::uuid().'.json';
    Storage::disk('local')->put($path,'temporary');
    touch(Storage::disk('local')->path($path),time()-7200);
    $this->artisan('backup:prune-previews')->assertSuccessful();
    Storage::disk('local')->assertMissing($path);
    Storage::disk('local')->assertExists('activity-backups/'.$history[0]['id'].'.json');
});

it('creates a verified operator backup without exposing the application key',function(){
    $this->artisan('backup:create')->assertSuccessful();
    $history=DatabaseBackup::history();
    expect($history)->toHaveCount(1)->and($history[0]['kind'])->toBe('scheduled-or-operator');
    $saved=DatabaseBackup::read($history[0]['id']);
    expect(json_encode($saved))->not->toContain(config('app.key'));
});

it('accepts omitted empty legacy tables while refusing to omit populated legacy data',function(){
    Schema::create('services',fn(\Illuminate\Database\Schema\Blueprint $table)=>$table->string('id')->primary());
    $backup=DatabaseBackup::snapshot();$tables=DatabaseBackup::decode($backup);unset($tables['services']);$backup['encrypted']=Crypt::encryptString(json_encode($tables));
    $this->postJson('/api/backup/preview',['backup'=>$backup],oversightHeaders())->assertOk();
    expect(DB::table('services')->count())->toBe(0);
    DB::table('services')->insert(['id'=>'preserve-legacy-record']);
    $this->postJson('/api/backup/preview',['backup'=>$backup],oversightHeaders())->assertUnprocessable()->assertJsonPath('message','This backup is missing required data tables: services. Choose a complete backup for this database. Current records have not been changed.');
    expect(DB::table('services')->where('id','preserve-legacy-record')->exists())->toBeTrue();
});
it('ignores absent empty legacy tables but never discards legacy rows or unknown tables',function(){
    $backup=DatabaseBackup::snapshot();$tables=DatabaseBackup::decode($backup);$tables['services']=[];$backup['encrypted']=Crypt::encryptString(json_encode($tables));
    $this->postJson('/api/backup/preview',['backup'=>$backup],oversightHeaders())->assertOk();
    $tables['services']=[['id'=>'legacy-data']];$backup['encrypted']=Crypt::encryptString(json_encode($tables));
    $this->postJson('/api/backup/preview',['backup'=>$backup],oversightHeaders())->assertUnprocessable();
    unset($tables['services']);$tables['unknown_table']=[];$backup['encrypted']=Crypt::encryptString(json_encode($tables));
    $this->postJson('/api/backup/preview',['backup'=>$backup],oversightHeaders())->assertUnprocessable();
});

it('filters notification audit review by exact time window and server failure criteria',function(){
    $headers=oversightHeaders();$cutoff=now()->toImmutable();
    foreach([
        ['Sign-in failed','server',$cutoff->subHours(2)],
        ['Access denied','server',$cutoff->subHours(1)],
        ['Request blocked','server',$cutoff->subMinutes(30)],
        ['Signed in','server',$cutoff->subHour()],
        ['Sign-in failed','browser',$cutoff->subHour()],
        ['Sign-in failed','server',$cutoff->subDays(2)],
        ['Sign-in failed','server',$cutoff->addHour()],
    ] as $index=>[$action,$source,$date]){
        SystemAudit::record(null,'Authentication',$action,null,[],$source,'review-fixture-'.$index);
        DB::table('system_audit')->where('id','review-fixture-'.$index)->update(['created_at'=>$date]);
    }
    $query=http_build_query(['review'=>'failed','review_from'=>$cutoff->subDay()->toIso8601String(),'review_to'=>$cutoff->toIso8601String()]);
    $response=$this->getJson('/api/audit?'.$query,$headers)->assertOk()->assertJsonPath('total',3)->assertJsonPath('reviewScope.kind','failed');
    expect(collect($response->json('data'))->pluck('action')->sort()->values()->all())->toBe(['Access denied','Request blocked','Sign-in failed']);
    $this->getJson('/api/audit?'.$query.'&'.http_build_query(['review_ids'=>['review-fixture-1','review-fixture-3']]),$headers)
        ->assertOk()->assertJsonPath('total',1)->assertJsonPath('data.0.action','Access denied');
    $this->getJson('/api/audit?'.$query,oversightHeaders('admin'))->assertForbidden();
    $this->getJson('/api/audit?review=unsupported',$headers)->assertUnprocessable();
});

it('shows only structurally invalid audit records for a structure notification',function(){
    $headers=oversightHeaders();
    SystemAudit::record(null,'System','Malformed fixture');
    DB::table('system_audit')->where('action','Malformed fixture')->update(['changes'=>'"not an array"']);
    $response=$this->getJson('/api/audit?review=structure',$headers)->assertOk()->assertJsonPath('total',1)->assertJsonPath('reviewScope.kind','structure');
    expect($response->json('data.0.action'))->toBe('Malformed fixture')->and($response->json('data.0.changes'))->toBe([]);
});

it('locates the notification match within the complete audit pagination',function(){
    $headers=oversightHeaders();$cutoff=now()->toImmutable();
    for($i=0;$i<35;$i++)SystemAudit::record(null,'System','Ordinary event '.$i);
    SystemAudit::record(null,'Authentication','Sign-in failed',null,[],'server','locate-target');
    DB::table('system_audit')->where('id','locate-target')->update(['created_at'=>$cutoff->subHour()]);
    $query=http_build_query(['review'=>'failed','review_from'=>$cutoff->subDay()->toIso8601String(),'review_to'=>$cutoff->toIso8601String(),'review_locate'=>1]);
    $this->getJson('/api/audit?'.$query,$headers)->assertOk()->assertJsonPath('reviewScope.page',2);
    $this->getJson('/api/audit?page=2',$headers)->assertOk()->assertJsonFragment(['id'=>'locate-target']);
});
