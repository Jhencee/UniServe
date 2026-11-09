<?php
namespace App\Http\Controllers;

use App\Support\{StaffAuth,CaseAccess};
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{DB,Crypt};

class AttentionController extends Controller
{
    public function index(Request $request)
    {
        $items=[];
        $add=function($id,$title,$detail,$kind,$target)use(&$items){$items[] = compact('id','title','detail','kind','target');};
        $staff=StaffAuth::user($request);
        $failed=fn()=>DB::table('notification_outbox')->where(fn($q)=>$q->where('status','failed')->orWhere(fn($q)=>$q->where('status','pending')->where('attempts','>=',5)));
        if($staff && $staff->role==='SUPER_ADMIN'){
            $count=$failed()->count();
            if($count)$add('delivery-failures:'.$count,'Email delivery needs attention',$count.' appointment emails failed delivery.','system','');
            return response()->json(['notifications'=>$items]);
        }
        if($staff){
            abort_unless($staff->role==='ADMIN',403);
            foreach(DB::table('confidential_requests as r')->join('confidential_cases as c','c.id','=','r.case_id')->where('r.requester_id',$staff->id)->whereIn('r.status',['Approved','Denied','Revoked','Expired'])->get(['r.*','c.code']) as $r){
                $status=$r->status==='Approved'&&$r->expires_at&&strtotime($r->expires_at)<=time()?'Expired':$r->status;
                if($status!=='Approved')$add('access:'.$r->id.':'.$status,'Access request '.strtolower($status),$r->code,'access',$r->id);
            }
            foreach(DB::table('confidential_cases')->where('assigned_admin_id',$staff->id)->get(['id','code','updated_at']) as $case)
                $add('assignment:'.$case->id.':'.$case->updated_at,'Confidential case assigned to you',$case->code,'case',$case->id);
            foreach($failed()->get(['id','visit_id']) as $mail){
                $a=DB::table('shared_appointments')->where('visit_id',$mail->visit_id)->first();
                if($a&&CaseAccess::canViewAppointment($staff,$a))$add('delivery:'.$mail->id,'Appointment email failed',$a->visit_id.' — Review delivery and resend.','appointment',$a->id);
            }
        }
        foreach(DB::table('shared_appointments')->get() as $row){
            if(!CaseAccess::canViewAppointment($staff,$row))continue;
            $a=json_decode(Crypt::decryptString($row->payload),true);
            if($row->status==='Requested'&&\App\Support\VisitProcess::reviewDeadline($row)->isPast())
                $add('review-due:'.$row->id,'Appointment review overdue',$row->visit_id.' — Confirm a schedule or contact the visitor.','appointment',$row->id);
            foreach($a['attachments']??[] as $i=>$file)if(!empty($file['uploadedAt'])&&($file['review']['status']??'')==='Pending review'&&in_array($row->status,['Requested','Booked']))
                $add('corrected:'.$row->id.':'.$i.':'.$row->revision,'Corrected document ready for review',$row->visit_id,'appointment',$row->id);
            $tasks=$a['followUpTasks']??(empty($a['followUpTask'])?[]:[$a['followUpTask']]);
            foreach($tasks as $i=>$task){
                if($row->status==='Cancelled'||!empty($task['completed'])||($task['dueDate']??'9999')>=now('Asia/Manila')->toDateString())continue;
                $head=($staff->confidential_approver??false)&&($task['dueDate']??'9999')<now('Asia/Manila')->subDays(2)->toDateString();
                if(($task['ownerId']??$staff->id)===$staff->id||$head)$add('task-due:'.$row->id.':'.$i,$head?'Overdue follow-up escalated':'Your follow-up is overdue',$row->visit_id.' — '.$task['dueDate'],'appointment',$row->id);
            }
        }
        foreach(DB::table('shared_transactions')->get() as $row){
            $t=json_decode(Crypt::decryptString($row->payload),true);
            if(\App\Support\ServicePrivacy::confidential($t['service'])&&!CaseAccess::canView($staff,$row->id))continue;
            if(($t['caseStatus']??'')==='Resolved')continue;
            if(($t['caseOwnerId']??'')===$staff->id&& !empty($t['caseDueDate'])&&$t['caseDueDate']<now('Asia/Manila')->toDateString())
                $add('case-due:'.$row->id,'Your case action is overdue',$t['code']??$row->id,'case',$row->id);
        }
        $chats=DB::table('shared_chats');
        foreach($chats->orderByDesc('updated_at')->limit(100)->get() as $row){
            $chat=json_decode(Crypt::decryptString($row->payload),true);$count=$chat['staffUnread']??0;
            if($count)$add('chat:'.$row->id.':'.$row->updated_at,'Unread conversation messages',$count.' unread '.($count===1?'message':'messages').'.','chat',$row->id);
        }
        return response()->json(['notifications'=>array_values(collect($items)->unique('id')->all())]);
    }
}
