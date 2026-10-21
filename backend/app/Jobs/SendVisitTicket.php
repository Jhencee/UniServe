<?php
namespace App\Jobs;

use Illuminate\Contracts\Queue\{ShouldQueue,ShouldBeEncrypted};
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Mail;

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
        $html=view('emails.visit-ticket',['ticket'=>$this->ticket])->render();
        Mail::html($html,function($mail)use($html){
            $logo=$mail->embed(resource_path('images/pup.jpg'));
            $mail->html(str_replace('cid:uniserve-pup',$logo,$html))
                ->to($this->ticket['email'])->subject('Your UniServe ticket · '.$this->ticket['visitId']);
        });
    }
}
