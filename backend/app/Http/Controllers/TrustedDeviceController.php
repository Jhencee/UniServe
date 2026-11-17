<?php

namespace App\Http\Controllers;

use App\Support\{StaffAuth, StaffSessions, SystemAudit, TrustedDevices};
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class TrustedDeviceController extends Controller
{
    public function handle(Request $request)
    {
        $user=StaffAuth::user($request,'ADMIN');
        abort_unless(TrustedDevices::available(),503,'Apply the trusted-device database migration first.');
        $query=DB::table('staff_trusted_devices')->where('staff_user_id',$user->id)->whereNull('revoked_at');
        if($request->isMethod('get')){
            $hash=TrustedDevices::token($request)?hash('sha256',TrustedDevices::token($request)):null;
            $devices=(clone $query)->where('expires_at','>',now())->where('credential_hash',TrustedDevices::credentials($user))->orderByDesc('last_used_at')->get()
                ->map(fn($row)=>['id'=>$row->id,'label'=>$row->label,'createdAt'=>$row->created_at,'lastUsedAt'=>$row->last_used_at,'expiresAt'=>$row->expires_at,'current'=>$hash!==null&&hash_equals($row->token_hash,$hash)]);
            return response()->json(['devices'=>$devices])->header('Cache-Control','no-store');
        }
        StaffSessions::requireConfirmation($request);
        $data=$request->validate(['id'=>'required_without:all|uuid','all'=>'sometimes|accepted']);
        if(!($data['all']??false))abort_unless((clone $query)->where('id',$data['id'])->exists(),404,'Trusted device not found.');
        $current=TrustedDevices::token($request);
        $clear=$current&&(clone $query)->where('token_hash',hash('sha256',$current))->when(!($data['all']??false),fn($q)=>$q->where('id',$data['id']))->exists();
        if($data['all']??false)TrustedDevices::revokeAll($user->id);
        else (clone $query)->where('id',$data['id'])->update(['revoked_at'=>now(),'updated_at'=>now()]);
        SystemAudit::record($user,'Authentication',($data['all']??false)?'Revoked all trusted devices':'Revoked trusted device',$data['id']??null);
        $response=response()->json(['revoked'=>true])->header('Cache-Control','no-store');
        return $clear?$response->withCookie(TrustedDevices::cookie(null)):$response;
    }
}
