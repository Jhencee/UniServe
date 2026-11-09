<?php
namespace App\Support;
use Illuminate\Support\Facades\{Crypt,Schema};
class QueueData {
 public static function requirements(array $q):array {
  $payload=Schema::hasTable('service_catalog')?\Illuminate\Support\Facades\DB::table('service_catalog')->where('key',$q['serviceKey']??'')->value('payload'):null;
  $labels=array_values(array_unique(array_filter(array_map('trim',json_decode($payload??'{}',true)['requirements']??[]))));
  $accepted=[];
  if(!empty($q['appointmentId'])&&Schema::hasTable('shared_appointments')){
   $row=\Illuminate\Support\Facades\DB::table('shared_appointments')->where('id',$q['appointmentId'])->first();
   if($row&&$row->service_key===($q['serviceKey']??'')){
    $a=json_decode(Crypt::decryptString($row->payload),true);
    foreach($a['attachments']??[] as $file)if(($file['review']['status']??'')==='Accepted'&&($file['review']['serviceKey']??'')===($q['serviceKey']??'')&&!empty($file['review']['requirement']))$accepted[]=$file['review']['requirement'];
   }
  }
  $items=[];$count=0;
  foreach($labels as $label){
   $source=in_array($label,$accepted,true)?'upload':null;
   if(!$source)foreach($q['requirementChecks']??[] as $check)if(($check['serviceKey']??'')===($q['serviceKey']??'')&&($check['requirement']??'')===$label&&!empty($check['checked'])){$source='counter';break;}
   $items[]=['label'=>$label,'checked'=>$source!==null,'source'=>$source];if($source)$count++;
  }
  return ['items'=>$items,'required'=>count($labels),'checked'=>$count,'ready'=>$count===count($labels)];
 }
 public static function forStaff(array $q,object $u):array {
  if(!\App\Support\ServicePrivacy::confidential($q['serviceKey']??''))return array_replace($q,['requirementReadiness'=>self::requirements($q)]);
  $allowed=$u->confidential_access??false;
  $caseId=$q['transactionId']??null;
  if(!$caseId&&($q['status']??'')==='Completed'&&Schema::hasTable('shared_transactions'))$caseId=\Illuminate\Support\Facades\DB::table('shared_transactions')->where('queue_id',$q['id']??'')->value('id');
  if($caseId){
   $q['transactionId']=$caseId;
   $allowed=CaseAccess::canView($u,$caseId);
  }else $allowed=($q['status']??'')!=='Completed'&&$allowed&&($q['assignedAdminId']??null)===$u->id;
  if(!$allowed)$q=array_intersect_key($q,array_flip(['id','visitId','number','status','caseStatus','source','serviceKey','serviceLabel','scheduledAt','queueEnteredAt','checkedInAt','createdAt','calledAt','servingAt','completedAt','recalledAt','recallCount','assignedAdminId','assignedAdminName','transactionId','appointmentId','visitorLogId','isSenior','isPWD','shared']))+['name'=>'Restricted record','restricted'=>true];
  if(empty($q['restricted']))$q['requirementReadiness']=self::requirements($q);
  return $q;
 }
 public static function read(?string $value):array {if(!$value)return [];$data=json_decode($value,true)??[];return isset($data['_encrypted'])?json_decode(Crypt::decryptString($data['_encrypted']),true):$data;}
 public static function write(array $q):string{return Schema::hasColumn('queues','visit_id')?json_encode(['_encrypted'=>Crypt::encryptString(json_encode($q))]):json_encode($q);}
 public static function index(array $q):array{return Schema::hasColumn('queues','visit_id')?['visit_id'=>$q['visitId']??null,'email_hash'=>\App\Support\EmailIndex::key(strtolower($q['email']??''))]:[];}
}
