<?php

namespace App\Support;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\{Cache, DB, Schema};
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Cookie;

final class TrustedDevices
{
    public const COOKIE = '__Host-uniserve_trusted_device';

    public static function available(): bool { return Schema::hasTable('staff_trusted_devices'); }

    public static function credentials(object $user): string
    {
        return hash_hmac('sha256', json_encode([$user->password_hash, $user->mfa_secret ?? '', $user->mfa_version ?? '', Cache::get('system:credential-epoch','initial')]), (string)config('app.key'));
    }

    private static function fingerprint(string $value): string { return hash_hmac('sha256', $value, (string)config('app.key')); }

    // CORS alone doesn't reject requests: cross-site trust must only be used by approved frontends.
    public static function allowedOrigin(Request $request): bool
    {
        $origin=$request->header('Origin');
        if ($origin===null) return true;
        if (in_array($origin,config('cors.allowed_origins',[]),true)) return true;
        foreach(config('cors.allowed_origins_patterns',[]) as $pattern) if(preg_match($pattern,$origin)===1)return true;
        return false;
    }

    public static function token(Request $request): ?string
    {
        $token=$request->cookie(self::COOKIE);
        return is_string($token)&&preg_match('/^[a-f0-9]{64}$/D',$token) ? $token : null;
    }

    public static function cookie(?string $token, ?\DateTimeInterface $expires=null): Cookie
    {
        // Host-only, HTTPS-only, HttpOnly, partitioned for the Vercel/Wasmer deployment.
        return Cookie::create(self::COOKIE,$token,$expires??now()->subYear(),'/',null,true,true,false,'none',true);
    }

    public static function consume(Request $request, object $user): ?Cookie
    {
        if($user->role!=='ADMIN'||empty($user->mfa_secret)||!self::available()||!self::allowedOrigin($request)||!($token=self::token($request)))return null;
        return DB::transaction(function()use($request,$user,$token){
            $row=DB::table('staff_trusted_devices')->where('token_hash',hash('sha256',$token))->where('staff_user_id',$user->id)->lockForUpdate()->first();
            if(!$row||$row->revoked_at)return null;
            $valid=\Carbon\CarbonImmutable::parse($row->expires_at)->isFuture()
                &&hash_equals($row->credential_hash,self::credentials($user))
                &&hash_equals($row->agent_hash,self::fingerprint((string)$request->userAgent()))
                &&hash_equals($row->ip_hash,self::fingerprint((string)$request->ip()));
            if(!$valid){
                DB::table('staff_trusted_devices')->where('id',$row->id)->update(['revoked_at'=>now(),'updated_at'=>now()]);
                SystemAudit::record($user,'Authentication','Device trust expired or invalidated',$row->id);
                return null;
            }
            $next=bin2hex(random_bytes(32));
            DB::table('staff_trusted_devices')->where('id',$row->id)->update(['token_hash'=>hash('sha256',$next),'last_used_at'=>now(),'updated_at'=>now()]);
            // Rotate proof without extending the original 30-day expiry.
            return self::cookie($next,\Carbon\CarbonImmutable::parse($row->expires_at));
        });
    }

    public static function remember(Request $request, object $user): Cookie
    {
        abort_unless($user->role==='ADMIN'&&!empty($user->mfa_secret)&&self::available()&&self::allowedOrigin($request),403);
        self::forgetCurrent($request,$user);
        $token=bin2hex(random_bytes(32));$id=(string)Str::uuid();$expires=now()->addDays(30);
        $agent=strtolower((string)$request->userAgent());
        $browser=str_contains($agent,'edg/')?'Edge':(str_contains($agent,'firefox/')?'Firefox':(str_contains($agent,'chrome/')?'Chrome':(str_contains($agent,'safari/')?'Safari':'Browser')));
        $platform=str_contains($agent,'android')?'Android':(preg_match('/iphone|ipad/',$agent)?'iOS':(str_contains($agent,'windows')?'Windows':(str_contains($agent,'mac')?'macOS':(str_contains($agent,'linux')?'Linux':'device'))));
        DB::table('staff_trusted_devices')->insert(['id'=>$id,'staff_user_id'=>$user->id,'token_hash'=>hash('sha256',$token),
            'credential_hash'=>self::credentials($user),'agent_hash'=>self::fingerprint((string)$request->userAgent()),'ip_hash'=>self::fingerprint((string)$request->ip()),
            'label'=>$browser.' on '.$platform,'expires_at'=>$expires,'last_used_at'=>now(),'created_at'=>now(),'updated_at'=>now()]);
        SystemAudit::record($user,'Authentication','Trusted device for 30 days',$id);
        return self::cookie($token,$expires);
    }

    public static function forgetCurrent(Request $request, object $user): void
    {
        if(self::available()&&($token=self::token($request)))DB::table('staff_trusted_devices')->where('staff_user_id',$user->id)->where('token_hash',hash('sha256',$token))->whereNull('revoked_at')->update(['revoked_at'=>now(),'updated_at'=>now()]);
    }

    public static function revokeAll(string $userId): void
    {
        if(self::available())DB::table('staff_trusted_devices')->where('staff_user_id',$userId)->whereNull('revoked_at')->update(['revoked_at'=>now(),'updated_at'=>now()]);
    }
}
