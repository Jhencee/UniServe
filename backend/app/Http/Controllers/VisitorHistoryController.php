<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class VisitorHistoryController extends Controller
{
    public function send(Request $request)
    {
        $data=$request->validate(['email'=>['required','email','max:120']]);
        \App\Support\VisitorChallenge::validate($request);
        $email=strtolower($data['email']);
        abort_unless(config('mail.default')==='smtp' && config('mail.mailers.smtp.username') && config('mail.mailers.smtp.password'),503,'Email verification is unavailable until office email delivery is configured.');
        $cooldown='history-cooldown:'.hash('sha256',$email);
        abort_unless(Cache::add($cooldown,true,60),429,'Please wait one minute before requesting another code.');
        $id=(string)Str::uuid();$code=(string)random_int(100000,999999);
        Cache::put('history-code:'.$id,['emailCipher'=>Crypt::encryptString($email),'hash'=>hash_hmac('sha256',$code,config('app.key')),'attempts'=>0,'expiresAt'=>time()+300],300);
        try { \App\Jobs\SendVerificationCode::dispatch($id,$email,$code); }
        catch(\Throwable $e){Cache::forget('history-code:'.$id);Cache::forget($cooldown);return response()->json(['message'=>'Could not queue the code. Please try again later.'],503);}
        return response()->json(['challengeId'=>$id,'expiresIn'=>300,'queued'=>true]);
    }
    public function records(Request $request)
    {
        $email=\App\Support\VisitorAccess::email($request);
        $queues=DB::table('queues')->where(\Illuminate\Support\Facades\Schema::hasColumn('queues','email_hash')?'email_hash':'portal_payload->email',\Illuminate\Support\Facades\Schema::hasColumn('queues','email_hash')?\App\Support\EmailIndex::key($email):$email)->orderByDesc('created_at')->limit(200)->get()->map(fn($row)=>\App\Support\QueueData::read($row->portal_payload));
        $appointments=DB::table('shared_appointments')->where('email',\App\Support\EmailIndex::key($email))->orderByDesc('created_at')->get()->map(fn($row)=>AppointmentController::present($row));
        return response()->json(['email'=>$email,'queues'=>$queues,'appointments'=>$appointments]);
    }
    public function verify(Request $request)
    {
        $data=$request->validate(['challengeId'=>['required','uuid'],'code'=>['required','regex:/^\d{6}$/']]);
        $key='history-code:'.$data['challengeId'];
        return Cache::lock($key.':verify',10)->block(5,function()use($key,$data){
        $challenge=Cache::get($key);
        abort_unless($challenge && $challenge['expiresAt'] > time(),422,'The code expired or was already used. Request a new code.');
        if (!hash_equals($challenge['hash'],hash_hmac('sha256',$data['code'],config('app.key')))) {
            $challenge['attempts']++;
            if($challenge['attempts']>=5)Cache::forget($key);else Cache::put($key,$challenge, max(1,$challenge['expiresAt']-time()));
            return response()->json(['message'=>$challenge['attempts']>=5?'Too many incorrect attempts. Request a new code.':'Incorrect code.'],422);
        }
        Cache::forget($key);
        $challenge['email']=Crypt::decryptString($challenge['emailCipher']);
        \App\Support\QueueDayClosure::run();
        $queues=DB::table('queues')->where(\Illuminate\Support\Facades\Schema::hasColumn('queues','email_hash')?'email_hash':'portal_payload->email',\Illuminate\Support\Facades\Schema::hasColumn('queues','email_hash')?\App\Support\EmailIndex::key($challenge['email']):$challenge['email'])->orderByDesc('created_at')->limit(200)->get()->map(fn($row)=>\App\Support\QueueData::read($row->portal_payload));
        $appointments=\Illuminate\Support\Facades\Schema::hasTable('shared_appointments')?DB::table('shared_appointments')->where('email',\App\Support\EmailIndex::key($challenge['email']))->orderByDesc('created_at')->get()->map(fn($row)=>AppointmentController::present($row)):[];
        return response()->json(['verified'=>true,'queues'=>$queues,'appointments'=>$appointments,'visitorToken'=>\App\Support\VisitorAccess::token($challenge['email'])]);
        });
    }
}
