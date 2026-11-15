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
            'from'=>['nullable','date_format:Y-m-d'],'to'=>['nullable','date_format:Y-m-d'],'page'=>['nullable','integer','min:1'],
            'review'=>['nullable','in:failed,structure'],'review_from'=>['nullable','date'],'review_to'=>['nullable','date'],
            'review_ids'=>['sometimes','array','max:30'],'review_ids.*'=>['string','max:80'],'review_locate'=>['sometimes','boolean']]);
        $query = DB::table('system_audit')->orderByDesc('created_at')->orderByDesc('id');
        // Retain raw old synchronization checks in storage; they are not new business actions.
        $query->whereNotIn('action',['Imported 0 legacy browser records','POST api/import-browser']);
        $allRecords=clone $query;
        if (!empty($data['review'])) {
            $until=isset($data['review_to'])?\Carbon\CarbonImmutable::parse($data['review_to'])->utc():now()->toImmutable();
            $query->where('created_at','<=',$until);
            if ($data['review']==='failed') {
                $since=isset($data['review_from'])?\Carbon\CarbonImmutable::parse($data['review_from'])->utc():$until->subDay();
                $query->where('source','server')->where('created_at','>=',$since)
                    ->where(fn($q)=>$q->where('action','like','%failed%')->orWhere('action','Access denied')->orWhere('action','like','%blocked%'));
            } else {
                $ids=DB::table('system_audit')->where('created_at','<=',$until)->orderByDesc('created_at')->orderByDesc('id')->limit(1000)->get(['id','changes'])
                    ->filter(fn($entry)=>!is_array(json_decode($entry->changes,true)))->pluck('id')->all();
                $query->whereIn('id',$ids);
            }
        }
        if (!empty($data['category'])) $query->where('category',$data['category']);
        if (!empty($data['actor'])) $query->where('actor_name','like','%'.$data['actor'].'%');
        if (!empty($data['from'])) $query->where('created_at','>=',\Carbon\CarbonImmutable::parse($data['from'],'Asia/Manila')->utc());
        if (!empty($data['to'])) $query->where('created_at','<',\Carbon\CarbonImmutable::parse($data['to'],'Asia/Manila')->addDay()->utc());
        if (!empty($data['q'])) $query->where(fn($q)=>$q->where('action','like','%'.$data['q'].'%')->orWhere('target','like','%'.$data['q'].'%')->orWhere('actor_name','like','%'.$data['q'].'%'));
        if (!empty($data['review']) && isset($data['review_ids'])) $query->whereIn('id',$data['review_ids']);
        $page = $query->paginate(30); $page->getCollection()->transform(function($row){$changes=json_decode($row->changes,true);$row->changes=is_array($changes)?$changes:[];return $row;});
        $response=$page->toArray();
        if (!empty($data['review'])) {
            $response['reviewScope']=['kind'=>$data['review'],'from'=>$data['review']==='failed'?$since->toIso8601String():null,'to'=>$until->toIso8601String()];
            if (!empty($data['review_locate'])) {
                $first=(clone $query)->first();
                $response['reviewScope']['page']=$first?intdiv((clone $allRecords)->where(fn($q)=>$q->where('created_at','>',$first->created_at)->orWhere(fn($q)=>$q->where('created_at',$first->created_at)->where('id','>',$first->id)))->count(),30)+1:null;
            }
        }
        return response()->json($response);
    }
}
