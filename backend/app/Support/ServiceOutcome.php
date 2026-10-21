<?php
namespace App\Support;
use Illuminate\Support\Facades\{DB,Crypt,Schema};
class ServiceOutcome {
 public static function save(array &$q,object $actor): void {
  if(!Schema::hasTable('shared_transactions'))return;
  if(in_array($q['status'],['Serving','Completed','Cancelled'])){
   $row=DB::table('shared_visitor_log')->where('queue_id',$q['id'])->first();
   if($q['status']==='Cancelled'&&!$row)return;
   $log=$row?json_decode(Crypt::decryptString($row->payload),true):['id'=>'L'.bin2hex(random_bytes(8)),'visitId'=>$q['visitId'],'name'=>$q['name'],'type'=>$q['visitorType'],'idNumber'=>$q['idNumber']??'','contact'=>$q['contact']??'','email'=>$q['email']??'','source'=>$q['source'],'purpose'=>$q['serviceLabel'],'timeIn'=>$q['servingAt']??now()->toIso8601String(),'timeOut'=>null,'shared'=>true];
   if(!empty($log['timeOut'])&&$q['status']==='Serving'){$log['timeIn']=$q['servingAt']??now()->toIso8601String();$log['timeOut']=null;}
   $log['serviceHistory']=$q['serviceHistory']??[];
   $log['purpose']=$q['serviceLabel'];$log['outcome']=$q['status'];
   if(in_array($q['status'],['Completed','Cancelled']))$log['timeOut']=$q['completedAt']??now()->toIso8601String();
   DB::table('shared_visitor_log')->updateOrInsert(['queue_id'=>$q['id']],['id'=>$log['id'],'payload'=>Crypt::encryptString(json_encode($log)),'created_at'=>$row->created_at??now(),'updated_at'=>now()]);
  }
  if($q['status']==='Completed'){
   $existing=DB::table('shared_transactions')->where('queue_id',$q['id'])->first();
   $txn=$existing?json_decode(Crypt::decryptString($existing->payload),true):['id'=>'T'.bin2hex(random_bytes(8)),'code'=>'OSS-'.strtoupper(bin2hex(random_bytes(4))),'name'=>$q['name'],'type'=>$q['visitorType'],'service'=>$q['serviceKey'],'email'=>$q['email']??'','idNumber'=>$q['idNumber']??'','status'=>'Completed','queueId'=>$q['id'],'visitId'=>$q['visitId'],'appointmentId'=>$q['appointmentId']??null,'queueNumber'=>$q['number']??null,'entryMethod'=>$q['source'],'servedBy'=>$actor->full_name,'createdAt'=>$q['createdAt'],'completedAt'=>$q['completedAt']??now()->toIso8601String(),'shared'=>true];
   $txn['serviceHistory']=$q['serviceHistory']??[];
   $txn['caseStatus']??=in_array($q['serviceKey'],['incident_report','concern'])?'Open':null;$q['caseStatus']=$txn['caseStatus'];
   $elapsed=fn($a,$b)=>$a&&$b?max(0,(strtotime($b)-strtotime($a))/60):null;$txn['waitingTimeMin']=$elapsed($q['checkedInAt']??$q['createdAt']??null,$q['servingAt']??null);$txn['serviceTimeMin']=$elapsed($q['servingAt']??null,$q['completedAt']??null);$txn['totalTimeMin']=$elapsed($q['checkedInAt']??$q['createdAt']??null,$q['completedAt']??null);
   DB::table('shared_transactions')->updateOrInsert(['queue_id'=>$q['id']],['id'=>$txn['id'],'payload'=>Crypt::encryptString(json_encode($txn)),'created_at'=>$existing->created_at??now(),'updated_at'=>now()]);$q['transactionId']=$txn['id'];
   if(!empty($q['appointmentId'])){
    $appointment=DB::table('shared_appointments')->where('id',$q['appointmentId'])->first();
    if($appointment){$txn['attachments']=\App\Http\Controllers\AppointmentController::present($appointment)['attachments']??[];DB::table('shared_transactions')->where('id',$txn['id'])->update(['payload'=>Crypt::encryptString(json_encode($txn))]);}
   }
   if(\App\Support\ServicePrivacy::confidential($txn['service'])) DB::table('confidential_cases')->insertOrIgnore(['id'=>$txn['id'],'code'=>$txn['code'],'assigned_admin_id'=>$actor->id,'created_at'=>now(),'updated_at'=>now()]);
   if(!empty($q['appointmentId']))DB::table('shared_appointments')->where('id',$q['appointmentId'])->update(['status'=>'Completed','updated_at'=>now()]);
  }
 }
}
