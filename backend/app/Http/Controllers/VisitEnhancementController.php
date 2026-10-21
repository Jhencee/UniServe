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
   $a=AppointmentController::present($row);$a['earlierSlotOptIn']=$d['enabled'];$a['waitlistJoinedAt']=$d['enabled']?now()->toIso8601String():null;
   DB::table('shared_appointments')->where('id',$id)->update(['payload'=>Crypt::encryptString(json_encode($a)),'revision'=>$row->revision+1,'updated_at'=>now()]);
   SystemAudit::record(null,'Appointments',$d['enabled']?'Joined earlier-slot waitlist':'Left earlier-slot waitlist',$row->visit_id);
   return AppointmentController::present(DB::table('shared_appointments')->where('id',$id)->first());
  });return response()->json(['appointment'=>$a]);
 }
 public function task(Request $r,string $id){
  $u=StaffAuth::user($r,'ADMIN');$d=$r->validate(['text'=>'required|string|max:500','dueDate'=>'required|date_format:Y-m-d','completed'=>'required|boolean','revision'=>'required|integer|min:0']);
  $a=DB::transaction(function()use($r,$id,$d,$u){
   $row=DB::table('shared_appointments')->where('id',$id)->lockForUpdate()->first();abort_unless($row,404);(new AppointmentController)->access($r,$row);
   abort_unless($row->revision===$d['revision'],409,'Another Admin changed this visit. Refresh it.');
   abort_if($row->status==='Cancelled',409,'This visit is cancelled.');
   $a=AppointmentController::present($row);$text=trim($d['text']);abort_if($text==='',422,'Enter a follow-up action.');
   $a['followUpTask']=['text'=>$text,'dueDate'=>$d['dueDate'],'completed'=>$d['completed'],'updatedAt'=>now()->toIso8601String()];
   DB::table('shared_appointments')->where('id',$id)->update(['payload'=>Crypt::encryptString(json_encode($a)),'revision'=>$row->revision+1,'updated_at'=>now()]);
   SystemAudit::record($u,'Appointments',$d['completed']?'Follow-up task completed':'Follow-up task updated',$row->visit_id);
   return AppointmentController::present(DB::table('shared_appointments')->where('id',$id)->first());
  });return response()->json(['appointment'=>$a]);
 }
}
