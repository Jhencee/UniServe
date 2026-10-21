<?php

namespace App\Support;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

class StaffAuth
{
    public static function needsPasswordChange(object $user): bool {
        return \Illuminate\Support\Facades\Cache::remember('default-password:'.hash('sha256',$user->password_hash),3600,function()use($user){
            foreach(['1234','admin','password'] as $password)if(password_verify($password,$user->password_hash))return true;
            return false;
        });
    }
    public static function token(object $user): string
    {
        return Crypt::encryptString(json_encode([
            'id' => $user->id, 'expires' => time() + 3600,
            'credential' => hash('sha256', $user->password_hash),
        ]));
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
        abort_unless($user && $user->is_active && ($payload['expires'] ?? 0) > time()
            && hash_equals(hash('sha256', $user->password_hash), $payload['credential'] ?? ''), 401, 'Please sign in again.');
        abort_if($role !== null && $user->role !== $role, 403, 'Super Admin access required.');
        abort_if(self::needsPasswordChange($user) && !$request->is('api/profile') && !$request->is('api/password') && !$request->is('api/logout'),403,'Change your default password in My Profile first.');
        return $user;
    }

    public static function present(object $user): array
    {
        return ['id' => $user->id, 'username' => $user->username, 'email' => $user->email,
            'fullName' => $user->full_name, 'role' => $user->role, 'active' => (bool) $user->is_active,
            'confidentialAccess' => (bool) $user->confidential_access,
            'confidentialApprover' => (bool) ($user->confidential_approver ?? false),
            'requiresPasswordChange'=>self::needsPasswordChange($user)];
    }
}
