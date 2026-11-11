<?php

namespace App\Http\Controllers;

use App\Support\StaffAuth;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\Rule;

class AdminManagementController extends Controller
{
    public function handle(Request $request, ?string $id = null)
    {
        StaffAuth::user($request, 'SUPER_ADMIN');
        $query = DB::table('staff_users')->where('role', 'ADMIN');
        if ($request->isMethod('get')) {
            return response()->json(['users' => DB::table('staff_users')->whereIn('role', ['ADMIN', 'SUPER_ADMIN'])->orderBy('full_name')->get()->map(fn ($user) => $this->present($user))]);
        }
        if ($id !== null) {
            abort_unless((clone $query)->where('id', $id)->exists(), 404, 'Admin account not found.');
        }
        if ($request->isMethod('delete')) {
            $query->where('id', $id)->delete();
            return response()->json(['message' => 'Admin removed.']);
        }
        $creating = $request->isMethod('post');
        if($request->has('firstName')||$request->has('lastName')){
            $names=$request->validate(['firstName'=>'required|string|max:60','lastName'=>'required|string|max:60']);
            $request->merge(['fullName'=>mb_convert_case(trim($names['firstName']),MB_CASE_TITLE,'UTF-8').' '.mb_convert_case(trim($names['lastName']),MB_CASE_TITLE,'UTF-8')]);
        }
        if($request->has('username')){$username=trim($request->input('username'));$request->merge(['username'=>ucfirst($username)]);}
        $data = $request->validate([
            'fullName' => [$creating ? 'required' : 'sometimes', 'required', 'string', 'max:120'],
            'username' => [$creating ? 'required' : 'sometimes', 'required', 'string', 'max:50', 'regex:/^[a-zA-Z0-9_.-]+$/', Rule::unique('staff_users', 'username')->ignore($id, 'id')],
            'email' => ['sometimes', 'nullable', 'email', 'max:120', Rule::unique('staff_users', 'email')->ignore($id, 'id')],
            'password' => [$creating ? 'required' : 'sometimes', 'required', ...\App\Support\AccountPassword::rules()],
            'active' => ['sometimes', 'boolean'],
            'confidentialAccess' => ['sometimes', 'boolean'],
            'confidentialApprover' => ['sometimes', 'boolean'],
        ]);
        $values = [];
        foreach (['fullName' => 'full_name', 'username' => 'username', 'email' => 'email', 'active' => 'is_active', 'confidentialAccess' => 'confidential_access'] as $key => $column) {
            if (array_key_exists($key, $data)) {
                $values[$column] = $data[$key];
            }
        }
        if (isset($data['password'])) {
            $values['password_hash'] = Hash::make($data['password']);
        }
        if (array_key_exists('confidentialApprover', $data)) {
            $values['confidential_approver'] = $data['confidentialApprover'];
            if ($data['confidentialApprover']) $values['confidential_access'] = true;
        }
        if (($data['confidentialAccess'] ?? null) === false) $values['confidential_approver'] = false;
        if ($id && (($data['confidentialAccess'] ?? null) === false || ($data['active'] ?? null) === false)) {
            DB::table('confidential_requests')->where('requester_id',$id)->whereIn('status',['Pending','Approved'])->update(['status'=>'Revoked','updated_at'=>now()]);
        }
        if ($id && (($values['confidential_approver'] ?? null) === false || ($data['active'] ?? null) === false)) {
            DB::table('confidential_requests')->where('reviewer_id',$id)->where('status','Approved')->update(['status'=>'Revoked','updated_at'=>now()]);
        }
        if ($creating) {
            $id = 'u'.bin2hex(random_bytes(8));
            DB::table('staff_users')->insert($values + ['id' => $id, 'role' => 'ADMIN', 'is_active' => true]);
        } else {
            $query->where('id', $id)->update($values + ['updated_at' => now()]);
        }
        return response()->json(['user' => $this->present(DB::table('staff_users')->where('id', $id)->first())], $creating ? 201 : 200);
    }

    private function present(object $user): array
    {
        return ['id' => $user->id, 'username' => $user->username, 'fullName' => $user->full_name,
            'email' => $user->email, 'role' => $user->role, 'active' => (bool) $user->is_active,
            'confidentialAccess' => (bool) $user->confidential_access,
            'confidentialApprover' => (bool) ($user->confidential_approver ?? false)];
    }
}
