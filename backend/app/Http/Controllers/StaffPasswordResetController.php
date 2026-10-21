<?php
namespace App\Http\Controllers;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{Cache,DB,Hash};
use Illuminate\Support\Str;
use App\Support\{AccountPassword,SystemAudit};
class StaffPasswordResetController extends Controller {
 public function send(Request $r){
  $d=$r->validate(['email'=>'required|email|max:120']);$email=strtolower(trim($d['email']));
  abort_unless(config('mail.default')==='smtp'&&config('mail.mailers.smtp.username')&&config('mail.mailers.smtp.password'),503,'Password reset email is unavailable. Contact your Super Admin.');
  abort_unless(Cache::add('staff-reset-cooldown:'.hash('sha256',$email),true,60),429,'Please wait one minute before requesting another code.');
  $id=(string)Str::uuid();$u=DB::table('staff_users')->whereRaw('LOWER(email) = ?',[$email])->where('is_active',true)->first();
  if($u){$code=(string)random_int(100000,999999);Cache::put('staff-reset:'.$id,['user'=>$u->id,'credential'=>hash('sha256',$u->password_hash),'hash'=>hash_hmac('sha256',$code,config('app.key')),'attempts'=>0,'expires'=>time()+300],300);\App\Jobs\SendPasswordResetCode::dispatch($id,$email,$code);SystemAudit::record($u,'Authentication','Password reset requested');}
  return response()->json(['challengeId'=>$id,'message'=>'If this email belongs to an active staff account, a code will arrive shortly. It expires in five minutes.']);
 }
 public function reset(Request $r){
  $d=$r->validate(['challengeId'=>'required|uuid','code'=>['required','regex:/^[0-9]{6}$/'],'password'=>['required',...AccountPassword::rules(),'confirmed']],['password.regex'=>AccountPassword::HINT]);
  return Cache::lock('staff-reset-lock:'.$d['challengeId'],10)->block(5,function()use($d){
   $key='staff-reset:'.$d['challengeId'];$c=Cache::get($key);abort_unless($c&&$c['expires']>time(),422,'The code expired or was already used. Request a new code.');
   if(!hash_equals($c['hash'],hash_hmac('sha256',$d['code'],config('app.key')))){$c['attempts']++;if($c['attempts']>=5)Cache::forget($key);else Cache::put($key,$c,max(1,$c['expires']-time()));abort(422,'Incorrect code. Check your email and try again.');}
   DB::transaction(function()use($c,$d){$u=DB::table('staff_users')->where('id',$c['user'])->lockForUpdate()->first();abort_unless($u&&$u->is_active&&hash_equals($c['credential'],hash('sha256',$u->password_hash)),422,'This reset is no longer valid. Request a new code.');DB::table('staff_users')->where('id',$u->id)->update(['password_hash'=>Hash::make($d['password'])]);SystemAudit::record($u,'Authentication','Password reset completed');});Cache::forget($key);return response()->json(['message'=>'Password updated. Sign in with your new password.']);
  });
 }
}
