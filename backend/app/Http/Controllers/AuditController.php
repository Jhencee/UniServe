<?php

namespace App\Http\Controllers;

use App\Support\StaffAuth;
use App\Support\SystemAudit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class AuditController extends Controller
{
    public function store(Request $request)
    {
        $actor = StaffAuth::user($request);
        $data = $request->validate(['id'=>['required','string','max:80'], 'category'=>['required','in:Appointments,Transactions,Settings,Confidential,Data,System,Authentication,Accounts,Queue,Messages,Feedback'],
            'action'=>['required','string','max:1000'], 'target'=>['nullable','string','max:200'], 'changes'=>['sometimes','array','max:30'],
            'changes.*.field'=>['required','string','max:100'], 'changes.*.from'=>['nullable','string','max:1000'], 'changes.*.to'=>['nullable','string','max:1000']]);
        SystemAudit::record($actor,$data['category'],$data['action'],$data['target'] ?? null,$data['changes'] ?? [],'browser',$actor->id.':'.$data['id']);
        return response()->json(['saved'=>true]);
    }
    public function index(Request $request)
    {
        StaffAuth::user($request,'SUPER_ADMIN');
        $data = $request->validate(['q'=>['nullable','string','max:100'],'category'=>['nullable','string','max:50'],'actor'=>['nullable','string','max:100'],
            'from'=>['nullable','date_format:Y-m-d'],'to'=>['nullable','date_format:Y-m-d'],'page'=>['nullable','integer','min:1']]);
        $query = DB::table('system_audit')->orderByDesc('created_at')->orderByDesc('id');
        // Retain raw old synchronization checks in storage; they are not new business actions.
        $query->whereNotIn('action',['Imported 0 legacy browser records','POST api/import-browser']);
        if (!empty($data['category'])) $query->where('category',$data['category']);
        if (!empty($data['actor'])) $query->where('actor_name','like','%'.$data['actor'].'%');
        if (!empty($data['from'])) $query->where('created_at','>=',\Carbon\CarbonImmutable::parse($data['from'],'Asia/Manila')->utc());
        if (!empty($data['to'])) $query->where('created_at','<',\Carbon\CarbonImmutable::parse($data['to'],'Asia/Manila')->addDay()->utc());
        if (!empty($data['q'])) $query->where(fn($q)=>$q->where('action','like','%'.$data['q'].'%')->orWhere('target','like','%'.$data['q'].'%')->orWhere('actor_name','like','%'.$data['q'].'%'));
        $page = $query->paginate(30); $page->getCollection()->transform(function($row){$row->changes=json_decode($row->changes,true);return $row;});
        return response()->json($page);
    }
}
