<?php
namespace App\Events;
use Illuminate\Broadcasting\{Channel,PrivateChannel};
use Illuminate\Contracts\Broadcasting\ShouldBroadcast;
use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;

class PortalChanged implements ShouldBroadcast,ShouldDispatchAfterCommit
{
 public function __construct(public string $resource,private array $channels){}
 public function broadcastOn():array{return array_map(fn($name)=>str_starts_with($name,'private-')?new PrivateChannel(substr($name,8)):new Channel($name),$this->channels);}
 public function broadcastAs():string{return 'portal.changed';}
 public function broadcastWith():array{return ['resource'=>$this->resource];}
 public function broadcastQueue():string{return 'realtime';}
}
