<?php

namespace App\Http\Middleware;

use App\Support\StaffAuth;
use App\Support\SystemAudit;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;

class RecordSystemAudit
{
    public function handle(Request $request, Closure $next)
    {
        $actor = null;
        if ($request->bearerToken()) {
            try { $actor = StaffAuth::user($request); } catch (\Throwable $e) { /* Endpoint owns authentication errors. */ }
        }
        $beforeCalendar = $request->is('api/calendar') && $request->isMethod('put') ? \App\Support\OfficeCalendar::get() : null;
        $beforeAccount=$request->is('api/admins/*')?\Illuminate\Support\Facades\DB::table('staff_users')->where('id',$request->route('id'))->first():null;
        try {$response = $next($request);}catch(\Symfony\Component\HttpKernel\Exception\HttpExceptionInterface $e){
            if(in_array($e->getStatusCode(),[401,403])&&Schema::hasTable('system_audit'))SystemAudit::record($actor,'System','Access denied',null,[['field'=>'Area','from'=>'','to'=>$this->area($request)]]);
            throw $e;
        }
        if (!$request->is('api/*') || !Schema::hasTable('system_audit')) return $response;
        if($response->getStatusCode()>=400){
            $status=$response->getStatusCode();
            if(in_array($status,[401,403])||!in_array($request->method(),['GET','HEAD','OPTIONS'])){
                $action=$request->is('api/login')?'Sign-in failed':($request->is('api/history/verify')?'Visitor verification failed':($request->is('api/confidential/cases/*/unlock')?'Confidential unlock failed':(in_array($status,[401,403])?'Access denied':$this->area($request).' action rejected')));
                $category=match(true){$request->is('api/confidential*')=>'Confidential',$request->is('api/login','api/history/*','api/password','api/profile')=>'Authentication',$request->is('api/appointments*')=>'Appointments',$request->is('api/queue*','api/visits*')=>'Queue',$request->is('api/admins*')=>'Accounts',default=>'System'};
                $failedActor=$actor??($request->is('api/login')?(object)['id'=>null,'full_name'=>'Unknown staff']:null);
                SystemAudit::record($failedActor,$category,$action,$request->is('api/confidential/cases/*')?$request->route('id'):null,[['field'=>'Area','from'=>'','to'=>$this->area($request)],['field'=>'Result','from'=>'','to'=>match($status){401=>'Sign-in or verification required',403=>'Permission denied',409=>'Record changed or action not available',422=>'Invalid or expired information',429=>'Too many attempts',default=>'Action unsuccessful'}]]);
            }return $response;
        }
        if(in_array($request->method(), ['GET','HEAD','OPTIONS']) || $request->is('api/audit*','api/realtime/*','api/chats/*/read') || $request->attributes->get('system_audit_recorded'))return $response;
        $body = json_decode($response->getContent(), true) ?? [];
        if ($request->is('api/login') && isset($body['user'])) $actor = (object) ['id'=>$body['user']['id'], 'full_name'=>$body['user']['fullName']];
        if ($request->is('api/password') && !$actor) {
            $identifier = trim((string) $request->input('username'));
            $actor = \Illuminate\Support\Facades\DB::table('staff_users')->where(fn($q)=>$q->where('username',$identifier)->orWhere('email',$identifier))->first();
        }
        $category = match (true) {
            $request->is('api/calendar*') => 'Settings', $request->is('api/admins*') => 'Accounts',
            $request->is('api/visits*','api/queue*') => $request->is('api/queue/*/feedback')?'Feedback':'Queue',
            $request->is('api/notifications*','api/appointments*') => 'Appointments',
            $request->is('api/confidential*')=>'Confidential',$request->is('api/chats*')=>'Messages',
            $request->is('api/services*','api/settings*')=>'Settings',$request->is('api/service-records*')=>'Transactions',
            $request->is('api/import-browser')=>'Data',default => 'Authentication',
        };
        $target = $body['queue']['visitId'] ?? $body['appointment']['visitId'] ?? $body['user']['fullName'] ?? $beforeAccount?->full_name ?? $request->input('visitId');
        $action = $this->action($request,$body);
        // Never copy request bodies: credentials, contact information and attachments are excluded.
        $changes = [];
        if($beforeAccount&&isset($body['user'])){
            foreach(['fullName'=>'full_name','username'=>'username','active'=>'is_active','confidentialAccess'=>'confidential_access','confidentialApprover'=>'confidential_approver'] as $field=>$column){if(array_key_exists($field,$body['user'])&&($beforeAccount->$column??null)!=$body['user'][$field])$changes[]=['field'=>ucwords(preg_replace('/([A-Z])/',' $1',$field)),'from'=>is_bool($body['user'][$field])?($beforeAccount->$column?'Yes':'No'):(string)($beforeAccount->$column??''),'to'=>is_bool($body['user'][$field])?($body['user'][$field]?'Yes':'No'):(string)$body['user'][$field]];}
        }
        if(!$beforeCalendar){
            $changes[]=['field'=>'Area','from'=>'','to'=>$this->area($request)];
            if(isset($body['queue']['status']))$changes[]=['field'=>'Queue status','from'=>'','to'=>$body['queue']['status']];
            if(isset($body['appointment']['date'],$body['appointment']['time']))$changes[]=['field'=>'Appointment schedule','from'=>'','to'=>\Carbon\CarbonImmutable::parse($body['appointment']['date'].' '.$body['appointment']['time'],'Asia/Manila')->format('M j, Y, g:i A')];
        }
        if ($beforeCalendar && isset($body['calendar'])) {
            $after = $body['calendar'];
            foreach (['weekly'=>'Weekly hours','lunch'=>'Lunch break'] as $key=>$label) {
                if ($beforeCalendar[$key] !== $after[$key]) $changes[] = ['field'=>$label,'from'=>json_encode($beforeCalendar[$key]),'to'=>json_encode($after[$key])];
            }
            foreach (array_unique(array_merge(array_keys($beforeCalendar['days']),array_keys($after['days']))) as $date) {
                if (($beforeCalendar['days'][$date] ?? null) !== ($after['days'][$date] ?? null)) $changes[] = ['field'=>$date,'from'=>json_encode($beforeCalendar['days'][$date] ?? null),'to'=>json_encode($after['days'][$date] ?? null)];
            }
            $effects = $request->input('effects',[]);
            $changes[] = ['field'=>'Booking impact','from'=>'','to'=>($effects['affected'] ?? 0).' affected; '.($effects['decision'] ?? 'keep')];
        }
        SystemAudit::record($actor, $category, $action, $target, $changes);
        return $response;
    }
    private function area(Request $r):string{
        return match(explode('/',$r->path())[1]??''){ 'appointments'=>'Appointments','queue','visits'=>'Queue','admins'=>'Admin accounts','calendar'=>'Office calendar','settings'=>'System settings','chats'=>'Messages','confidential'=>'Confidential records','service-records'=>'Transactions','services'=>'Services','notifications'=>'Appointment emails','history'=>'Visit history',default=>'Staff access'};
    }
    private function action(Request $r,array $body):string{
        if($r->is('api/login'))return 'Signed in';if($r->is('api/logout'))return 'Signed out';
        if($r->is('api/password'))return 'Password changed';if($r->is('api/profile'))return 'Profile updated';
        if($r->is('api/queue/*/feedback'))return 'Visitor feedback submitted';
        if($r->is('api/appointments/*/check-in'))return 'Appointment checked in';
        if($r->is('api/appointments/*/cancel'))return 'Appointment cancelled';
        if($r->is('api/queue/call-next'))return 'Next visitor called';
        if($r->is('api/queue/*'))return match($body['queue']['status']??''){'Called'=>'Visitor called','Serving'=>'Service started','Completed'=>'Service completed','Skipped'=>'Visitor skipped','Cancelled'=>'Visit cancelled','Waiting'=>'Visitor returned to waiting',default=>'Queue entry updated'};
        if($r->is('api/visits/*/cancel'))return 'Visit cancelled';if($r->is('api/visits'))return 'Walk-in registered';
        if($r->is('api/appointments'))return 'Appointment requested';if($r->is('api/appointments/*'))return 'Appointment schedule updated';
        if($r->is('api/admins*'))return $r->isMethod('post')?'Admin account created':($r->isMethod('delete')?'Admin account removed':'Admin account updated');
        if($r->is('api/calendar'))return 'Office calendar updated';if($r->is('api/settings'))return 'System settings updated';
        if($r->is('api/services*'))return $r->isMethod('delete')?'Service removed':'Service updated';
        if($r->is('api/service-records*'))return 'Transaction updated';
        if($r->is('api/chats/*/messages'))return 'Message sent';if($r->is('api/chats*'))return $r->isMethod('delete')?'Conversation deleted':($r->isMethod('post')?'Conversation started':'Conversation status changed');
        if($r->is('api/confidential/*/unlock','api/confidential/cases/*/unlock'))return 'Confidential record unlocked';
        if($r->is('api/confidential/requests*'))return 'Confidential access request updated';if($r->is('api/confidential*'))return 'Confidential case updated';
        if($r->is('api/history/code'))return 'Verification code requested';if($r->is('api/history/verify'))return 'Visitor Gmail verified';
        if($r->is('api/notifications*'))return $r->isMethod('delete')||$r->is('api/notifications/cancel-token')?'Pending appointment emails cancelled':'Appointment email queued';
        if($r->is('api/import-browser'))return 'Legacy records imported';return 'System activity recorded';
    }
}
