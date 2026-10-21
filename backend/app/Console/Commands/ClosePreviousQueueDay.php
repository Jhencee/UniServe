<?php
namespace App\Console\Commands;
use Illuminate\Console\Command;
class ClosePreviousQueueDay extends Command
{
 protected $signature='queue:close-previous-day';
 protected $description='Retain prior-day active visits as Unfinished without carrying them into today';
 public function handle():int{\App\Support\QueueDayClosure::run();return self::SUCCESS;}
}
