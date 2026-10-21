<?php
namespace App\Support;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\{DB,Schema};

class QueueDayClosure
{
 public static function run():int {
  if(!Schema::hasTable('queues'))return 0;
  $now=CarbonImmutable::now('Asia/Manila');$today=$now->toDateString();$count=0;
  foreach(DB::table('queues')->whereIn('status',['Waiting','Called','Serving','Skipped'])->get() as $candidate){
   $count+=DB::transaction(function()use($candidate,$today,$now){
    $row=DB::table('queues')->where('id',$candidate->id)->lockForUpdate()->first();
    if(!$row||!in_array($row->status,['Waiting','Called','Serving','Skipped']))return 0;
    $q=QueueData::read($row->portal_payload);$started=$q['checkedInAt']??$q['createdAt']??$row->created_at??null;
    if(!$started||CarbonImmutable::parse($started,'Asia/Manila')->setTimezone('Asia/Manila')->toDateString()>=$today)return 0;
    VisitFlow::archiveStep($q,(object)['full_name'=>'System'],'Unfinished');VisitFlow::closeLog($q,'Unfinished');
    $q['previousStatus']=$row->status;$q['status']='Unfinished';$q['unfinishedAt']=$now->toIso8601String();
    DB::table('queues')->where('id',$row->id)->update(['status'=>'Unfinished','portal_payload'=>QueueData::write($q)]);
    if(!empty($q['appointmentId'])&&Schema::hasTable('shared_appointments'))DB::table('shared_appointments')->where('id',$q['appointmentId'])->where('status','Checked-in')->update(['status'=>'Unfinished','updated_at'=>now()]);
    if(Schema::hasTable('system_audit'))SystemAudit::record(null,'Queue','Previous-day visit marked Unfinished',$q['visitId']??$q['id'],[['field'=>'Queue status','from'=>$row->status,'to'=>'Unfinished']]);
    return 1;
   });
  }
  if($count&&config('broadcasting.default')==='reverb')try{event(new \App\Events\PortalChanged('queue',['private-office','public-queue']));}catch(\Throwable $e){report($e);}
  return $count;
 }
}
