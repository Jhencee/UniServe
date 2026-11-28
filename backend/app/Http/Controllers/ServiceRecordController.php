<?php
namespace App\Http\Controllers;
use App\Support\StaffAuth;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{DB,Crypt};
class ServiceRecordController extends Controller {
 public function update(Request $r,string $id){
  $u=StaffAuth::user($r,'ADMIN');
  $visitId=DB::transaction(function()use($u,$r,$id){$row=DB::table('shared_transactions')->where('id',$id)->lockForUpdate()->first();abort_unless($row,404);$t=json_decode(Crypt::decryptString($row->payload),true);
   if(\App\Support\ServicePrivacy::confidential($t['service']))abort_unless(\App\Support\CaseAccess::canEdit($u,$id),403,'Assigned Admin and active unlock required.');
   $d=$r->validate(['escalation'=>'required|in:Normal,For Review,Escalated,Resolved','caseStatus'=>'sometimes|in:Pending,Open,In Progress,Approval,On hold,Resolved,Closed','ownerId'=>'required|string|max:80','dueDate'=>'required|date_format:Y-m-d','nextAction'=>'required|string|max:500','notes'=>'nullable|string|max:2000','revision'=>'required|integer|min:0']);
   abort_unless(($t['caseRevision']??0)===$d['revision'],409,'This case changed. Refresh before saving.');
   $owner=DB::table('staff_users')->where('id',$d['ownerId'])->where('role','ADMIN')->where('is_active',true)->first();abort_unless($owner,422,'Choose an active Admin as case owner.');
   if(\App\Support\ServicePrivacy::confidential($t['service']))abort_unless(\App\Support\CaseAccess::canEdit($owner,$id),422,'Ask the Super Admin to assign confidential access before changing the case owner.');
   $notes=trim($d['notes']??'');$action=trim($d['nextAction']);abort_if($action==='',422,'Enter the next action.');
   $newStatus=$d['caseStatus']??($t['caseStatus']??match($d['escalation']){'Resolved'=>'Resolved','For Review','Escalated'=>'In Progress',default=>'Open'});
   abort_if((in_array($newStatus,['Resolved','Closed'],true)||in_array($t['caseStatus']??'',['Resolved','Closed'],true))&&$newStatus!==($t['caseStatus']??'')&&$notes==='',422,'Resolution, closure or reopening requires notes.');
   $t['caseHistory'][]=['at'=>now()->toIso8601String(),'by'=>$u->full_name,'from'=>$t['escalation']??'Normal','to'=>$d['escalation'],'ownerName'=>$owner->full_name,'dueDate'=>$d['dueDate'],'nextAction'=>$action,'notes'=>$notes];
   $t['caseOwnerId']=$owner->id;$t['caseOwnerName']=$owner->full_name;$t['caseDueDate']=$d['dueDate'];$t['caseNextAction']=$action;$t['caseNotes']=$notes;$t['caseRevision']=($t['caseRevision']??0)+1;
   $oldStatus=$t['caseStatus']??'Open';$t['caseStatus']=$newStatus;
   if($oldStatus!==$newStatus)\App\Support\SystemAudit::record($u,'Transactions','Case status changed',$t['code']??$id,[['field'=>'Status','from'=>$oldStatus,'to'=>$newStatus]]);
   $queue=DB::table('queues')->where('id',$row->queue_id)->lockForUpdate()->first();if($queue){$q=\App\Support\QueueData::read($queue->portal_payload);$q['caseStatus']=$t['caseStatus'];DB::table('queues')->where('id',$queue->id)->update(['portal_payload'=>\App\Support\QueueData::write($q)]);}
   $beforeEscalation=$t['escalation']??'Normal';$t['escalation']=$d['escalation']==='Normal'?null:$d['escalation'];$t['escalatedBy']=$u->full_name;$t['updatedAt']=now()->toIso8601String();DB::table('shared_transactions')->where('id',$id)->update(['payload'=>Crypt::encryptString(json_encode($t)),'updated_at'=>now()]);\App\Support\SystemAudit::record($u,'Transactions','Updated record escalation',$t['code']??$id,[['field'=>'Escalation','from'=>$beforeEscalation,'to'=>$d['escalation']]]);
   return $t['visitId']??null;
  });return response()->json(['saved'=>true,'visitId'=>$visitId]);
 }
 public function index(Request $r){$u=StaffAuth::user($r,'ADMIN');
  $transactions=DB::table('shared_transactions')->get()->map(fn($row)=>json_decode(Crypt::decryptString($row->payload),true));
  $pickupEmails=DB::table('notification_outbox')->where('kind','document-ready')->orderBy('id')->get(['visit_id','status','last_error'])->keyBy('visit_id');
  $restricted=[];
  $transactions=$transactions->map(function($t)use($u,&$restricted,$pickupEmails){
   $confidential=\App\Support\ServicePrivacy::confidential($t['service']);
   $t['permissions']=['editCase'=>!$confidential||\App\Support\CaseAccess::canEdit($u,$t['id'])];
   if(!empty($t['pickupStatus']) && !empty($t['visitId'])){$notice=$pickupEmails->get($t['visitId']);if($notice)$t['pickupEmailStatus']=$notice->status==='pending'&&$notice->last_error?'retrying':$notice->status;}
   if(!$confidential)return $t;
   if(\App\Support\CaseAccess::canView($u,$t['id'])){
    if(\Illuminate\Support\Facades\Cache::add('audit-case-view:'.$u->id.':'.$t['id'],true,300))\App\Support\SystemAudit::record($u,'Confidential','Confidential record viewed',$t['code']??$t['id']);
    return $t;
   }
   $restricted[]=$t['visitId'];
   return array_intersect_key($t,array_flip(['id','code','service','status','caseStatus','pickupStatus','createdAt','completedAt','waitingTimeMin','serviceTimeMin','totalTimeMin','shared']))+['name'=>'Restricted record','type'=>'','attachments'=>[],'restricted'=>true];
  });
  $transactions=$transactions->map(function($t){
   if(!empty($t['restricted'])||empty($t['pickupStatus'])||empty($t['queueId']))return $t;
   $first=DB::table('queues')->where('id',$t['queueId'])->first();if(!$first||!$first->portal_payload)return $t;
   $original=\App\Support\QueueData::read($first->portal_payload);
   $project=static function($row,$queue){$result=array_intersect_key($queue,array_flip(['visitId','number','checkedInAt','calledAt','servingAt','completedAt']));$result['status']=$row->status;if(empty($result['completedAt'])&&!empty($row->completed_at))$result['completedAt']=\Illuminate\Support\Carbon::parse($row->completed_at,'UTC')->toIso8601String();return $result;};
   $t['firstVisit']=$project($first,$original);
   $pickupRow=!empty($original['pickupQueueId'])?DB::table('queues')->where('id',$original['pickupQueueId'])->first():null;
   $pickup=$pickupRow&&$pickupRow->portal_payload?\App\Support\QueueData::read($pickupRow->portal_payload):[];
   if($pickupRow&&($pickup['pickupTransactionId']??null)===($t['id']??null)&&($pickup['pickupOfVisitId']??null)===($original['visitId']??null))$t['pickupVisit']=$project($pickupRow,$pickup);
   return $t;
  });
  return response()->json(['transactions'=>$transactions,'visitorLog'=>DB::table('shared_visitor_log')->get()->map(function($row)use($restricted,$u){$l=json_decode(Crypt::decryptString($row->payload),true);$queue=DB::table('queues')->where('id',$row->queue_id)->first();$data=$queue?\App\Support\QueueData::read($queue->portal_payload):[];if(!empty($data['checkedInAt']))$l['timeIn']=$data['checkedInAt'];$masked=$queue?\App\Support\QueueData::forStaff($data,$u):null;if(in_array($l['visitId'],$restricted)||($masked['restricted']??false))$l=array_intersect_key($l,array_flip(['id','timeIn','timeOut','shared']))+['name'=>'Restricted record','type'=>'','restricted'=>true];$transaction=DB::table('shared_transactions')->where('queue_id',$row->queue_id)->first();if($transaction){$t=json_decode(Crypt::decryptString($transaction->payload),true);if(\App\Support\ServicePrivacy::confidential($t['service']))$l['confidentialCaseId']=$transaction->id;}return $l;})]);
 }
}
