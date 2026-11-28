<?php

namespace App\Support;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

class StaffAuth
{
    public static function needsPasswordChange(object $user): bool {
        return \Illuminate\Support\Facades\Cache::remember('default-password:'.hash('sha256',$user->password_hash),3600,function()use($user){
            foreach(['1234','admin','password','admin123'] as $password)if(password_verify($password,$user->password_hash))return true;
            return false;
        });
    }
    public static function token(object $user): string
    {
        $token=Crypt::encryptString(json_encode([
            'nonce'=>bin2hex(random_bytes(16)), 'id' => $user->id, 'expires' => now()->timestamp + 3600,
            'credential' => hash('sha256', $user->password_hash.($user->mfa_secret??'').($user->mfa_version??'')),
            'epoch' => \Illuminate\Support\Facades\Cache::get('system:credential-epoch','initial'),
        ]));
        StaffSessions::register($token,$user);
        return $token;
    }

    public static function user(Request $request, ?string $role = null): object
    {
        abort_if(\Illuminate\Support\Facades\Cache::get('revoked-token:'.hash('sha256',$request->bearerToken()??'')),401,'Please sign in again.');
        try {
            $payload = json_decode(Crypt::decryptString($request->bearerToken() ?? ''), true, 512, JSON_THROW_ON_ERROR);
        } catch (\Throwable $exception) {
            abort(401, 'Please sign in again.');
        }
        $user = DB::table('staff_users')->where('id', $payload['id'] ?? '')->first();
        abort_unless(hash_equals((string)\Illuminate\Support\Facades\Cache::get('system:credential-epoch','initial'), (string)($payload['epoch']??'initial')),401,'Data was restored. Please sign in again.');
        abort_unless($user && $user->is_active && ($payload['expires'] ?? 0) > now()->timestamp
            && hash_equals(hash('sha256', $user->password_hash.($user->mfa_secret??'').($user->mfa_version??'')), $payload['credential'] ?? ''), 401, 'Please sign in again.');
        StaffSessions::check($request,$user);
        abort_if($role !== null && $user->role !== $role, 403, $role === 'ADMIN' ? 'Admin access required.' : 'Super Admin access required.');
        abort_if(self::needsPasswordChange($user) && !$request->is('api/profile') && !$request->is('api/password') && !$request->is('api/logout'),403,'Change your default password in My Profile first.');
        return $user;
    }

    public static function present(object $user): array
    {
        return ['id' => $user->id, 'username' => $user->username, 'email' => $user->email,
            'fullName' => $user->full_name, 'role' => $user->role, 'active' => (bool) $user->is_active,
            'confidentialAccess' => (bool) $user->confidential_access,
            'confidentialApprover' => false,
            'requiresPasswordChange'=>self::needsPasswordChange($user)];
    }
}
