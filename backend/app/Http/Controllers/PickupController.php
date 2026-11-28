<?php
namespace App\Http\Controllers;

use App\Support\{CaseAccess,PrivateNotification,QueueData,ServicePrivacy,StaffAuth,SystemAudit,VisitorAccess};
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{Crypt,DB};

class PickupController extends Controller {
 public function sendDigital(Request $r,string $id) {
  $actor=StaffAuth::user($r,'ADMIN');
  $d=$r->validate(['name'=>'required|string|max:200','dataUrl'=>'required|string|max:7000000']);
  abort_unless(preg_match('~^data:(application/pdf|image/png|image/jpeg);base64,([A-Za-z0-9+/=]+)$~',$d['dataUrl'],$m),422,'Upload a PDF, PNG or JPEG.');
  $bytes=base64_decode($m[2],true);abort_unless($bytes!==false&&strlen($bytes)<=5*1024*1024&&(new \finfo(FILEINFO_MIME_TYPE))->buffer($bytes)===$m[1],422,'Invalid file or file larger than 5 MB.');
  abort_unless(config('mail.default')==='smtp'&&config('mail.mailers.smtp.username')&&config('mail.mailers.smtp.password'),503,'Email delivery is unavailable.');
  DB::transaction(function()use($actor,$id,$d,$m){
   $row=DB::table('shared_transactions')->where('id',$id)->lockForUpdate()->first();abort_unless($row,404);
   $record=json_decode(Crypt::decryptString($row->payload),true);
   if(ServicePrivacy::confidential($record['service']??''))abort_unless(CaseAccess::canEdit($actor,$id),403,'Confidential edit access is required.');
   abort_unless(($record['pickupStatus']??'')==='Ready'&&($record['deliveryFormat']??'')==='digital',409,'The visitor must select soft copy and the document must be ready.');
   abort_if(in_array($record['digitalDeliveryStatus']??'',['Queued','Sent']),409,'This document is already queued or sent.');
   $queue=DB::table('queues')->where('id',$row->queue_id)->lockForUpdate()->first();abort_unless($queue,409,'Visit not found.');$q=QueueData::read($queue->portal_payload);
   abort_unless(filter_var($q['email']??'',FILTER_VALIDATE_EMAIL),422,'No verified delivery email is available.');
   $record['digitalDeliveryStatus']=$q['digitalDeliveryStatus']='Queued';$record['digitalDeliveryQueuedAt']=$q['digitalDeliveryQueuedAt']=now()->toIso8601String();
   DB::table('shared_transactions')->where('id',$id)->update(['payload'=>Crypt::encryptString(json_encode($record)),'updated_at'=>now()]);
   DB::table('queues')->where('id',$queue->id)->update(['portal_payload'=>QueueData::write($q)]);
   \App\Jobs\SendDigitalDocument::dispatch($id,$queue->id,$q['email'],$d['name'],$m[1],$m[2])->afterCommit();
   SystemAudit::record($actor,'Transactions','Queued digital document delivery',$q['visitId']);
  });
  return response()->json(['queued'=>true],202);
 }
 public function preference(Request $r,string $visitId) {
  $data=$r->validate(['format'=>'required|in:hard,digital']);
  $queue=DB::transaction(function()use($r,$visitId,$data){
   $row=DB::table('queues')->where('visit_id',strtoupper($visitId))->lockForUpdate()->first();abort_unless($row,404,'Visit not found.');
   $q=QueueData::read($row->portal_payload);VisitorAccess::requireEmail($r,$q['email']??'');
   abort_unless($row->status==='Completed'&&in_array($q['pickupStatus']??'',['Preparing','Ready']),409,'Document delivery is not available for this visit.');
   if(!empty($q['pickupQueueId'])){
    $pickup=DB::table('queues')->where('id',$q['pickupQueueId'])->lockForUpdate()->first();
    abort_if($pickup&&in_array($pickup->status,['Waiting','Called','Serving','Skipped'],true),409,'A pickup visit is already active.');
   }
   $id=$q['transactionId']??DB::table('shared_transactions')->where('queue_id',$row->id)->value('id');
   $transaction=DB::table('shared_transactions')->where('id',$id)->lockForUpdate()->first();abort_unless($transaction,409,'The service record is unavailable.');
   $record=json_decode(Crypt::decryptString($transaction->payload),true);$previous=$record['deliveryFormat']??null;
   abort_if(in_array($record['digitalDeliveryStatus']??'',['Queued','Sent']),409,'The soft-copy delivery has already been queued or sent.');
   $record['deliveryFormat']=$q['deliveryFormat']=$data['format'];
   if($previous!==$data['format']&&($record['digitalDeliveryStatus']??'')==='Failed'){
    unset($record['digitalDeliveryStatus'],$record['digitalDeliveryFailedAt'],$record['digitalDeliveryQueuedAt'],$q['digitalDeliveryStatus'],$q['digitalDeliveryFailedAt'],$q['digitalDeliveryQueuedAt']);
   }
   if($previous!==$data['format']){$changedAt=now()->format('Y-m-d\\TH:i:s.uP');$record['deliveryFormatUpdatedAt']=$q['deliveryFormatUpdatedAt']=$changedAt;}
   if($data['format']==='digital') DB::table('notification_outbox')->where('visit_id',$q['visitId'])->where('kind','document-ready')->whereIn('status',['pending','paused','failed'])->update(['status'=>'superseded','updated_at'=>now()]);
   $pickupEmailQueued=false;
   if($previous!==$data['format']&&$data['format']==='hard'&&($q['pickupStatus']??'')==='Ready'&&DB::table('notification_outbox')->where('visit_id',$q['visitId'])->where('kind','document-ready')->where('status','sent')->exists()){
    $name=trim((string)($q['name']??''));$greeting=$name!==''?'Hi '.$name.',':'Hello,';
    $body=$greeting."\n\nYour hard copy is ready for pickup at OSS. Open Check My Visit using your Visit ID and join the pickup queue before coming. Bring your Visit ID and a valid ID.\n\nVisit ID: ".$q['visitId']."\n\nOffice of Student Services";
    $pickupEmailQueued=(bool)DB::table('notification_outbox')->insertOrIgnore(PrivateNotification::fields($q['email'],'Hard copy ready for pickup',$body)+['visit_id'=>$q['visitId'],'scheduled_at'=>now(),'send_at'=>now(),'kind'=>'pickup-ready','dedup_key'=>hash('sha256','pickup-ready|'.$id),'actor_id'=>'visitor','created_at'=>now(),'updated_at'=>now()]);
   }
   DB::table('shared_transactions')->where('id',$id)->update(['payload'=>Crypt::encryptString(json_encode($record)),'updated_at'=>now()]);
   DB::table('queues')->where('id',$row->id)->update(['portal_payload'=>QueueData::write($q)]);
   if($previous!==$data['format'])SystemAudit::record(null,'Transactions','Document delivery preference updated',$q['visitId'],[['field'=>'Format','from'=>$previous??'Not selected','to'=>$data['format']==='digital'?'Soft copy':'Hard copy']]);
   return ['queue'=>$q,'pickupEmailQueued'=>$pickupEmailQueued];
  });
  if($queue['pickupEmailQueued']&&config('mail.default')==='smtp'&&config('mail.mailers.smtp.username')&&config('mail.mailers.smtp.password'))\App\Jobs\DeliverAppointmentNotifications::dispatch();
  return response()->json(['queue'=>$queue['queue']]);
 }
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
   else {abort_unless($old==='Ready',409,'Mark the document ready before recording its release.');abort_if(($record['digitalDeliveryStatus']??'')==='Queued',409,'Wait for the soft copy delivery to finish before recording release.');abort_if(mb_strlen(trim($data['identityCheck']??''))<5,422,'Describe the identity check using at least 5 characters.');}
   $record['pickupStatus']=$data['status'];
   $record['pickupUpdatedAt']=now()->toIso8601String();
   if($data['status']==='Claimed'){$record['pickupClaimedBy']=$actor->full_name;$record['pickupIdentityCheck']=trim($data['identityCheck']);}
   DB::table('shared_transactions')->where('id',$id)->update(['payload'=>Crypt::encryptString(json_encode($record)),'updated_at'=>now()]);
   $queue=DB::table('queues')->where('id',$row->queue_id)->lockForUpdate()->first();
   abort_unless($queue,409,'The original visit is unavailable.');$original=QueueData::read($queue->portal_payload);
   if($data['status']==='Claimed'&&!empty($original['pickupQueueId'])&&DB::table('queues')->where('id',$original['pickupQueueId'])->whereIn('status',['Waiting','Called','Serving','Skipped'])->exists())abort(409,'Record the document release in the pickup queue checklist.');
   $original['pickupStatus']=$data['status'];DB::table('queues')->where('id',$queue->id)->update(['portal_payload'=>QueueData::write($original)]);
   $queued=false;$email=trim((string)($original['email']??''));
   if($data['status']==='Ready' && $old!=='Ready' && ($record['deliveryFormat']??'')!=='digital' && filter_var($email,FILTER_VALIDATE_EMAIL)) {
    $name=trim((string)($original['name']??''));$greeting=$name!==''?'Hi '.$name.',':'Hello,';
    $body=$greeting."\n\nYour document is ready. Open Check My Visit using your Visit ID and choose how you would like to receive it.\n\nVisit ID: ".$original['visitId']."\n\nOffice of Student Services";
    $queued=(bool)DB::table('notification_outbox')->insertOrIgnore(PrivateNotification::fields($email,'Document ready - choose delivery',$body)+['visit_id'=>$original['visitId'],'scheduled_at'=>now(),'send_at'=>now(),'kind'=>'document-ready','dedup_key'=>hash('sha256','document-ready|'.$id),'actor_id'=>$actor->id,'created_at'=>now(),'updated_at'=>now()]);
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
   abort_if(($original['deliveryFormat']??null)==='digital',409,'You selected a soft copy. Contact OSS if you need to change your choice.');
   abort_unless(($original['pickupStatus']??'')==='Ready',409,'This document is not ready for pickup.');
   if(!empty($original['pickupQueueId'])){$existing=DB::table('queues')->where('id',$original['pickupQueueId'])->first();if($existing&&in_array($existing->status,['Waiting','Called','Serving','Skipped']))return response()->json(['queue'=>QueueData::read($existing->portal_payload)]);}
   \App\Support\Availability::requireOpen();
   $input=array_intersect_key($original,array_flip(['visitorType','serviceKey','serviceLabel','name','idNumber','idType','guestClass','contact','email','isSenior','isPWD']));
   $new=Request::create('/api/visits','POST',$input);$new->headers->set('X-Visitor-Token',$r->header('X-Visitor-Token',''));$new->headers->set('Accept','application/json');
   $new->attributes->set('document_pickup',true);
   $response=app(QueueController::class)->create($new);$payload=$response->getData(true);
   abort_if($payload['existing']??false,409,'You already have an active walk-in visit. Finish or cancel it before joining the pickup queue.');
   $queue=$payload['queue'];
   $queue['pickupOfVisitId']=$original['visitId'];$queue['pickupTransactionId']=$original['transactionId']??DB::table('shared_transactions')->where('queue_id',$row->id)->value('id');
   abort_unless($queue['pickupTransactionId'],409,'The original transaction could not be found.');
   $queue['serviceLabel']='Document pickup · '.($queue['serviceLabel']??'Good Moral Certificate');
   DB::table('queues')->where('id',$queue['id'])->update(['service_label_text'=>$queue['serviceLabel'],'portal_payload'=>QueueData::write($queue)]);
   $original['pickupQueueId']=$queue['id'];DB::table('queues')->where('id',$row->id)->update(['portal_payload'=>QueueData::write($original)]);
   return response()->json(['queue'=>$queue,'visitToken'=>$payload['visitToken']],201);
  });
 }
}
