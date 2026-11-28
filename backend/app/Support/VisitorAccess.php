<?php
namespace App\Support;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Cache;
class VisitorAccess {
 public static function requireEmail(Request $request, string $email): void {
  abort_unless(self::email($request) === strtolower(trim($email)),403,'Verify the email address entered in your details before submitting.');
 }
 public static function ownsQueue(Request $r,array $q):void {
  if($r->header('X-Visit-Token')){
   try{$d=json_decode(Crypt::decryptString($r->header('X-Visit-Token')),true);}catch(\Throwable $e){$d=null;}
   $session=Cache::get('visitor-session:'.($d['session']??''));
   if(($d['purpose']??'')==='visit'&&($d['visitId']??'')===($q['visitId']??null)&&($d['expires']??0)>time()&&$session&&($session['expires']??0)>time()&&hash_equals($session['email'],strtolower(trim($q['email']??''))))return;
  }
  abort_unless(self::email($r)===strtolower($q['email']??''),403,'Verify the email for this visit.');
 }
 public static function token(string $email): string {
  $email=strtolower(trim($email));$id=bin2hex(random_bytes(16));$expires=time()+3600;$index='visitor-sessions:'.EmailIndex::key($email);
  Cache::put('visitor-session:'.$id,['email'=>$email,'expires'=>$expires],3600);
  Cache::lock($index.':lock',10)->block(5,function()use($index,$id,$expires){$sessions=Cache::get($index,[]);$sessions=array_filter($sessions,fn($s)=>$s['expires']>time());$sessions[$id]=['id'=>$id,'started'=>now()->toIso8601String(),'expires'=>$expires];Cache::put($index,$sessions,3600);});
  return Crypt::encryptString(json_encode(['email'=>$email,'purpose'=>'visitor','expires'=>$expires,'session'=>$id]));
 }
 public static function sessionId(Request $request): string {
  self::email($request);$d=json_decode(Crypt::decryptString($request->header('X-Visitor-Token')),true);return $d['session'];
 }
 public static function email(Request $request): string {
  try {$d=json_decode(Crypt::decryptString($request->header('X-Visitor-Token','')),true);}catch(\Throwable $e){abort(401,'Verify your email to access this visit.');}
  abort_unless(($d['purpose']??'')==='visitor' && ($d['expires']??0)>time(),401,'Verify your email again.');
  $session=Cache::get('visitor-session:'.($d['session']??''));
  abort_unless($session&&($session['expires']??0)>time()&&hash_equals($session['email'],$d['email']??''),401,'Your session has ended. Verify your email again.');
  return $d['email'];
 }
}
