<?php
namespace App\Http\Controllers;

use App\Support\{StaffAuth,ServicePrivacy,QueueData,CaseAccess,SystemAudit};
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{DB,Cache,Crypt};

class ReportDataController extends Controller
{
    private function canPrint(object $u,string $id):bool {
        $case=DB::table('confidential_cases')->where('id',$id)->first();if(!$case)return false;
        $grant=DB::table('confidential_requests')->where('case_id',$id)->where('requester_id',$u->id)->where('status','Approved')->where('scope','print')->where('expires_at','>',now())->exists();
        return (($u->confidential_approver??false)||$grant)&&(bool)Cache::get('conf-unlock:'.$u->id.':'.$id.':print');
    }
    public function snapshot(Request $r){
        $u=StaffAuth::user($r,'ADMIN');$d=$r->validate(['kind'=>'required|in:combined,service,transaction,logbook,appointment','id'=>'nullable|string|max:80','serviceKey'=>'nullable|string|max:50','includeConf'=>'required|boolean']);
        $include=$d['includeConf'];$kind=$d['kind'];$id=$d['id']??'';
        $headReport=($u->confidential_approver??false)&&(Cache::get('report-print:'.$u->id.':rpt:all')||($kind==='service'&&Cache::get('report-print:'.$u->id.':svc:'.($d['serviceKey']??''))));
        if($include&&in_array($kind,['combined','service']))abort_unless($headReport,403,'Unlock confidential report printing with your password first.');
        $transactions=[];$caseByQueue=[];
        foreach(DB::table('shared_transactions')->get() as $row){
            $t=json_decode(Crypt::decryptString($row->payload),true);$private=ServicePrivacy::confidential($t['service']??'');
            if($private)$caseByQueue[$row->queue_id]=$row->id;
            if(!in_array($kind,['combined','service','transaction']))continue;
            if($kind==='transaction'&&$row->id!==$id)continue;
            if($kind==='service'&&($t['service']??'')!==($d['serviceKey']??''))continue;
            if($private&&$include&&$kind==='transaction')abort_unless($this->canPrint($u,$row->id),403,'View and Print approval and an active print unlock are required.');
            if($private&&!$include)$t=array_intersect_key($t,array_flip(['id','code','service','status','caseStatus','createdAt','completedAt','waitingTimeMin','serviceTimeMin','totalTimeMin','shared']))+['name'=>'Restricted record','type'=>'','restricted'=>true];
            if(isset($t['attachments']))$t['attachments']=array_map(fn($f)=>array_intersect_key($f,array_flip(['name','size','type'])),$t['attachments']);
            $transactions[]=$t;
        }
        if($kind==='transaction')abort_unless(count($transactions),404,'Transaction not found.');
        $logs=[];
        if($kind==='logbook')foreach(DB::table('shared_visitor_log')->get() as $row){
            $l=json_decode(Crypt::decryptString($row->payload),true);$case=$caseByQueue[$row->queue_id]??null;
            $q=DB::table('queues')->where('id',$row->queue_id)->first();$queue=$q?QueueData::read($q->portal_payload):[];
            $private=$case||ServicePrivacy::confidential($queue['serviceKey']??'');
            if($private&&$include)abort_unless(($u->confidential_approver??false)&&($headReport||($case&&$this->canPrint($u,$case))),403,'Unlock confidential Visitor Log printing first.');
            if($private&&!$include)$l=array_intersect_key($l,array_flip(['id','timeIn','timeOut','source','shared']))+['name'=>'Restricted record','type'=>'','restricted'=>true];
            if($case)$l['confidentialCaseId']=$case;$logs[]=$l;
        }
        $appointments=[];$queues=[];
        foreach(DB::table('shared_appointments')->get() as $row){
            if($kind==='appointment'&&$row->id!==$id)continue;
            $private=ServicePrivacy::confidential($row->service_key);
            if($kind==='appointment'){
                if($private){
                    abort_unless($include,403,'Unlock confidential appointment printing first.');
                    $case=$caseByQueue[$row->queue_id]??null;
                    abort_unless($case?$this->canPrint($u,$case):(CaseAccess::canViewAppointment($u,$row)&&Cache::get('appointment-print:'.$u->id.':'.$row->id)),403,'View and Print permission and an active print unlock are required.');
                }
            }
            // Combined reports need scheduling metrics, not appointment identities.
            if($kind==='appointment')$a=AppointmentController::present($row);
            else $a=['id'=>$row->id,'status'=>$row->status,'date'=>$row->date,'time'=>$row->time,'createdAt'=>$row->created_at,'shared'=>true];
            if(isset($a['attachments']))$a['attachments']=array_map(fn($f)=>array_intersect_key($f,array_flip(['name','size','type'])),$a['attachments']);
            $appointments[]=$a;
        }
        if($kind==='appointment')abort_unless(count($appointments),404,'Appointment not found.');
        foreach(DB::table('queues')->get() as $row){
            $q=QueueData::read($row->portal_payload);
            // Queue data is used only for references/timings in generated reports.
            $queues[]=array_intersect_key($q,array_flip(['id','visitId','number','source','status','serviceKey','serviceLabel','scheduledAt','createdAt','checkedInAt','calledAt','servingAt','completedAt','shared']));
        }
        SystemAudit::record($u,'Data','Authorized report output',$kind,[['field'=>'Confidential details','from'=>'','to'=>$include?'Included':'Redacted']]);
        return response()->json(['transactions'=>$transactions,'visitorLog'=>$logs,'appointments'=>$appointments,'queues'=>$queues,'confidentialIncluded'=>$include]);
    }
}
