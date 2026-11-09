<?php
namespace App\Http\Controllers;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use App\Support\{WalkInCapacity,StaffAuth,SystemAudit,OfficeCalendar};
class WalkInCapacityController extends Controller {
 public function show(){return response()->json(WalkInCapacity::status());}
 public function override(Request $r){
  $u=StaffAuth::user($r,'ADMIN');abort_unless($u->confidential_approver??false,403,'Head Admin permission required.');
  $d=$r->validate(['counters'=>'required|integer|min:1|max:20','mode'=>'sometimes|required|in:automatic,closed,scheduled,extra','cutoffTime'=>'required_if:mode,scheduled|nullable|date_format:H:i','enabled'=>'required_without:mode|boolean']);
  $mode=$d['mode']??($d['enabled']?'extra':'automatic');$day=now('Asia/Manila')->toDateString();$expires=now('Asia/Manila')->endOfDay();
  $effectiveAt=\Carbon\CarbonImmutable::now('Asia/Manila');
  if($mode==='scheduled'){
   $effectiveAt=\Carbon\CarbonImmutable::parse($day.' '.$d['cutoffTime'],'Asia/Manila');
   $ranges=OfficeCalendar::intervals($day,OfficeCalendar::get());
   abort_unless($ranges,422,'The office is closed today. Update Office Availability before scheduling an intake cutoff.');
   $closing=\Carbon\CarbonImmutable::parse($day.' '.end($ranges)[1],'Asia/Manila');
   abort_unless($effectiveAt->isFuture()&&$effectiveAt->lessThan($closing),422,'Choose a future cutoff time before office closing today.');
  }
  Cache::put('walk-in-counters:'.$day,$d['counters'],$expires);
  Cache::put('walk-in-override:'.$day,$mode==='extra',$expires);
  if(in_array($mode,['closed','scheduled']))Cache::put('walk-in-manual-cutoff:'.$day,['effectiveAt'=>$effectiveAt->toIso8601String(),'scheduled'=>$mode==='scheduled'],$expires);
  else Cache::forget('walk-in-manual-cutoff:'.$day);
  SystemAudit::record($u,'Queue',match($mode){'closed'=>'Walk-in intake closed by Head Admin','scheduled'=>'Walk-in cutoff scheduled by Head Admin','extra'=>'Walk-in cutoff overridden',default=>'Automatic walk-in cutoff restored'},$day,[['field'=>'Cutoff time','from'=>'','to'=>in_array($mode,['closed','scheduled'])?$effectiveAt->format('g:i A'):'Automatic']]);
  if(config('broadcasting.default')==='reverb'){
   try{event(new \App\Events\WalkInIntakeChanged($mode,in_array($mode,['closed','scheduled'])?$effectiveAt->format('g:i A'):null));}catch(\Throwable $e){report($e);}
  }
  return $this->show();
 }
}
