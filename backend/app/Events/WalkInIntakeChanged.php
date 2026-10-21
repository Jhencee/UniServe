<?php
namespace App\Events;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;
use Illuminate\Support\Str;

class WalkInIntakeChanged implements ShouldBroadcast, ShouldDispatchAfterCommit
{
 public string $id;
 public function __construct(public string $mode, public ?string $time){$this->id=(string)Str::uuid();}
 public function broadcastOn():array{return [new PrivateChannel('office')];}
 public function broadcastAs():string{return 'walk-in.intake.changed';}
 public function broadcastWith():array{return ['id'=>$this->id,'mode'=>$this->mode,'time'=>$this->time];}
 public function broadcastQueue():string{return 'realtime';}
}
