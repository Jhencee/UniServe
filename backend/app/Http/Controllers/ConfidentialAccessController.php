<?php
namespace App\Http\Controllers;
use App\Support\StaffAuth;
use App\Support\SystemAudit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
class ConfidentialAccessController extends Controller {
    private function permitted(object $u, string $id, string $scope): bool {
        $case=DB::table('confidential_cases')->where('id',$id)->first();
        if (!$case) return false;
        if ($u->confidential_approver || ($scope==='view' && $case->assigned_admin_id===$u->id)) return true;
        $q=DB::table('confidential_requests')->where('case_id',$id)->where('requester_id',$u->id)->where('status','Approved')->where('expires_at','>',now());
        if ($scope==='print') $q->where('scope','print');
        return $q->exists();
    }
    public function status(Request $r,string $id) {
        $u=$this->actor($r,true);
        $scope=$r->validate(['scope'=>'sometimes|in:view,print'])['scope']??'view';
        abort_unless($this->permitted($u,$id,$scope),403,'Case access expired or was revoked.');
        return response()->json(['allowed'=>true]);
    }
    public function history(Request $r,string $id) {
        $u=$this->actor($r,true);
        abort_unless($u->confidential_approver || $this->permitted($u,$id,'view'),403);
        $code=DB::table('confidential_cases')->where('id',$id)->value('code');
        return response()->json(['events'=>DB::table('system_audit')->where('category','Confidential')->whereIn('target',array_filter([$id,$code]))->orderByDesc('created_at')->limit(100)->get(['actor_name','action','created_at'])]);
    }
    private function actor(Request $r,bool $requester=false): object {
        $u=StaffAuth::user($r);
        abort_unless($u->role==='ADMIN' && ($requester || $u->confidential_access),403,'Confidential access required.');
        return $u;
    }
    public function index(Request $r) {
        $u=$this->actor($r,true);
        $q=DB::table('confidential_requests as r')->join('staff_users as u','u.id','=','r.requester_id')->join('confidential_cases as c','c.id','=','r.case_id');
        if (!$u->confidential_approver) $q->where('r.requester_id',$u->id);
        return response()->json(['approver'=>(bool)$u->confidential_approver,'requests'=>$q->select('r.*','u.full_name as requester_name','c.code')->orderByDesc('r.created_at')->limit(200)->get(),
            'cases'=>DB::table('confidential_cases')->when(!$u->confidential_approver,fn($q)=>$q->where('assigned_admin_id',$u->id))->get(['id','code','assigned_admin_id']),
            'admins'=>DB::table('staff_users')->where('role','ADMIN')->where('is_active',true)->get(['id','full_name'])]);
    }
    public function register(Request $r) {
        $u=$this->actor($r); $d=$r->validate(['id'=>'required|string|max:80','code'=>'required|string|max:80']);
        $added=DB::table('confidential_cases')->insertOrIgnore($d+['created_at'=>now(),'updated_at'=>now()]);
        if($added)SystemAudit::record($u,'Confidential','Confidential case registered',$d['id']);
        $r->attributes->set('system_audit_recorded',true);
        return response()->json(['saved'=>true]);
    }
    public function assign(Request $r,string $id) {
        $u=$this->actor($r); abort_unless($u->confidential_approver,403,'Approver permission required.');
        $d=$r->validate(['adminId'=>'required|string']);
        abort_unless(DB::table('staff_users')->where('id',$d['adminId'])->where('role','ADMIN')->where('is_active',true)->exists(),422,'Select an active Admin.');
        abort_unless(DB::table('confidential_cases')->where('id',$id)->exists(),404);
        DB::table('confidential_cases')->where('id',$id)->update(['assigned_admin_id'=>$d['adminId'],'updated_at'=>now()]);
        DB::table('confidential_requests')->where('case_id',$id)->where('status','Approved')->update(['status'=>'Revoked','updated_at'=>now()]);
        SystemAudit::record($u,'Confidential','Confidential case assigned',$id,[['field'=>'Assigned Admin','from'=>'','to'=>DB::table('staff_users')->where('id',$d['adminId'])->value('full_name')]]);
        return response()->json(['saved'=>true]);
    }
    public function store(Request $r) {
        $u=$this->actor($r,true); $d=$r->validate(['caseId'=>'required|string|max:80','scope'=>'required|in:view,print','reason'=>'required|string|min:5|max:500']);
        abort_unless(DB::table('confidential_cases')->where('id',$d['caseId'])->exists(),404);
        $id=(string)Str::uuid();
        DB::transaction(function() use($u,$d,$id) {
            DB::table('confidential_cases')->where('id',$d['caseId'])->lockForUpdate()->first();
            abort_if(DB::table('confidential_requests')->where('case_id',$d['caseId'])->where('requester_id',$u->id)->where('scope',$d['scope'])->where('status','Pending')->exists(),409,'This access request is already pending.');
            DB::table('confidential_requests')->insert(['id'=>$id,'case_id'=>$d['caseId'],'requester_id'=>$u->id,'scope'=>$d['scope'],'reason'=>$d['reason'],'created_at'=>now(),'updated_at'=>now()]);
            SystemAudit::record($u,'Confidential','Requested '.$d['scope'].' access',$d['caseId']);
        });
        return response()->json(['id'=>$id],201);
    }
    public function review(Request $r,string $id) {
        $u=$this->actor($r); abort_unless($u->confidential_approver,403,'Approver permission required.');
        $d=$r->validate(['scope'=>'sometimes|in:view,print','decision'=>'required|in:Approved,Denied,Revoked','minutes'=>'required|integer|min:5|max:120','note'=>'sometimes|nullable|string|max:500']);
        DB::transaction(function()use($u,$d,$id){
            $row=DB::table('confidential_requests')->where('id',$id)->lockForUpdate()->first(); abort_unless($row,404);
            abort_if($row->requester_id===$u->id,403,'Another approver must review your request.');
            abort_unless(in_array($row->status,['Pending','Approved','Denied','Revoked','Expired']),409,'This request cannot be reviewed.');
            abort_if($d['decision']==='Revoked'&&$row->status!=='Approved',422,'Only approved access can be revoked.');
            if($row->status!=='Pending')SystemAudit::record($u,'Confidential','Access decision changed',$row->case_id,[['field'=>'Decision','from'=>$row->status,'to'=>$d['decision']]]);
            \Illuminate\Support\Facades\Cache::forget('conf-unlock:'.$row->requester_id.':'.$row->case_id.':view');
            \Illuminate\Support\Facades\Cache::forget('conf-unlock:'.$row->requester_id.':'.$row->case_id.':print');
            DB::table('confidential_requests')->where('id',$id)->update(['status'=>$d['decision'],'scope'=>$d['scope']??$row->scope,'reviewer_id'=>$u->id,'decision_note'=>$d['note']??('Access '.strtolower($d['decision']).' by Head Admin.'),'expires_at'=>$d['decision']==='Approved'?now()->addMinutes($d['minutes']):null,'updated_at'=>now()]);
            if($d['decision']==='Approved')DB::table('confidential_requests')->where('case_id',$row->case_id)->where('requester_id',$row->requester_id)->where('id','!=',$id)->whereIn('status',['Pending','Approved'])->update(['status'=>'Revoked','decision_note'=>'Replaced by a newer Head Admin decision.','updated_at'=>now()]);
            SystemAudit::record($u,'Confidential','Confidential access '.strtolower($d['decision']),$row->case_id,[['field'=>'Requested by','from'=>'','to'=>DB::table('staff_users')->where('id',$row->requester_id)->value('full_name')],['field'=>'Access','from'=>'','to'=>$d['scope']??$row->scope],['field'=>'Approval duration','from'=>'','to'=>$d['decision']==='Approved'?$d['minutes'].' minutes':'Not applicable']]);
        });
        return response()->json(['saved'=>true]);
    }
    public function unlock(Request $r,string $id) {
        $u=$this->actor($r,true); $d=$r->validate(['password'=>'required|string','reason'=>'required|string|min:5|max:500','scope'=>'required|in:view,print']);
        abort_unless(Hash::check($d['password'],$u->password_hash),422,'Incorrect password.');
        $case=DB::table('confidential_cases')->where('id',$id)->first(); abort_unless($case,404);
        $grant=DB::table('confidential_requests')->where('case_id',$id)->where('requester_id',$u->id)->where('status','Approved')->where('expires_at','>',now());
        if ($d['scope']==='print') $grant->where('scope','print');
        $grant=$grant->orderByDesc('expires_at')->first();
        abort_unless($u->confidential_approver || ($d['scope']==='view' && $case->assigned_admin_id===$u->id) || $grant,403,'Request approval for this record first.');
        $expiry=now()->addMinutes(5); if ($grant && $grant->expires_at<$expiry->toDateTimeString()) $expiry=\Carbon\Carbon::parse($grant->expires_at);
        SystemAudit::record($u,'Confidential','Unlocked '.$d['scope'].' access: '.$d['reason'],$id);
        \Illuminate\Support\Facades\Cache::put('conf-unlock:'.$u->id.':'.$id.':'.$d['scope'],true,$expiry);
        if($d['scope']==='print')\Illuminate\Support\Facades\Cache::put('conf-unlock:'.$u->id.':'.$id.':view',true,$expiry);
        return response()->json(['expiresAt'=>$expiry->toIso8601String(),
            'assignedAdmin'=>DB::table('staff_users')->where('id',$case->assigned_admin_id)->value('full_name')]);
    }
}
