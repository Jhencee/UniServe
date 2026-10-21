<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

class SendVisitNotifications extends Command
{
    protected $signature = 'notifications:send';
    protected $description = 'Send pending appointment confirmations and reminders';
    public function handle(): int
    {
        if (config('mail.default') !== 'smtp' || !config('mail.mailers.smtp.username') || !config('mail.mailers.smtp.password')) {
            $this->warn('Configure Gmail SMTP credentials before sending notifications.'); return self::FAILURE;
        }
        DB::table('notification_outbox')->where('status','sending')->where('updated_at','<',now()->subMinutes(10))->update(['status'=>'pending','updated_at'=>now()]);
        $rows = DB::table('notification_outbox')->where('status','pending')->where('send_at','<=',now())->where('attempts','<',5)->orderBy('id')->limit(50)->get();
        foreach ($rows as $row) {
            $scheduled = \Carbon\CarbonImmutable::parse($row->scheduled_at, 'UTC')->setTimezone('Asia/Manila');
            if (!in_array($row->kind,['cancelled','calendar-change']) && ($scheduled->isPast() || !\App\Support\OfficeCalendar::status($scheduled)['open'])) {
                DB::table('notification_outbox')->where('id',$row->id)->where('status','pending')->update(['status'=>'paused','updated_at'=>now()]);
                \App\Support\SystemAudit::record((object)['id'=>null,'full_name'=>'System'],'Appointments','Appointment email paused',$row->visit_id,[['field'=>'Reason','from'=>'','to'=>$scheduled->isPast()?'Appointment time has passed':'Scheduled time is outside office hours']]);
                continue;
            }
            if (!DB::table('notification_outbox')->where('id',$row->id)->where('status','pending')->update(['status'=>'sending','attempts'=>$row->attempts+1,'updated_at'=>now()])) continue;
            try {
                $message=\App\Support\PrivateNotification::read($row);
                $message['subject']=match($row->kind){'calendar-change'=>'Appointment needs rescheduling','cancelled'=>'Appointment cancelled','reminder'=>'Appointment reminder','rescheduled'=>'Appointment rescheduled',default=>'Appointment confirmation'};
                $ticket=null;
                if(in_array($row->kind,['confirmation','rescheduled','reminder']) && \Illuminate\Support\Facades\Schema::hasTable('shared_appointments')){
                    $appointment=DB::table('shared_appointments')->where('visit_id',$row->visit_id)->first();
                    if($appointment){
                        $ticket=\App\Http\Controllers\AppointmentController::present($appointment);
                        // The notification carries the exact schedule being delivered.
                        $ticket['date']=$scheduled->format('Y-m-d');
                        $ticket['time']=$scheduled->format('H:i');
                        $ticket['source']='Appointment';
                        $ticket['status']='Booked';
                        unset($ticket['attachments']);
                    }
                }
                \App\Support\OfficeMail::send($message['recipient'],$message['subject'],$message['body'],null,$ticket);
                DB::table('notification_outbox')->where('id',$row->id)->update(['status'=>'sent','sent_at'=>now(),'last_error'=>null,'updated_at'=>now()]);
                \App\Support\SystemAudit::record((object)['id'=>null,'full_name'=>'System'],'Appointments','Appointment email sent',$row->visit_id,[['field'=>'Email type','from'=>'','to'=>$row->kind]]);
            } catch (\Throwable $e) {
                DB::table('notification_outbox')->where('id',$row->id)->update(['status'=>$row->attempts >= 4 ? 'failed' : 'pending','last_error'=>'Mail transport failed. Check SMTP configuration.','updated_at'=>now()]);
                \App\Support\SystemAudit::record((object)['id'=>null,'full_name'=>'System'],'Appointments','Appointment email delivery failed',$row->visit_id,[['field'=>'Email type','from'=>'','to'=>$row->kind]]);
            }
        }
        return self::SUCCESS;
    }
}
