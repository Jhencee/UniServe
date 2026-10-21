<?php
namespace App\Http\Controllers;
use App\Support\{StaffAuth,QueueData,SystemAudit};
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{DB,Crypt};
class LegacyImportController extends Controller {
 public function store(Request $r){
  $u=StaffAuth::user($r,'ADMIN');$d=$r->validate(['origin'=>'required|uuid','transactions'=>'array|max:1000','appointments'=>'array|max:1000','chats'=>'array|max:1000','queues'=>'array|max:1000','visitorLog'=>'array|max:1000']);
  $check=function($value)use(&$check){if(!is_array($value))return;foreach($value as $key=>$item){if($key==='dataUrl')abort_unless(is_string($item)&&strlen($item)<=7000000&&preg_match('~^data:(application/pdf|image/png|image/jpeg);base64,[A-Za-z0-9+/=]+$~',$item),422,'Legacy attachment needs a safe PDF or image format.');else $check($item);}};$check($d);
  $count=DB::transaction(function()use($d,$u){$count=0;$accepted=[];$mapping=[];
   foreach(['transactions'=>'T','appointments'=>'A','chats'=>'C','queues'=>'Q','visitorLog'=>'L'] as $type=>$prefix)foreach($d[$type]??[] as $record){abort_unless(isset($record['id'])&&is_string($record['id']),422);$mapping[$type][$record['id']]=$prefix.substr(hash('sha256',$d['origin'].':'.$type.':'.$record['id']),0,16);}
   foreach($d['queues']??[] as $q)if(!empty($q['visitId'])&&($existing=DB::table('queues')->where('visit_id',$q['visitId'])->first()))$mapping['queues'][$q['id']]=$existing->id;
   foreach(['transactions','appointments','chats','queues','visitorLog'] as $type)foreach($d[$type]??[] as $record){
    abort_unless(is_array($record)&&isset($record['id'])&&preg_match('/^[a-zA-Z0-9_-]{1,80}$/',$record['id']),422,'Invalid legacy record ID.');
    if(($record['shared']??false)||($record['restricted']??false))continue;
    // Incomplete browser snapshots are retained locally; they must not block valid imports.
    if($type==='queues'&&(!isset($record['visitId'],$record['visitorType'],$record['serviceLabel'])||!$record['visitId']||!$record['visitorType']||!$record['serviceLabel']))continue;
    if($type==='appointments'&&(!isset($record['visitId'],$record['email'],$record['service'])||!$record['visitId']||!$record['email']||!$record['service']))continue;
    if($type==='transactions'&&\App\Support\ServicePrivacy::confidential($record['service']??'')&&!$u->confidential_access)continue;
    $originalId=$record['id'];$record['id']=$mapping[$type][$originalId];foreach(['queueId'=>'queues','appointmentId'=>'appointments','transactionId'=>'transactions'] as $field=>$kind)if(isset($record[$field],$mapping[$kind][$record[$field]]))$record[$field]=$mapping[$kind][$record[$field]];
    $record['shared']=true;$record['imported']=true;$payload=Crypt::encryptString(json_encode($record));$base=['id'=>$record['id'],'payload'=>$payload,'created_at'=>now(),'updated_at'=>now()];
    if($type==='appointments'){
     abort_unless(isset($record['visitId'],$record['email'],$record['service']),422,'Legacy appointment is incomplete.');
     $svc=DB::table('service_catalog')->where('label',$record['service'])->first();abort_unless($svc,422,'Create the legacy service before importing its appointments.');
     $count+=DB::table('shared_appointments')->insertOrIgnore($base+['visit_id'=>$record['visitId'],'email'=>\App\Support\EmailIndex::key(strtolower($record['email'])),'service_key'=>$svc->key,'status'=>$record['status']??'Requested','date'=>$record['date']??null,'time'=>empty($record['time'])?null:\Carbon\CarbonImmutable::parse($record['time'])->format('H:i')]);
     if(!DB::table('shared_appointments')->where('id',$record['id'])->exists())continue;
    }elseif($type==='chats'){
     $count+=DB::table('shared_chats')->insertOrIgnore($base+['email'=>\App\Support\EmailIndex::key(strtolower($record['email']??'')),'status'=>$record['status']??'Open']);
    }elseif($type==='queues'){
     abort_unless(isset($record['visitId'],$record['visitorType'],$record['serviceLabel']),422,'Legacy queue entry is incomplete.');
     if(DB::table('queues')->where('visit_id',$record['visitId'])->exists()){$accepted[$type][]=$originalId;continue;}
     $count+=DB::table('queues')->insertOrIgnore(QueueData::index($record)+['id'=>$record['id'],'queue_number'=>'LEG-'.substr(hash('sha256',$record['id']),0,12),'prefix'=>'L','seq'=>0,'visitor_type'=>$record['visitorType'],'source'=>$record['source']??'Walk-in','status'=>$record['status']??'Waiting','service_label_text'=>$record['serviceLabel'],'portal_payload'=>QueueData::write($record)]);
    }else{
     $table=$type==='transactions'?'shared_transactions':'shared_visitor_log';$count+=DB::table($table)->insertOrIgnore($base+['queue_id'=>$record['queueId']??'legacy:'.$record['id']]);
     if(!DB::table($table)->where('id',$record['id'])->exists())continue;
     if($type==='transactions'&&\App\Support\ServicePrivacy::confidential($record['service']??''))DB::table('confidential_cases')->insertOrIgnore(['id'=>$record['id'],'code'=>$record['code']??$record['id'],'assigned_admin_id'=>$u->id,'created_at'=>now(),'updated_at'=>now()]);
    }
    $accepted[$type][]=$originalId;
   }
   foreach($d['appointments']??[] as $a)if(!empty($a['queueId'])){$queueId=$mapping['queues'][$a['queueId']]??$a['queueId'];if(DB::table('queues')->where('id',$queueId)->exists())DB::table('shared_appointments')->where('id',$mapping['appointments'][$a['id']])->update(['queue_id'=>$queueId]);}
   if($count)SystemAudit::record($u,'Data','Saved records synchronized',null,[['field'=>'Records added','from'=>'','to'=>(string)$count]]);
   request()->attributes->set('system_audit_recorded',true);
   return ['imported'=>$count,'accepted'=>$accepted,'mapping'=>$mapping];
  });return response()->json($count);
 }
}
