<?php
namespace App\Http\Middleware;
use App\Events\PortalChanged;
use Closure;
use Illuminate\Http\Request;
class BroadcastPortalChanges
{
 public function handle(Request $request,Closure $next){
  $response=$next($request);
  if(config('broadcasting.default')!=='reverb'||in_array($request->method(),['GET','HEAD','OPTIONS'])||$response->getStatusCode()>=400||!$request->is('api/*'))return $response;
  $resource=explode('/',$request->path())[1]??'';
  if($resource==='confidential'&&($request->is('api/confidential/requests')||$request->is('api/confidential/requests/*'))){
   $channels=['private-head-admin'];
   if($request->isMethod('patch')){
    $id=$request->route('id');$owner=\Illuminate\Support\Facades\DB::table('confidential_requests')->where('id',$id)->value('requester_id');
    if($owner)$channels[]='private-admin-'.$owner;
   }
   try{event(new PortalChanged('confidential-requests',$channels));}catch(\Throwable $e){report($e);}
   return $response;
  }
  if($request->is('api/chats/*/read'))return $response;
  if(in_array($resource,['realtime','history','login','logout','audit','notifications','confidential','report-data']))return $response;
  $channels=['private-office'];$body=json_decode($response->getContent(),true)??[];
  if(in_array($resource,['queue','visits','calendar','settings','walk-in-capacity'])||!empty($body['queue']))$channels[]='public-queue';
  if(!empty($body['chat']['id']))$channels[]='private-chat-'.$body['chat']['id'];
  if(!empty($body['queue']['visitId']))$channels[]='private-visit-'.$body['queue']['visitId'];
  if(!empty($body['visitId'])&&$resource==='service-records')$channels[]='private-visit-'.$body['visitId'];
  if(!empty($body['appointment']['visitId']))$channels[]='private-visit-'.$body['appointment']['visitId'];
  if(!empty($body['appointment']['requestReference']))$channels[]='private-visit-'.$body['appointment']['requestReference'];
  // Only invalidation hints cross the socket; private records are fetched through authorized APIs.
  try{event(new PortalChanged($resource,array_unique($channels)));}catch(\Throwable $e){report($e);}
  return $response;
 }
}
