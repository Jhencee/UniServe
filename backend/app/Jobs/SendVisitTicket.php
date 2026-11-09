<?php
namespace App\Jobs;

use Illuminate\Contracts\Queue\{ShouldQueue,ShouldBeEncrypted};
use Illuminate\Foundation\Queue\Queueable;

class SendVisitTicket implements ShouldQueue, ShouldBeEncrypted
{
    use Queueable;
    public int $tries=3;
    public int $timeout=30;

    public function __construct(public array $ticket)
    {
        $this->onQueue('mail-verification');
        $this->afterCommit();
    }

    public function handle(): void
    {
        // Retired: discard already queued ticket emails after this change.
        // Appointment updates are delivered through OfficeMail instead.
    }
}
