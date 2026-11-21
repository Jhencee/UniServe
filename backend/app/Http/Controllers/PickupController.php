<?php
namespace App\Http\Controllers;

use App\Support\{CaseAccess,PrivateNotification,QueueData,ServicePrivacy,StaffAuth,SystemAudit,VisitorAccess};
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{Crypt,DB};

class PickupController extends Controller {
 public function status(Request $r,string $id) {
  $actor=StaffAuth::user($r,'ADMIN');
  $data=$r->validate(['status'=>'required|in:Preparing,Ready,Claimed','identityCheck'=>'required_if:status,Claimed|nullable|string|min:5|max:500']);
  $notification=DB::transaction(function()use($actor,$data,$id){
   $row=DB::table('shared_transactions')->where('id',$id)->lockForUpdate()->first();abort_unless($row,404);
   $record=json_decode(Crypt::decryptString($row->payload),true);
   abort_unless(($record['status']??'')==='Completed'&&!empty($record['service']),422,'Only completed service records can be marked for document pickup.');
   if(ServicePrivacy::confidential($record['service']))abort_unless(CaseAccess::canEdit($actor,$id),403,'Assigned Admin and active confidential access are required.');
   $old=$record['pickupStatus']??null;
   if($data['status']==='Preparing')abort_if(in_array($old,['Ready','Claimed'],true),409,'This document is already ready or claimed.');
   elseif($data['status']==='Ready')abort_if($old==='Claimed',409,'This document was already claimed.');
   else {abort_unless($old==='Ready',409,'Mark the document ready before recording its release.');abort_if(mb_strlen(trim($data['identityCheck']??''))<5,422,'Describe the identity check using at least 5 characters.');}
   $record['pickupStatus']=$data['status'];
   $record['pickupUpdatedAt']=now()->toIso8601String();
   if($data['status']==='Claimed'){$record['pickupClaimedBy']=$actor->full_name;$record['pickupIdentityCheck']=trim($data['identityCheck']);}
   DB::table('shared_transactions')->where('id',$id)->update(['payload'=>Crypt::encryptString(json_encode($record)),'updated_at'=>now()]);
   $queue=DB::table('queues')->where('id',$row->queue_id)->lockForUpdate()->first();
   abort_unless($queue,409,'The original visit is unavailable.');$original=QueueData::read($queue->portal_payload);
   if($data['status']==='Claimed'&&!empty($original['pickupQueueId']))abort(409,'Record the document release in the pickup queue checklist.');
   $original['pickupStatus']=$data['status'];DB::table('queues')->where('id',$queue->id)->update(['portal_payload'=>QueueData::write($original)]);
   $queued=false;$email=trim((string)($original['email']??''));
   if($data['status']==='Ready' && $old!=='Ready' && filter_var($email,FILTER_VALIDATE_EMAIL)) {
    $name=trim((string)($original['name']??''));$greeting=$name!==''?'Hi '.$name.',':'Hello,';
    $body=$greeting."\n\nYour document is ready for pickup at the Office of Student Services.\n\nVisit ID: ".$original['visitId']."\n\n1. Go to OSS during office hours.\n2. Open Check My Visit and join the pickup queue.\n3. Show your Visit ID and a valid ID to OSS staff.\n\nWalk-in intake is subject to office hours and availability.\n\nOffice of Student Services";
    $queued=(bool)DB::table('notification_outbox')->insertOrIgnore(PrivateNotification::fields($email,'Document ready for pickup',$body)+['visit_id'=>$original['visitId'],'scheduled_at'=>now(),'send_at'=>now(),'kind'=>'document-ready','dedup_key'=>hash('sha256','document-ready|'.$id),'actor_id'=>$actor->id,'created_at'=>now(),'updated_at'=>now()]);
   }
   if($data['status']==='Claimed')DB::table('notification_outbox')->where('visit_id',$original['visitId'])->where('kind','document-ready')->whereIn('status',['pending','paused','failed'])->update(['status'=>'cancelled','updated_at'=>now()]);
   SystemAudit::record($actor,'Transactions',match($data['status']){'Preparing'=>'Marked document for preparation','Ready'=>'Marked document ready for pickup',default=>'Recorded document release'},$record['code']??$id);
   return ['emailQueued'=>$queued,'emailAvailable'=>(bool)filter_var($email,FILTER_VALIDATE_EMAIL)];
  });
  if($notification['emailQueued']&&config('mail.default')==='smtp'&&config('mail.mailers.smtp.username')&&config('mail.mailers.smtp.password'))\App\Jobs\DeliverAppointmentNotifications::dispatch();
  return response()->json(['saved'=>true]+$notification);
 }
 public function join(Request $r,string $visitId) {
  return DB::transaction(function()use($r,$visitId){
   $row=DB::table('queues')->where('visit_id',strtoupper($visitId))->lockForUpdate()->first();abort_unless($row,404,'Visit not found.');
   $original=QueueData::read($row->portal_payload);VisitorAccess::requireEmail($r,$original['email']??'');
   abort_unless(($original['pickupStatus']??'')==='Ready',409,'This document is not ready for pickup.');
   if(!empty($original['pickupQueueId'])){$existing=DB::table('queues')->where('id',$original['pickupQueueId'])->first();if($existing&&in_array($existing->status,['Waiting','Called','Serving','Skipped']))return response()->json(['queue'=>QueueData::read($existing->portal_payload)]);}
   $input=array_intersect_key($original,array_flip(['visitorType','serviceKey','serviceLabel','name','idNumber','idType','guestClass','contact','email','isSenior','isPWD']));
   $new=Request::create('/api/visits','POST',$input);$new->headers->set('X-Visitor-Token',$r->header('X-Visitor-Token',''));$new->headers->set('Accept','application/json');
   $response=app(QueueController::class)->create($new);$payload=$response->getData(true);$queue=$payload['queue'];
   $queue['pickupOfVisitId']=$original['visitId'];$queue['pickupTransactionId']=$original['transactionId']??DB::table('shared_transactions')->where('queue_id',$row->id)->value('id');
   abort_unless($queue['pickupTransactionId'],409,'The original transaction could not be found.');
   $queue['serviceLabel']='Document pickup · '.($queue['serviceLabel']??'Good Moral Certificate');
   DB::table('queues')->where('id',$queue['id'])->update(['service_label_text'=>$queue['serviceLabel'],'portal_payload'=>QueueData::write($queue)]);
   $original['pickupQueueId']=$queue['id'];DB::table('queues')->where('id',$row->id)->update(['portal_payload'=>QueueData::write($original)]);
   return response()->json(['queue'=>$queue,'visitToken'=>$payload['visitToken']],201);
  });
 }
}
