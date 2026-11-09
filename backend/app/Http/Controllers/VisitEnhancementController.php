<?php
namespace App\Http\Controllers;
use App\Support\{StaffAuth,VisitorAccess,SystemAudit,ServicePrivacy};
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{DB,Crypt};
class VisitEnhancementController extends Controller {
 public function preferences(Request $r,string $id){
  $d=$r->validate(['enabled'=>'required|boolean','revision'=>'required|integer|min:0']);
  $a=DB::transaction(function()use($r,$id,$d){
   $row=DB::table('shared_appointments')->where('id',$id)->lockForUpdate()->first();abort_unless($row,404);
   abort_unless(\App\Support\EmailIndex::key(VisitorAccess::email($r))===$row->email,403);
   abort_unless(in_array($row->status,['Requested','Booked']),409,'This visit is no longer eligible for the waitlist.');
   abort_unless($row->revision===$d['revision'],409,'This visit changed. Refresh its status.');
   $a=json_decode(Crypt::decryptString($row->payload),true);$a['earlierSlotOptIn']=$d['enabled'];$a['waitlistJoinedAt']=$d['enabled']?now()->toIso8601String():null;
   DB::table('shared_appointments')->where('id',$id)->update(['payload'=>Crypt::encryptString(json_encode($a)),'revision'=>$row->revision+1,'updated_at'=>now()]);
   SystemAudit::record(null,'Appointments',$d['enabled']?'Joined earlier-slot waitlist':'Left earlier-slot waitlist',$row->visit_id);
   return AppointmentController::present(DB::table('shared_appointments')->where('id',$id)->first());
  });return response()->json(['appointment'=>$a]);
 }
 public function task(Request $r,string $id){
  $u=StaffAuth::user($r,'ADMIN');$d=$r->validate(['text'=>'required|string|max:500','dueDate'=>'required|date_format:Y-m-d','completed'=>'required|boolean','revision'=>'required|integer|min:0','taskId'=>'nullable|string|max:80','ownerId'=>'nullable|string|max:80','completionNotes'=>'nullable|string|max:1000']);
  $a=DB::transaction(function()use($r,$id,$d,$u){
   $row=DB::table('shared_appointments')->where('id',$id)->lockForUpdate()->first();abort_unless($row,404);(new AppointmentController)->access($r,$row);
   abort_unless(\App\Support\CaseAccess::canEditAppointment($u,$row),403,'Assigned Admin or Head Admin edit access and an active unlock are required.');
   abort_unless($row->revision===$d['revision'],409,'Another Admin changed this visit. Refresh it.');
   abort_if($row->status==='Cancelled',409,'This visit is cancelled.');
   $a=AppointmentController::present($row);$text=trim($d['text']);abort_if($text==='',422,'Enter a follow-up action.');
   $owner=DB::table('staff_users')->where('id',$d['ownerId']??$u->id)->where('role','ADMIN')->where('is_active',true)->first();
   abort_unless($owner,422,'Choose an active Admin as task owner.');
   if(ServicePrivacy::confidential($row->service_key))abort_unless(\App\Support\CaseAccess::canEditAppointment($owner,$row),422,'The task owner needs edit access to this confidential visit.');
   $tasks=$a['followUpTasks']??(empty($a['followUpTask'])?[]:[$a['followUpTask']+['id'=>'legacy']]);
   $taskId=$d['taskId']??('TASK-'.bin2hex(random_bytes(8)));$position=null;
   foreach($tasks as $i=>$task)if(($task['id']??'legacy')===$taskId)$position=$i;
   abort_if(isset($d['taskId'])&&$position===null,404,'Task not found.');
   $notes=trim($d['completionNotes']??'');abort_if($d['completed']&&$notes==='',422,'Add completion notes.');
   $before=$position===null?null:$tasks[$position];
   $task=['id'=>$taskId,'text'=>$text,'dueDate'=>$d['dueDate'],'completed'=>$d['completed'],'ownerId'=>$owner->id,'ownerName'=>$owner->full_name,'completionNotes'=>$notes,'updatedAt'=>now()->toIso8601String()];
   $task['history']=$before['history']??[];
   $task['history'][]=['at'=>now()->toIso8601String(),'by'=>$u->full_name,'text'=>$text,'ownerName'=>$owner->full_name,'dueDate'=>$d['dueDate'],'completed'=>$d['completed'],'notes'=>$notes];
   if($position===null)$tasks[]=$task;else $tasks[$position]=$task;
   $a['followUpTasks']=$tasks;$a['followUpTask']=$task;
   DB::table('shared_appointments')->where('id',$id)->update(['payload'=>Crypt::encryptString(json_encode($a)),'revision'=>$row->revision+1,'updated_at'=>now()]);
   \App\Support\VisitProcess::notify(DB::table('shared_appointments')->where('id',$id)->first(),'follow-up-task','Your follow-up actions have been updated.');
   SystemAudit::record($u,'Appointments',$d['completed']?'Follow-up task completed':'Follow-up task updated',$row->visit_id);
   return AppointmentController::present(DB::table('shared_appointments')->where('id',$id)->first());
  });return response()->json(['appointment'=>$a]);
 }
}
