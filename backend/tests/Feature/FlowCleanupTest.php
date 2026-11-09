<?php
use App\Events\PortalChanged;
use App\Http\Middleware\BroadcastPortalChanges;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Event;

it('does not announce read-only report snapshots as business data changes',function(){
 config(['broadcasting.default'=>'reverb']);Event::fake([PortalChanged::class]);
 $request=Request::create('/api/report-data','POST');
 (new BroadcastPortalChanges)->handle($request,fn()=>response()->json(['transactions'=>[]]));
 Event::assertNotDispatched(PortalChanged::class);
});
it('still broadcasts successful queue changes to refresh clients',function(){
 config(['broadcasting.default'=>'reverb']);Event::fake([PortalChanged::class]);
 $request=Request::create('/api/queue/test','PATCH');
 (new BroadcastPortalChanges)->handle($request,fn()=>response()->json(['queue'=>['visitId'=>'VIS-TEST']]));
 Event::assertDispatched(PortalChanged::class,fn($event)=>$event->resource==='queue');
});
