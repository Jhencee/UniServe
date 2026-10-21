<?php
namespace App\Console\Commands;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Carbon\CarbonImmutable;
use App\Events\{WalkInIntakeChanged,PortalChanged};

class NotifyWalkInCutoff extends Command
{
 protected $signature='walk-ins:notify-cutoff';
 protected $description='Notify staff when today’s scheduled walk-in cutoff takes effect';
 public function handle():int {
  $now=CarbonImmutable::now('Asia/Manila');$day=$now->toDateString();
  $decision=Cache::get('walk-in-manual-cutoff:'.$day);
  if(!is_array($decision)||!($decision['scheduled']??false)||$now->lessThan(CarbonImmutable::parse($decision['effectiveAt'])))return self::SUCCESS;
  if(config('broadcasting.default')!=='reverb')return self::SUCCESS;
  $key='walk-in-notified:'.$day.':'.hash('sha256',$decision['effectiveAt']);
  if(!Cache::add($key,true,$now->endOfDay()))return self::SUCCESS;
  try{
   event(new WalkInIntakeChanged('closed',CarbonImmutable::parse($decision['effectiveAt'])->format('g:i A')));
   event(new PortalChanged('walk-in-capacity',['private-office','public-queue']));
  }catch(\Throwable $e){Cache::forget($key);report($e);return self::FAILURE;}
  return self::SUCCESS;
 }
}
