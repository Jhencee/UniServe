<?php
namespace App\Support;

use Illuminate\Support\Facades\{Cache, DB};

class NotificationRetry
{
    public static function schedule(): void
    {
        // Serverless sync delivery has no worker to revisit a failed SMTP attempt.
        if(config('queue.default')!=='sync'||config('mail.default')!=='smtp'
            ||!config('mail.mailers.smtp.username')||!config('mail.mailers.smtp.password'))return;
        if(!Cache::add('notifications:staff-retry',true,60))return;
        $due=DB::table('notification_outbox')->where('send_at','<=',now())
            ->where('attempts','<',5)->where(function($query){
                $query->where('status','pending')->orWhere(function($query){
                    $query->where('status','sending')->where('updated_at','<',now()->subMinutes(10));
                });
            })->exists();
        if($due)\App\Jobs\DeliverAppointmentNotifications::dispatchAfterResponse(1);
    }
}
