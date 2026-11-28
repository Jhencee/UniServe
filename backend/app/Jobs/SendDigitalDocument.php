<?php
namespace App\Jobs;

use App\Support\{OfficeMail,QueueData,SystemAudit};
use Illuminate\Contracts\Queue\{ShouldQueue,ShouldBeEncrypted};
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\{Crypt,DB,Mail};

class SendDigitalDocument implements ShouldQueue,ShouldBeEncrypted
{
 use Queueable;
 public int $tries=3;
 public int $timeout=60;
 public function __construct(public string $transactionId,public string $queueId,public string $email,public string $name,public string $mime,public string $content){$this->onQueue('mail-verification');}
 public function handle():void {
  $row=DB::table('shared_transactions')->where('id',$this->transactionId)->first();if(!$row)return;
  $record=json_decode(Crypt::decryptString($row->payload),true);
  if(($record['deliveryFormat']??'')!=='digital'||($record['digitalDeliveryStatus']??'')!=='Queued')return;
  $html=OfficeMail::html('Your requested document','Your requested document is attached. Contact OSS if you have questions.');
  Mail::html($html,function($mail){$mail->to($this->email)->subject('Your requested document')->attachData(base64_decode($this->content,true),$this->name,['mime'=>$this->mime]);});
  $this->updateStatus('Sent');
 }
 public function failed(?\Throwable $error):void {$this->updateStatus('Failed');}
 private function updateStatus(string $status):void {
  DB::transaction(function()use($status){
   $row=DB::table('shared_transactions')->where('id',$this->transactionId)->lockForUpdate()->first();$queue=DB::table('queues')->where('id',$this->queueId)->lockForUpdate()->first();if(!$row||!$queue)return;
   $record=json_decode(Crypt::decryptString($row->payload),true);$q=QueueData::read($queue->portal_payload);
   if(($record['digitalDeliveryStatus']??'')!=='Queued')return;
   $record['digitalDeliveryStatus']=$q['digitalDeliveryStatus']=$status;
   if($status==='Sent')$record['digitalDeliverySentAt']=$q['digitalDeliverySentAt']=now()->toIso8601String();
   if($status==='Failed')$record['digitalDeliveryFailedAt']=$q['digitalDeliveryFailedAt']=now()->toIso8601String();
   DB::table('shared_transactions')->where('id',$row->id)->update(['payload'=>Crypt::encryptString(json_encode($record)),'updated_at'=>now()]);
   DB::table('queues')->where('id',$queue->id)->update(['portal_payload'=>QueueData::write($q)]);
   SystemAudit::record((object)['id'=>null,'full_name'=>'System'],'Transactions','Digital document delivery '.$status,$q['visitId']??null);
  });
 }
}
