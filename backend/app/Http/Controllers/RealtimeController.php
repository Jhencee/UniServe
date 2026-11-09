<?php
namespace App\Http\Controllers;
use App\Support\{StaffAuth,VisitorAccess,QueueData,EmailIndex};
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{DB,Crypt};
class RealtimeController extends Controller
{
 public function config(){return response()->json(['enabled'=>config('broadcasting.default')==='reverb','key'=>config('broadcasting.connections.reverb.key'),'port'=>(int)config('reverb.public.port',8080),'scheme'=>config('reverb.public.scheme','ws')]);}
 public function auth(Request $r){
  $d=$r->validate(['socket_id'=>'required|regex:/^\d+\.\d+$/','channel_name'=>'required|string|max:160']);$channel=$d['channel_name'];
  if($channel==='private-head-admin'){$u=StaffAuth::user($r,'ADMIN');abort_unless($u->confidential_approver??false,403,'Head Admin access required.');}
  elseif(str_starts_with($channel,'private-admin-')){$u=StaffAuth::user($r,'ADMIN');abort_unless($channel==='private-admin-'.$u->id,403);}
  elseif($channel==='private-office')StaffAuth::user($r);
  elseif(str_starts_with($channel,'private-chat-')){
   $id=substr($channel,13);$row=DB::table('shared_chats')->where('id',$id)->first();abort_unless($row,404);
   if($r->header('X-Chat-Token')){try{$token=json_decode(Crypt::decryptString($r->header('X-Chat-Token')),true);}catch(\Throwable $e){abort(401);}abort_unless(($token['purpose']??'')==='chat'&&($token['id']??'')===$id&&($token['expires']??0)>time(),401);}
   else abort_unless(EmailIndex::key(VisitorAccess::email($r))===$row->email,403);
  }elseif(str_starts_with($channel,'private-visit-')){
   $id=substr($channel,14);$row=DB::table('queues')->where('visit_id',$id)->first();
   if($row)VisitorAccess::ownsQueue($r,QueueData::read($row->portal_payload));
   else{$appointment=DB::table('shared_appointments')->where(fn($q)=>$q->where('visit_id',$id)->orWhere('id',$id))->first();abort_unless($appointment,404);abort_unless(EmailIndex::key(VisitorAccess::email($r))===$appointment->email,403);}
  }else abort(403);
  $key=config('broadcasting.connections.reverb.key');$secret=config('broadcasting.connections.reverb.secret');abort_unless($key&&$secret,503);
  return response()->json(['auth'=>$key.':'.hash_hmac('sha256',$d['socket_id'].':'.$channel,$secret)]);
 }
}
