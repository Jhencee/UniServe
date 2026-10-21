<?php
// Exercises the configured MySQL database inside a rollback-only transaction.
require __DIR__.'/../vendor/autoload.php';
$app=require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
use Illuminate\Support\Facades\{DB,Hash,Crypt};
use Illuminate\Http\Request;
use Carbon\CarbonImmutable;
use App\Support\{StaffAuth,OfficeCalendar,QueueData,VisitorAccess};

config(['services.turnstile.enabled'=>false,'broadcasting.default'=>'null','mail.default'=>'array','queue.default'=>'sync','cache.default'=>'array']);
if(DB::getDriverName()!=='mysql')throw new RuntimeException('This check is intended for the configured MySQL database.');
$tables=['staff_users','queues','queue_counters','shared_appointments','shared_transactions','shared_visitor_log','office_calendar','shared_system_settings','notification_outbox','system_audit'];
foreach($tables as $table){$engine=DB::selectOne('SELECT ENGINE AS engine FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[$table]);if(strtolower($engine->engine??'')!=='innodb')throw new RuntimeException('Rollback safety requires InnoDB: '.$table);}
$before=[];foreach($tables as $table)$before[$table]=DB::table($table)->count();
$checks=[];$error=null;
DB::beginTransaction();
try{
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-20 10:00','Asia/Manila'));
 DB::table('office_calendar')->where('id',1)->update(['payload'=>json_encode(OfficeCalendar::defaults())]);
 $settings=json_decode(DB::table('shared_system_settings')->where('id',1)->value('payload'),true);
 DB::table('shared_system_settings')->where('id',1)->update(['payload'=>json_encode(array_merge($settings,['maintenanceMode'=>false,'allowParallelService'=>false,'appointmentSlotCapacity'=>20]))]);
 $staffId='smoke-'.bin2hex(random_bytes(6));
 DB::table('staff_users')->insert(['id'=>$staffId,'username'=>$staffId,'full_name'=>'Flow smoke fixture','role'=>'ADMIN','password_hash'=>Hash::make('SmokeFixture!123456'),'is_active'=>true,'confidential_access'=>true,'confidential_approver'=>true]);
 $token=StaffAuth::token(DB::table('staff_users')->where('id',$staffId)->first());
 $call=function(string $method,string $path,array $body=[],bool $staff=false,int $expected=200,?string $roleToken=null,array $headers=[])use($app,$token,&$checks){
  if($method==='POST' && in_array($path,['/visits','/appointments']))$headers['HTTP_X_VISITOR_TOKEN']=VisitorAccess::token($body['email']);
  $server=['HTTP_ACCEPT'=>'application/json','CONTENT_TYPE'=>'application/json']+$headers;if($staff||$roleToken)$server['HTTP_AUTHORIZATION']='Bearer '.($roleToken??$token);
  $request=Request::create('/api'.$path,$method,[],[],[],$server,json_encode($body));
  $response=$app->make(Illuminate\Contracts\Http\Kernel::class)->handle($request);
  $data=json_decode($response->getContent(),true);
  if($response->getStatusCode()!==$expected)throw new RuntimeException($method.' '.$path.' expected '.$expected.', got '.$response->getStatusCode().': '.($data['message']??'Unknown error'));
  $checks[]=$method.' '.preg_replace('/(?:Q|A)[a-f0-9]{16}/','{fixture}',$path).' '.$expected;
  return $data;
 };
 $q=$call('POST','/visits',['visitorType'=>'Student','serviceKey'=>'good_moral','serviceLabel'=>'Good Moral','name'=>'Flow smoke visitor','email'=>$staffId.'@gmail.com','contact'=>'09123456789'],false,201)['queue'];
 $path='/queue/'.$q['id'];
 $call('PATCH',$path,['status'=>'Called'],true);
 $call('PATCH',$path,['status'=>'Serving'],true);
 $call('PATCH',$path,['status'=>'Waiting','serviceKey'=>'student_id'],true);
 $call('PATCH',$path,['status'=>'Called'],true);
 $call('PATCH',$path,['status'=>'Serving'],true);
 $call('PATCH',$path,['status'=>'Completed'],true);
 $stored=QueueData::read(DB::table('queues')->where('id',$q['id'])->value('portal_payload'));
 if(($stored['serviceHistory'][0]['serviceKey']??null)!=='good_moral'||empty($stored['transactionId']))throw new RuntimeException('Transfer or transaction was not persisted.');
 if(str_contains(DB::table('queues')->where('id',$q['id'])->value('portal_payload'),'Flow smoke visitor'))throw new RuntimeException('Queue personal details were stored without encryption.');
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-20 22:00','Asia/Manila'));
 $a=$call('POST','/appointments',['type'=>'Student','name'=>'Flow smoke visitor','email'=>$staffId.'@gmail.com','contact'=>'09123456789','serviceKey'=>'good_moral'],false,201)['appointment'];
 $a=$call('PATCH','/appointments/'.$a['id'],['date'=>'2026-10-21','time'=>'10:00','revision'=>0],true)['appointment'];
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-21 10:00','Asia/Manila'));
 $r=$call('POST','/appointments/'.$a['id'].'/check-in',[],true);
 $a=$call('POST','/queue/'.$r['queue']['id'].'/follow-up',['reason'=>'Bring remaining requirements on another day'],true)['appointment'];
 $call('PATCH','/appointments/'.$a['id'],['date'=>'2026-10-22','time'=>'10:00','revision'=>$a['revision']],true);
 CarbonImmutable::setTestNow(CarbonImmutable::parse('2026-10-22 10:00','Asia/Manila'));
 $resumed=$call('POST','/appointments/'.$a['id'].'/check-in',[],true);
 if($resumed['queue']['id']!==$r['queue']['id'])throw new RuntimeException('Recovery duplicated the queue record.');
 foreach(['ordinary'=>'ADMIN','super'=>'SUPER_ADMIN'] as $suffix=>$role){
  $id='audit-'.bin2hex(random_bytes(6));
  DB::table('staff_users')->insert(['id'=>$id,'username'=>$id,'full_name'=>'Role audit fixture','role'=>$role,'password_hash'=>Hash::make('SmokeFixture!123456'),'is_active'=>true,'confidential_access'=>false,'confidential_approver'=>false]);
  $roleToken=StaffAuth::token(DB::table('staff_users')->where('id',$id)->first());
  if($suffix==='ordinary'){
   $rows=$call('GET','/queue',[],false,200,$roleToken)['queues'];
   if(!collect($rows)->contains('id',$q['id']))throw new RuntimeException('Admin did not receive the stored visit.');
   $records=$call('GET','/service-records',[],false,200,$roleToken);
   if(!collect($records['transactions'])->contains('id',$stored['transactionId']))throw new RuntimeException('Completed transaction did not reach Admin records.');
   $call('GET','/reports',[],false,403,$roleToken);
   $call('POST','/walk-in-capacity/override',['counters'=>1,'mode'=>'automatic'],false,403,$roleToken);
  }else{
   $reports=$call('GET','/reports',[],false,200,$roleToken);
   foreach([...$reports['queues'],...$reports['appointments']] as $row)foreach(['name','email','contact','attachments'] as $field)if(array_key_exists($field,$row))throw new RuntimeException('Private field in Super Admin report: '.$field);
   $call('GET','/admins',[],false,200,$roleToken);
   $call('GET','/queue',[],false,403,$roleToken);
   $call('GET','/service-records',[],false,403,$roleToken);
  }
 }
 $call('GET','/visits/'.$q['visitId'],[],false,401);
 $own=$call('GET','/visits/'.$q['visitId'],[],false,200,null,['HTTP_X_VISITOR_TOKEN'=>VisitorAccess::token($staffId.'@gmail.com')]);
 if($own['queue']['id']!==$q['id'])throw new RuntimeException('Verified visitor received a different visit.');
 $call('GET','/visits/'.$q['visitId'],[],false,403,null,['HTTP_X_VISITOR_TOKEN'=>VisitorAccess::token('other@gmail.com')]);
 $public=$call('GET','/public-queue');
 foreach($public['queues'] as $row)foreach(['name','email','contact','attachments'] as $field)if(array_key_exists($field,$row))throw new RuntimeException('Private field in public queue: '.$field);
}catch(Throwable $e){$error=$e->getMessage();}
finally{while(DB::transactionLevel()>0)DB::rollBack();CarbonImmutable::setTestNow();}
$after=[];foreach($tables as $table)$after[$table]=DB::table($table)->count();
if($before!==$after)$error='Database row counts changed after rollback.';
echo json_encode(['passed'=>$error===null,'checks'=>$checks,'rolledBack'=>$before===$after,'error'=>$error],JSON_PRETTY_PRINT).PHP_EOL;
exit($error?1:0);
