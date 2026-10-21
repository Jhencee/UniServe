<?php
namespace App\Support;
use Illuminate\Support\Facades\Crypt;
class PrivateNotification {
 public static function fields(string $recipient,string $subject,string $body):array{return ['recipient'=>EmailIndex::key($recipient),'subject'=>'Private appointment notification','body'=>Crypt::encryptString(json_encode(compact('recipient','subject','body')))];}
 public static function read(object $row):array {try{return json_decode(Crypt::decryptString($row->body),true);}catch(\Throwable $e){return ['recipient'=>$row->recipient,'subject'=>$row->subject,'body'=>$row->body];}}
}
