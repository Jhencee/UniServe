<?php
namespace App\Console\Commands;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\{DB,Crypt};
use Carbon\CarbonImmutable;
class MarkAppointmentNoShows extends Command {
 protected $signature='appointments:no-shows';
 protected $description='Mark missed open-calendar appointments without cancelling closed-day bookings';
 public function handle():int {
  $s=json_decode(DB::table('shared_system_settings')->where('id',1)->value('payload'),true);
  foreach(DB::table('shared_appointments')->where('status','Booked')->whereNotNull('date')->get() as $a){
   $at=CarbonImmutable::parse($a->date.' '.$a->time,'Asia/Manila');
   if($at->addMinutes($s['noShowThresholdMinutes']??60)->isFuture()||!\App\Support\OfficeCalendar::status($at)['open'])continue;
   DB::transaction(function()use($a,$s){$row=DB::table('shared_appointments')->where('id',$a->id)->lockForUpdate()->first();if(!$row||$row->status!=='Booked'||!$row->date||!$row->time)return;
    $scheduled=CarbonImmutable::parse($row->date.' '.$row->time,'Asia/Manila');$threshold=max(1,(int)($s['noShowThresholdMinutes']??60));
    if($scheduled->addMinutes($threshold)->isFuture()||!\App\Support\OfficeCalendar::status($scheduled)['open'])return;
    if($row->queue_id&&DB::table('queues')->where('id',$row->queue_id)->where('status','!=','Unfinished')->exists())return;
    $data=json_decode(Crypt::decryptString($row->payload),true);$data['noShowNotificationRevision']=$row->revision+1;$data['noShowHistory'][]=['markedAt'=>now()->toIso8601String(),'date'=>$row->date,'time'=>$row->time,'reason'=>'No check-in was recorded within '.$threshold.' minutes of the appointment.'];
    DB::table('shared_appointments')->where('id',$row->id)->update(['status'=>'No-show','payload'=>Crypt::encryptString(json_encode($data)),'revision'=>$row->revision+1,'updated_at'=>now()]);
    \App\Support\VisitProcess::notify(DB::table('shared_appointments')->where('id',$row->id)->first(),'no-show','No check-in was recorded for your appointment. If you still need the service, open Check My Visit and request a new schedule, or contact OSS. If you arrived and believe this is a mistake, contact OSS.');
    \App\Support\SystemAudit::record((object)['id'=>null,'full_name'=>'System scheduler'],'Appointments','Marked missed appointment as No-show',$row->visit_id,[['field'=>'Reason','from'=>'','to'=>'No check-in recorded within '.$threshold.' minutes']]);});
  }return self::SUCCESS;
 }
}
