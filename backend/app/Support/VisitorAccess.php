<?php
namespace App\Support;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
class VisitorAccess {
 public static function requireEmail(Request $request, string $email): void {
  abort_unless(self::email($request) === strtolower(trim($email)),403,'Verify the Gmail address entered in your details before submitting.');
 }
 public static function ownsQueue(Request $r,array $q):void {
  if($r->header('X-Visit-Token')){
   try{$d=json_decode(Crypt::decryptString($r->header('X-Visit-Token')),true);}catch(\Throwable $e){abort(401);}
   abort_unless(($d['purpose']??'')==='visit'&&($d['visitId']??'')===($q['visitId']??null)&&($d['expires']??0)>time(),401);return;
  }
  abort_unless(self::email($r)===strtolower($q['email']??''),403,'Verify the Gmail for this visit.');
 }
 public static function token(string $email): string {return Crypt::encryptString(json_encode(['email'=>strtolower($email),'purpose'=>'visitor','expires'=>time()+3600]));}
 public static function email(Request $request): string {
  try {$d=json_decode(Crypt::decryptString($request->header('X-Visitor-Token','')),true);}catch(\Throwable $e){abort(401,'Verify your Gmail to access this visit.');}
  abort_unless(($d['purpose']??'')==='visitor' && ($d['expires']??0)>time(),401,'Verify your Gmail again.');
  return $d['email'];
 }
}
