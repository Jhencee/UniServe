<?php

namespace App\Http\Controllers;

use App\Support\StaffAuth;
use Illuminate\Validation\Rule;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class StaffLoginController extends Controller
{
    public function confirmPassword(Request $request): JsonResponse
    {
        $user=StaffAuth::user($request,'SUPER_ADMIN');
        $data=$request->validate(['password'=>'required|string|max:255']);
        abort_unless(Hash::check($data['password'],$user->password_hash),422,'Incorrect Super Admin password.');
        return response()->json(['confirmed'=>true]);
    }
    public function challenge():JsonResponse {
        $enabled=(bool)config('services.turnstile.enabled');
        abort_if($enabled&&(!config('services.turnstile.site_key')||!config('services.turnstile.secret_key')),503,'Sign-in verification is not configured. Contact the office.');
        return response()->json(['enabled'=>$enabled,'siteKey'=>$enabled?config('services.turnstile.site_key'):null]);
    }
    public function logout(Request $request):JsonResponse {
        StaffAuth::user($request);
        \Illuminate\Support\Facades\Cache::put('revoked-token:'.hash('sha256',$request->bearerToken()),true,86400);
        return response()->json(['loggedOut'=>true]);
    }
    public function profile(Request $request): JsonResponse
    {
        $user = StaffAuth::user($request, 'SUPER_ADMIN');
        $data = $request->validate([
            'fullName' => ['required', 'string', 'max:120'],
            'username' => ['required', 'string', 'max:50', 'regex:/^[a-zA-Z0-9_.-]+$/', Rule::unique('staff_users', 'username')->ignore($user->id, 'id')],
            'email' => ['required', 'email', 'max:120', Rule::unique('staff_users', 'email')->ignore($user->id, 'id')],
            'current_password' => ['required', 'string'],
            'new_password' => ['nullable', ...\App\Support\AccountPassword::rules(), 'confirmed'],
        ]);
        if (! Hash::check($data['current_password'], $user->password_hash)) {
            return response()->json(['message' => 'Incorrect current password.'], 422);
        }
        abort_if(StaffAuth::needsPasswordChange($user) && empty($data['new_password']),422,'Set a new password to replace the default password.');
        $values = ['full_name' => $data['fullName'], 'username' => $data['username'], 'email' => $data['email'], 'updated_at' => now()];
        if (! empty($data['new_password'])) {
            $values['password_hash'] = Hash::make($data['new_password']);
        }
        DB::table('staff_users')->where('id', $user->id)->update($values);
        $user = DB::table('staff_users')->where('id', $user->id)->first();
        return response()->json(['user' => StaffAuth::present($user), 'token' => StaffAuth::token($user)]);
    }

    public function changePassword(Request $request): JsonResponse
    {
        $request->validate(['new_password' => ['required', ...\App\Support\AccountPassword::rules()]], ['new_password.regex'=>\App\Support\AccountPassword::HINT]);
        $login = $this($request);
        if ($login->getStatusCode() !== 200) {
            return $login;
        }
        $user = $login->getData(true)['user'];
        DB::table('staff_users')->where('id', $user['id'])->update([
            'password_hash' => Hash::make($request->input('new_password')),
        ]);
        $updated=DB::table('staff_users')->where('id',$user['id'])->first();
        return response()->json(['message' => 'Password updated.','user'=>StaffAuth::present($updated),'token'=>StaffAuth::token($updated)]);
    }

    public function __invoke(Request $request): JsonResponse
    {
        if(config('services.turnstile.enabled')){
            abort_unless(config('services.turnstile.secret_key')&&config('services.turnstile.site_key'),503,'Sign-in verification is not configured. Contact the office.');
            $request->validate(['turnstileToken'=>'required|string|max:2048'],['turnstileToken.required'=>'Complete the security check before signing in.']);
            try {
                $response=\Illuminate\Support\Facades\Http::asForm()->timeout(10)->post('https://challenges.cloudflare.com/turnstile/v0/siteverify',[
                    'secret'=>config('services.turnstile.secret_key'),'response'=>$request->input('turnstileToken'),'remoteip'=>$request->ip(),
                ]);
            }catch(\Throwable $e){abort(503,'Security verification is unavailable. Please try again.');}
            abort_unless($response->successful(),503,'Security verification is unavailable. Please try again.');
            $check=$response->json();
            // Dummy keys return test metadata rather than the requested action.
            $testingKeys=app()->environment(['local','testing'])
                && config('services.turnstile.site_key')==='1x00000000000000000000AA'
                && config('services.turnstile.secret_key')==='1x0000000000000000000000000000000AA';
            abort_unless(($check['success']??false)===true&&($testingKeys||($check['action']??'')==='staff-login'),422,'Security check failed or expired. Please try again.');
            $hostnames=config('services.turnstile.hostnames',[]);
            abort_if($hostnames&&!in_array($check['hostname']??'',$hostnames,true),422,'Security check did not match this site.');
        }
        $input = $request->validate([
            'username' => ['required', 'string', 'max:120'],
            'password' => ['required', 'string', 'max:255'],
        ]);
        $identifier = trim($input['username']);
        $attemptKey='staff-login-failed:'.hash('sha256',strtolower($identifier).'|'.$request->ip());
        if(\Illuminate\Support\Facades\RateLimiter::tooManyAttempts($attemptKey,5)){
            $wait=\Illuminate\Support\Facades\RateLimiter::availableIn($attemptKey);
            return response()->json(['message'=>'Too many incorrect attempts. Try again in '.$wait.' seconds.'],429)->header('Retry-After',$wait);
        }
        $user = DB::table('staff_users')->whereIn('role', ['ADMIN', 'SUPER_ADMIN'])
            ->where(fn ($query) => $query->where('username', $identifier)->orWhere('email', $identifier))
            ->first();

        if (! $user || ! Hash::check($input['password'], $user->password_hash)) {
            \Illuminate\Support\Facades\RateLimiter::hit($attemptKey,60);
            return response()->json(['message' => 'Invalid username/email or password.'], 401);
        }
        if (! $user->is_active) {
            return response()->json(['message' => 'This account has been deactivated.'], 403);
        }

        return response()->json(['user' => StaffAuth::present($user), 'token' => StaffAuth::token($user)]);
    }
}
