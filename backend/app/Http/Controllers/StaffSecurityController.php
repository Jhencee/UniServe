<?php
namespace App\Http\Controllers;

use App\Support\{StaffAuth, StaffSessions, SystemAudit, TrustedDevices};
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{Cache, Mail};

class StaffSecurityController extends Controller
{
    public function mfa(Request $request) {
        $user=StaffAuth::user($request);
        abort_unless(\Illuminate\Support\Facades\Schema::hasColumn('staff_users','mfa_secret'),503,'Run the matching database migrations before setting up two-step sign-in.');
        if($request->isMethod('get'))return response()->json(['enabled'=>!empty($user->mfa_secret)])->header('Cache-Control','no-store');
        StaffSessions::requireConfirmation($request);
        $data=$request->validate(['action'=>'required|in:setup,enable,disable','code'=>'nullable|string|max:80']);
        $key='mfa-enrollment:'.hash('sha256',$request->bearerToken());
        if($data['action']==='setup'){
            abort_if(!empty($user->mfa_secret),409,'Two-step sign-in is already enabled.');
            $secret=\App\Support\StaffMfa::secret();
            Cache::put($key,\Illuminate\Support\Facades\Crypt::encryptString($secret),600);
            return response()->json(['secret'=>$secret])->header('Cache-Control','no-store');
        }
        if($data['action']==='disable'){
            abort_unless(!empty($user->mfa_secret)&&\App\Support\StaffMfa::verify($user,$data['code']??''),422,'Enter a new authenticator code or an unused recovery code.');
            \Illuminate\Support\Facades\DB::table('staff_users')->where('id',$user->id)->update(['mfa_version'=>bin2hex(random_bytes(16)),'mfa_secret'=>null,'mfa_recovery_codes'=>null,'mfa_last_step'=>null]);
            TrustedDevices::revokeAll($user->id);
            SystemAudit::record($user,'Authentication','Disabled two-step sign-in');
            return response()->json(['enabled'=>false]);
        }
        abort_if(!empty($user->mfa_secret),409,'Two-step sign-in is already enabled.');
        $encrypted=Cache::get($key);abort_unless($encrypted,422,'Setup expired. Start again.');
        $secret=\Illuminate\Support\Facades\Crypt::decryptString($encrypted);
        $step=intdiv(now()->timestamp,30);$matched=null;
        foreach([$step-1,$step,$step+1] as $candidate)if(hash_equals(\App\Support\StaffMfa::code($secret,$candidate*30),$data['code']??''))$matched=$candidate;
        abort_unless($matched!==null,422,'Enter the current six-digit code from your authenticator.');
        $codes=[];for($i=0;$i<8;$i++)$codes[]=bin2hex(random_bytes(8));
        \Illuminate\Support\Facades\DB::table('staff_users')->where('id',$user->id)->update(['mfa_version'=>bin2hex(random_bytes(16)),'mfa_secret'=>$encrypted,'mfa_recovery_codes'=>json_encode(array_map(fn($c)=>hash('sha256',$c),$codes)),'mfa_last_step'=>$matched]);
        TrustedDevices::revokeAll($user->id);
        Cache::forget($key);
        SystemAudit::record($user,'Authentication','Enabled two-step sign-in');
        return response()->json(['enabled'=>true,'recoveryCodes'=>$codes,'token'=>StaffAuth::token(\Illuminate\Support\Facades\DB::table('staff_users')->where('id',$user->id)->first())])->header('Cache-Control','no-store');
    }

    public function activity(Request $request) { StaffAuth::user($request);return response()->json(['active'=>true]); }

    public function sessions(Request $request) {
        $user=StaffAuth::user($request);
        $current=hash('sha256',$request->bearerToken());
        $sessions=Cache::get('staff-sessions:'.$user->id,[]);
        return response()->json(['sessions'=>array_values(array_map(fn($s)=>$s+['current'=>$s['id']===$current],array_filter($sessions,fn($s)=>$s['expires']>now()->timestamp&&Cache::has('staff-session:'.$s['id'])&&!Cache::has('revoked-token:'.$s['id']))))])->header('Cache-Control','no-store');
    }

    public function revoke(Request $request) {
        $user=StaffAuth::user($request);
        StaffSessions::requireConfirmation($request);
        $input=$request->validate(['id'=>'required|string|size:64']);
        $sessions=Cache::get('staff-sessions:'.$user->id,[]);
        abort_unless(isset($sessions[$input['id']]),404,'Session not found.');
        Cache::put('revoked-token:'.$input['id'],true,3700);
        Cache::forget('staff-session:'.$input['id']);
        SystemAudit::record($user,'Authentication','Revoked staff session');
        return response()->json(['revoked'=>true]);
    }

    public function testEmail(Request $request) {
        $user=StaffAuth::user($request,'SUPER_ADMIN');
        StaffSessions::requireConfirmation($request);
        abort_unless(filter_var($user->email,FILTER_VALIDATE_EMAIL),422,'Add a valid email address in My Profile first.');
        abort_if(in_array(config('mail.default'),['log','array']),422,'Configure an email delivery transport first. The current transport does not deliver email.');
        $reference=strtoupper(bin2hex(random_bytes(4)));
        try {
            Mail::raw('UniServe email delivery test. Reference: '.$reference.'. Confirm this reference in your inbox. No visitor information is included.',fn($m)=>$m->to($user->email)->subject('UniServe email test '.$reference));
        } catch(\Throwable $error) { report($error);abort(502,'The mail transport could not send the test. Check the server mail configuration and logs.'); }
        Cache::put('system:email-test',['sentAt'=>now()->toIso8601String(),'reference'=>$reference],86400);
        SystemAudit::record($user,'System','Sent test email');
        return response()->json(['message'=>'Test submitted to the mail transport. Confirm receipt in your inbox.','reference'=>$reference]);
    }
}
