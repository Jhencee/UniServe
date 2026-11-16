<?php
namespace App\Support;

use Illuminate\Support\Facades\{Cache, Crypt, DB};

final class StaffMfa
{
    public static function secret(): string
    {
        $alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';$result='';
        foreach(str_split(random_bytes(20)) as $byte){$bits=str_pad(decbin(ord($byte)),8,'0',STR_PAD_LEFT);$buffer=($buffer??'').$bits;}
        foreach(str_split($buffer,5) as $chunk)$result.=$alphabet[bindec($chunk)];
        return $result;
    }

    // RFC 6238: 30-second counter, HMAC-SHA1, dynamic truncation, six digits.
    public static function code(string $secret,int $timestamp,int $digits=6): string
    {
        $bits='';$alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        foreach(str_split($secret) as $char){$position=strpos($alphabet,$char);if($position===false)throw new \InvalidArgumentException('Invalid authenticator secret.');$bits.=str_pad(decbin($position),5,'0',STR_PAD_LEFT);}
        $key='';foreach(str_split($bits,8) as $byte)if(strlen($byte)===8)$key.=chr(bindec($byte));
        // Build the eight-byte big-endian counter without a 2^32 integer:
        // that literal becomes a float on Wasmer's 32-bit PHP runtime.
        $counter=intdiv($timestamp,30);$counterBytes='';
        for($i=0;$i<8;$i++){$counterBytes=chr($counter%256).$counterBytes;$counter=intdiv($counter,256);}
        $hash=hash_hmac('sha1',$counterBytes,$key,true);
        $offset=ord($hash[19])&15;$number=unpack('N',substr($hash,$offset,4))[1]&0x7fffffff;
        return str_pad((string)($number%(10**$digits)),$digits,'0',STR_PAD_LEFT);
    }

    public static function verify(object $user,string $code): bool
    {
        if(empty($user->mfa_secret))return true;
        return DB::transaction(function()use($user,$code){
            $fresh=DB::table('staff_users')->where('id',$user->id)->lockForUpdate()->first();
            if(empty($fresh->mfa_secret))return false;
            $secret=Crypt::decryptString($fresh->mfa_secret);
            if(preg_match('/^\d{6}$/',$code)){
                $current=intdiv(now()->timestamp,30);
                for($step=$current-1;$step<=$current+1;$step++){
                    if($step>(int)($fresh->mfa_last_step??-1)&&hash_equals(self::code($secret,$step*30),$code)){
                        DB::table('staff_users')->where('id',$user->id)->update(['mfa_last_step'=>$step]);return true;
                    }
                }
            }
            $codes=json_decode($fresh->mfa_recovery_codes??'[]',true);
            foreach($codes as $index=>$hash)if(hash_equals($hash,hash('sha256',$code))){unset($codes[$index]);DB::table('staff_users')->where('id',$user->id)->update(['mfa_recovery_codes'=>json_encode(array_values($codes))]);return true;}
            return false;
        });
    }
}
