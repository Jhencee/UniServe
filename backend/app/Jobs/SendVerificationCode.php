<?php
namespace App\Jobs;

use Illuminate\Contracts\Queue\{ShouldQueue,ShouldBeEncrypted};
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\{Cache,Mail};
use App\Support\OfficeMail;

class SendVerificationCode implements ShouldQueue,ShouldBeEncrypted
{
    use Queueable;
    public int $tries=2;
    public int $timeout=30;
    public function __construct(public string $challengeId,public string $email,public string $code){$this->onQueue('mail-verification');}
    public function handle():void
    {
        $challenge=Cache::get('history-code:'.$this->challengeId);
        if(!$challenge||$challenge['expiresAt']<=time())return;
        OfficeMail::send($this->email,'Verification code','Use this code to securely access your UniServe visits and conversations.',$this->code);
        \App\Support\SystemAudit::record((object)['id'=>null,'full_name'=>'System'],'Authentication','Verification email sent');
    }
    public function failed(?\Throwable $exception):void {Cache::forget('history-code:'.$this->challengeId);Cache::forget('history-cooldown:'.hash('sha256',$this->email));\App\Support\SystemAudit::record((object)['id'=>null,'full_name'=>'System'],'Authentication','Verification email delivery failed');}
}
