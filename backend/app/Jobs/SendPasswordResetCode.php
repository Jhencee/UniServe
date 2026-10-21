<?php
namespace App\Jobs;
use Illuminate\Contracts\Queue\{ShouldQueue,ShouldBeEncrypted};
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Cache;
class SendPasswordResetCode implements ShouldQueue,ShouldBeEncrypted {
 use Queueable;
 public int $tries=2; public int $timeout=30;
 public function __construct(public string $id,public string $email,public string $code){$this->onQueue('mail-verification');}
 public function handle():void { $c=Cache::get('staff-reset:'.$this->id);if(!$c||$c['expires']<=time())return;\App\Support\OfficeMail::send($this->email,'Password reset code','Use this code to reset your staff account password. If you did not request a reset, ignore this email.',$this->code); }
 public function failed(?\Throwable $e):void {Cache::forget('staff-reset:'.$this->id);}
}
