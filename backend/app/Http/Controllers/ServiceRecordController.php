<?php
namespace App\Http\Controllers;
use App\Support\StaffAuth;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{DB,Crypt};
class ServiceRecordController extends Controller {
 public function update(Request $r,string $id){
  $u=StaffAuth::user($r,'ADMIN');$d=$r->validate(['escalation'=>'required|in:Normal,For Review,Escalated,Resolved']);
  $visitId=DB::transaction(function()use($u,$d,$id){$row=DB::table('shared_transactions')->where('id',$id)->lockForUpdate()->first();abort_unless($row,404);$t=json_decode(Crypt::decryptString($row->payload),true);
   if(\App\Support\ServicePrivacy::confidential($t['service']))abort_unless((($u->confidential_approver??false)||DB::table('confidential_cases')->where('id',$id)->where('assigned_admin_id',$u->id)->exists())&&\Illuminate\Support\Facades\Cache::get('conf-unlock:'.$u->id.':'.$id.':view'),403,'Assigned Admin and active unlock required.');
   $t['caseStatus']=match($d['escalation']){'Resolved'=>'Resolved','For Review','Escalated'=>'For Review',default=>'Open'};
   $queue=DB::table('queues')->where('id',$row->queue_id)->lockForUpdate()->first();if($queue){$q=\App\Support\QueueData::read($queue->portal_payload);$q['caseStatus']=$t['caseStatus'];DB::table('queues')->where('id',$queue->id)->update(['portal_payload'=>\App\Support\QueueData::write($q)]);}
   $beforeEscalation=$t['escalation']??'Normal';$t['escalation']=$d['escalation']==='Normal'?null:$d['escalation'];$t['escalatedBy']=$u->full_name;$t['updatedAt']=now()->toIso8601String();DB::table('shared_transactions')->where('id',$id)->update(['payload'=>Crypt::encryptString(json_encode($t)),'updated_at'=>now()]);\App\Support\SystemAudit::record($u,'Transactions','Updated record escalation',$t['code']??$id,[['field'=>'Escalation','from'=>$beforeEscalation,'to'=>$d['escalation']]]);
   return $t['visitId']??null;
  });return response()->json(['saved'=>true,'visitId'=>$visitId]);
 }
 public function index(Request $r){$u=StaffAuth::user($r,'ADMIN');
  $transactions=DB::table('shared_transactions')->get()->map(fn($row)=>json_decode(Crypt::decryptString($row->payload),true));
  $restricted=[];
  $transactions=$transactions->map(function($t)use($u,&$restricted){
   if(!\App\Support\ServicePrivacy::confidential($t['service']))return $t;
   $assigned=DB::table('confidential_cases')->where('id',$t['id'])->where('assigned_admin_id',$u->id)->exists();
   $approved=DB::table('confidential_requests')->where('case_id',$t['id'])->where('requester_id',$u->id)->where('status','Approved')->where('expires_at','>',now())->exists();
   if(($u->confidential_approver||$assigned||$approved) && \Illuminate\Support\Facades\Cache::get('conf-unlock:'.$u->id.':'.$t['id'].':view')){
    if(\Illuminate\Support\Facades\Cache::add('audit-case-view:'.$u->id.':'.$t['id'],true,300))\App\Support\SystemAudit::record($u,'Confidential','Confidential record viewed',$t['code']??$t['id']);
    return $t;
   }
   $restricted[]=$t['visitId'];
   return array_intersect_key($t,array_flip(['id','code','service','status','caseStatus','createdAt','shared']))+['name'=>'Restricted record','type'=>'','attachments'=>[],'restricted'=>true];
  });
  return response()->json(['transactions'=>$transactions,'visitorLog'=>DB::table('shared_visitor_log')->get()->map(function($row)use($restricted,$u){$l=json_decode(Crypt::decryptString($row->payload),true);$queue=DB::table('queues')->where('id',$row->queue_id)->first();$masked=$queue?\App\Support\QueueData::forStaff(\App\Support\QueueData::read($queue->portal_payload),$u):null;if(in_array($l['visitId'],$restricted)||($masked['restricted']??false))$l=array_intersect_key($l,array_flip(['id','timeIn','timeOut','shared']))+['name'=>'Restricted record','type'=>''];return $l;})]);
 }
}
