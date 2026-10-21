<?php
namespace App\Support;
use Illuminate\Support\Facades\{Crypt,Schema};
class QueueData {
 public static function forStaff(array $q,object $u):array {
  if(!\App\Support\ServicePrivacy::confidential($q['serviceKey']??''))return $q;
  $allowed=$u->confidential_access??false;
  if(!empty($q['transactionId'])){
   $case=\Illuminate\Support\Facades\DB::table('confidential_cases')->where('id',$q['transactionId'])->first();
   $grant=\Illuminate\Support\Facades\DB::table('confidential_requests')->where('case_id',$q['transactionId'])->where('requester_id',$u->id)->where('status','Approved')->where('expires_at','>',now())->exists();
   $allowed=(($u->confidential_approver??false)||($case->assigned_admin_id??null)===$u->id||$grant)&&\Illuminate\Support\Facades\Cache::get('conf-unlock:'.$u->id.':'.$q['transactionId'].':view');
  }else $allowed=$allowed&&($q['assignedAdminId']??null)===$u->id;
  if(!$allowed){foreach(['email','contact','idNumber','attachments','feedback'] as $field)unset($q[$field]);$q['name']='Restricted record';$q['restricted']=true;}
  return $q;
 }
 public static function read(?string $value):array {if(!$value)return [];$data=json_decode($value,true)??[];return isset($data['_encrypted'])?json_decode(Crypt::decryptString($data['_encrypted']),true):$data;}
 public static function write(array $q):string{return Schema::hasColumn('queues','visit_id')?json_encode(['_encrypted'=>Crypt::encryptString(json_encode($q))]):json_encode($q);}
 public static function index(array $q):array{return Schema::hasColumn('queues','visit_id')?['visit_id'=>$q['visitId']??null,'email_hash'=>\App\Support\EmailIndex::key(strtolower($q['email']??''))]:[];}
}
