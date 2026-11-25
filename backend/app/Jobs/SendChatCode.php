<?php
namespace App\Jobs;

use Illuminate\Contracts\Queue\{ShouldQueue, ShouldBeEncrypted};
use Illuminate\Foundation\Queue\Queueable;
use App\Support\OfficeMail;

class SendChatCode implements ShouldQueue, ShouldBeEncrypted
{
    use Queueable;
    public int $tries = 3;
    public int $timeout = 30;
    public function __construct(public string $email, public string $code) { $this->onQueue('mail-verification'); }
    public function handle(): void { OfficeMail::send($this->email, 'Your UniServe chat code', 'Use this code to return to your conversation.', $this->code, 'Keep this code private. It does not expire and can be used to reopen your chat. It will stop working if the admin deletes the conversation.'); }
}
