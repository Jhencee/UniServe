<?php
namespace App\Support;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\{DB,Cache,Schema};
class WalkInCapacity {
 public static function status():array {
  QueueDayClosure::run();
  $now=CarbonImmutable::now('Asia/Manila');$day=$now->toDateString();$calendar=OfficeCalendar::get();$ranges=OfficeCalendar::intervals($day,$calendar);$office=OfficeCalendar::status($now,$calendar);
  $settings=Schema::hasTable('shared_system_settings')?json_decode(DB::table('shared_system_settings')->where('id',1)->value('payload'),true):[];
  $lead=(int)($settings['walkInCutoffMinutes']??30);$buffer=(int)($settings['walkInBufferMinutes']??15);$staff=max(1,(int)Cache::get('walk-in-counters:'.$day,$settings['walkInCounters']??1));
  $decision=Cache::get('walk-in-manual-cutoff:'.$day);
  $effectiveAt=is_array($decision)?CarbonImmutable::parse($decision['effectiveAt']):null;
  $manualClosed=(bool)$decision&&(!$effectiveAt||$now->greaterThanOrEqualTo($effectiveAt));
  $manual=['manualCutoff'=>$manualClosed,'scheduledCutoff'=>is_array($decision)&&($decision['scheduled']??false),'counters'=>$staff,'cutoffTime'=>$effectiveAt?->format('H:i'),'manualCutoffTime'=>$effectiveAt?->format('g:i A'),'closedAt'=>$manualClosed?$effectiveAt?->toIso8601String():null,'closedTime'=>$manualClosed?$effectiveAt?->format('g:i A'):null,'timezone'=>'Asia/Manila'];
  $override=(bool)Cache::get('walk-in-override:'.$day,false);
  $cutoff=$ranges?CarbonImmutable::parse($day.' '.end($ranges)[1],'Asia/Manila')->subMinutes($lead):null;
  $manual+=['override'=>$override,'officeOpen'=>$office['open'],'cutoff'=>$cutoff?->format('g:i A'),'officeMessage'=>$office['reason']];
  if(!$ranges||!$office['open']||($settings['maintenanceMode']??false))return $manual+['accepting'=>false,'message'=>($settings['maintenanceMode']??false)?'New visits are unavailable during maintenance.':$office['reason']];
  $closing=CarbonImmutable::parse($day.' '.end($ranges)[1],'Asia/Manila');$cutoff=$closing->subMinutes($lead);
  $samples=[];$active=[];
  foreach(DB::table('queues')->whereIn('status',['Waiting','Called','Serving','Completed'])->get() as $row){$q=QueueData::read($row->portal_payload);$q['id']=$q['id']??$row->id;$q['status']=$row->status;$q['createdAt']=$q['createdAt']??$row->created_at??$now->toIso8601String();if($row->status==='Completed'&&!empty($q['servingAt'])&&!empty($q['completedAt'])){$seconds=strtotime($q['completedAt'])-strtotime($q['servingAt']);if($seconds>0&&strtotime($q['completedAt'])>=$now->timestamp-30*86400)$samples[]=min(120,$seconds/60);}elseif($row->status!=='Completed')$active[]=$q;}
  $average=count($samples)>=5?max(1,array_sum($samples)/count($samples)):10;$work=0;$inProgress=0;
  foreach($active as $q){$duration=$average;if(($q['status']??'')==='Serving'&&!empty($q['servingAt']))$duration=max(1,$average-max(0,($now->timestamp-strtotime($q['servingAt']))/60));$work+=$duration;if(in_array($q['status']??'',['Called','Serving']))$inProgress+=$duration;}
  $waiting=array_values(array_filter($active,fn($q)=>($q['status']??'')==='Waiting'&&(($q['source']??'')!=='Appointment'||empty($q['scheduledAt'])||CarbonImmutable::parse($q['scheduledAt'])->lessThanOrEqualTo($now))));
  usort($waiting,function($a,$b){$key=fn($q)=>[empty($q['isSenior'])&&empty($q['isPWD'])?1:0,($q['source']??'')==='Appointment'?0:1,$q['queueEnteredAt']??$q['scheduledAt']??$q['createdAt']];return $key($a)<=>$key($b);});
  $positions=[];$estimates=[];foreach($waiting as $position=>$q){$positions[$q['id']]=$position;$estimates[$q['id']]=(int)ceil(($inProgress+$position*$average)/$staff);}
  $available=0;foreach($ranges as [$start,$end]){$from=max($now->timestamp,CarbonImmutable::parse($day.' '.$start,'Asia/Manila')->timestamp);$to=CarbonImmutable::parse($day.' '.$end,'Asia/Manila')->timestamp;$available+=max(0,($to-$from)/60);}
  $latched='walk-in-cutoff:'.$day;if(($work+$average)/$staff+$buffer>$available)Cache::put($latched,true,$closing->addMinute());
  $override=Cache::get('walk-in-override:'.$day,false);$accepting=!$manualClosed&&($override||($now->lessThan($cutoff)&&!Cache::get($latched,false)));
  return $manual+['accepting'=>$accepting,'message'=>$accepting?'Walk-ins are available.':'Walk-in intake is closed for today. Book an appointment or return on the next opening day.','cutoff'=>$cutoff->format('g:i A'),'estimatedMinutes'=>(int)ceil($work/$staff),'peopleAhead'=>$positions,'sampleCount'=>count($samples),'estimateBasis'=>count($samples)>=5?'Recent service durations':'Initial 10-minute service estimate','waitEstimates'=>$estimates,'override'=>(bool)$override];
 }
}
