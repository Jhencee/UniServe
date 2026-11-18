<?php
namespace App\Jobs;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Artisan;
class DeliverAppointmentNotifications implements ShouldQueue
{
 use Queueable;
 public int $tries=1;
 public int $timeout=60;
 public function __construct(public int $limit=50){$this->onQueue('mail-verification');$this->afterCommit();}
 public function handle():void{Artisan::call('notifications:send',['--limit'=>$this->limit]);}
}
