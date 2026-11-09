<?php
namespace App\Support;
use Illuminate\Support\Facades\DB;
use Carbon\CarbonImmutable;
class AppointmentNotifications
{
 public static function calendarChange(object $row):void{
  $a=\App\Http\Controllers\AppointmentController::present($row);
  $body='Hi '.$a['name'].",\n\nOffice hours changed and your appointment time is no longer available. Your request has not been cancelled. OSS will review your booking; please check My Visit or request a new schedule before travelling.\n\nVisit ID: ".$row->visit_id."\n\nOffice of Student Services";
  DB::table('notification_outbox')->insertOrIgnore(PrivateNotification::fields($a['email'],'Appointment needs rescheduling',$body)+['visit_id'=>$row->visit_id,'scheduled_at'=>now(),'send_at'=>now(),'kind'=>'calendar-change','dedup_key'=>hash('sha256','calendar-change|'.$row->id.'|'.$row->revision),'actor_id'=>'system','created_at'=>now(),'updated_at'=>now()]);
 }
 public static function cancellation(object $row,?object $actor=null):void{
  $a=\App\Http\Controllers\AppointmentController::present($row);
  DB::table('notification_outbox')->where('visit_id',$row->visit_id)->where('kind','!=','cancelled')->whereIn('status',['pending','paused','failed'])->update(['status'=>'cancelled','updated_at'=>now()]);
  $body='Hi '.$a['name'].",\n\nYour appointment ".($row->date?'':'request ')."has been cancelled.\n\nService: ".$a['service'];
  if($row->date&&$row->time){$at=CarbonImmutable::parse($row->date.' '.$row->time,'Asia/Manila');$body.="\nDate: ".$at->format('l, F j, Y')."\nTime: ".$at->format('g:i A');}
  $body.="\nVisit ID: ".$row->visit_id."\n\nYou do not need to come for this appointment. If you still need the service, start a new visit or contact OSS.\n\nOffice of Student Services";
  $added=DB::table('notification_outbox')->insertOrIgnore(PrivateNotification::fields($a['email'],'Appointment cancelled',$body)+['visit_id'=>$row->visit_id,'scheduled_at'=>now(),'send_at'=>now(),'kind'=>'cancelled','dedup_key'=>hash('sha256','cancelled|'.$row->visit_id),'actor_id'=>$actor?->id??'visitor','created_at'=>now(),'updated_at'=>now()]);
  if($added){SystemAudit::record($actor,'Appointments','Cancellation email queued',$row->visit_id);if(config('mail.default')==='smtp'&&config('mail.mailers.smtp.username')&&config('mail.mailers.smtp.password'))\App\Jobs\DeliverAppointmentNotifications::dispatch();}
 }
}
