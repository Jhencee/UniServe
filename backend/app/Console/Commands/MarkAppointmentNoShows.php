<?php
namespace App\Console\Commands;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Carbon\CarbonImmutable;
class MarkAppointmentNoShows extends Command {
 protected $signature='appointments:no-shows';
 protected $description='Mark missed open-calendar appointments without cancelling closed-day bookings';
 public function handle():int {
  $s=json_decode(DB::table('shared_system_settings')->where('id',1)->value('payload'),true);
  foreach(DB::table('shared_appointments')->where('status','Booked')->whereNotNull('date')->get() as $a){
   $at=CarbonImmutable::parse($a->date.' '.$a->time,'Asia/Manila');
   if($at->addMinutes($s['noShowThresholdMinutes']??60)->isFuture()||!\App\Support\OfficeCalendar::status($at)['open'])continue;
   DB::transaction(function()use($a){$row=DB::table('shared_appointments')->where('id',$a->id)->lockForUpdate()->first();if($row->status!=='Booked')return;
    if($row->queue_id&&DB::table('queues')->where('id',$row->queue_id)->where('status','!=','Unfinished')->exists())return;
    DB::table('shared_appointments')->where('id',$row->id)->update(['status'=>'No-show','revision'=>$row->revision+1,'updated_at'=>now()]);\App\Support\SystemAudit::record((object)['id'=>null,'full_name'=>'System scheduler'],'Appointments','Marked missed appointment as No-show',$row->visit_id);});
  }return self::SUCCESS;
 }
}
