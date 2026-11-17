<?php
namespace App\Support;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\{Cache, DB};

final class StaffSessions
{
    public static function register(string $token, object $user): void
    {
        $key=hash('sha256',$token);
        Cache::put('staff-session:'.$key,['user'=>$user->id,'last'=>now()->timestamp,'expires'=>now()->timestamp+3600],3700);
        $sessions=Cache::get('staff-sessions:'.$user->id,[]);
        $sessions[$key]=['id'=>$key,'started'=>now()->toIso8601String(),'expires'=>now()->timestamp+3600];
        Cache::put('staff-sessions:'.$user->id,array_filter($sessions,fn($s)=>$s['expires']>now()->timestamp),3700);
    }

    public static function check(Request $request, object $user): void
    {
        $key=hash('sha256',$request->bearerToken()??'');
        $session=Cache::get('staff-session:'.$key);
        // Pre-upgrade tokens must sign in again. Missing cache state cannot reset an idle clock.
        abort_unless($session&&$session['user']===$user->id,401,'Please sign in again.');
        $settings=\Illuminate\Support\Facades\Schema::hasTable('shared_system_settings')?json_decode(DB::table('shared_system_settings')->where('id',1)->value('payload')??'{}',true):[];
        $minutes=max(5,min(120,(int)($settings['sessionTimeout']??30)));
        abort_if(now()->timestamp-$session['last']>=$minutes*60,401,'Your session ended after inactivity. Please sign in again.');
        // Polling does not keep a session alive. Only the activity endpoint records user interaction.
        if($request->is('api/session/activity')){
            $session['last']=now()->timestamp;
            Cache::put('staff-session:'.$key,$session,max(1,$session['expires']-now()->timestamp));
        }
    }

    public static function requireConfirmation(Request $request): void
    {
        abort_unless(Cache::get('staff-confirmed:'.hash('sha256',$request->bearerToken()??'')),428,'Confirm your password before continuing.');
    }

    public static function revokeAll(string $userId): void
    {
        foreach(Cache::get('staff-sessions:'.$userId,[]) as $key=>$session){
            Cache::put('revoked-token:'.$key,true,3700);
            Cache::forget('staff-session:'.$key);
        }
        Cache::forget('staff-sessions:'.$userId);
    }
}
