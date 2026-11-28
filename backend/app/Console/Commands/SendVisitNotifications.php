<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;

class SendVisitNotifications extends Command
{
    protected $signature = 'notifications:send {--limit=50 : Maximum messages to process}';
    protected $description = 'Send pending visit and document notifications';
    public function handle(): int
    {
        \App\Support\VisitProcess::queueFollowUpReminders();
        if (config('mail.default') !== 'smtp' || !config('mail.mailers.smtp.username') || !config('mail.mailers.smtp.password')) {
            $this->warn('Configure Gmail SMTP credentials before sending notifications.'); return self::FAILURE;
        }
        DB::table('notification_outbox')->where('status','sending')->where('updated_at','<',now()->subMinutes(10))->update(['status'=>'pending','updated_at'=>now()]);
        // Pickup notices do not depend on an appointment time and should not remain paused.
        DB::table('notification_outbox')->where('kind','document-ready')->where('status','paused')->update(['status'=>'pending','updated_at'=>now()]);
        $limit=max(1,min(50,(int)$this->option('limit')));
        $rows = DB::table('notification_outbox')->where('status','pending')->where('send_at','<=',now())->where('attempts','<',5)->orderBy('id')->limit($limit)->get();
        foreach ($rows as $row) {
            $scheduled = \Carbon\CarbonImmutable::parse($row->scheduled_at, 'UTC')->setTimezone('Asia/Manila');
            if (!in_array($row->kind,['cancelled','calendar-change','request-expired','document-correction','follow-up-task','follow-up-reminder','document-ready','pickup-ready','feedback-required','request-received','no-show','no-show-corrected']) && ($scheduled->isPast() || !\App\Support\OfficeCalendar::status($scheduled)['open'])) {
                DB::table('notification_outbox')->where('id',$row->id)->where('status','pending')->update(['status'=>'paused','updated_at'=>now()]);
                \App\Support\SystemAudit::record((object)['id'=>null,'full_name'=>'System'],'Appointments','Appointment email paused',$row->visit_id,[['field'=>'Reason','from'=>'','to'=>$scheduled->isPast()?'Appointment time has passed':'Scheduled time is outside office hours']]);
                continue;
            }
            if (!DB::table('notification_outbox')->where('id',$row->id)->where('status','pending')->update(['status'=>'sending','attempts'=>$row->attempts+1,'updated_at'=>now()])) continue;
            try {
                $message=\App\Support\PrivateNotification::read($row);
                $message['subject']=match($row->kind){'calendar-change'=>'Appointment needs rescheduling','cancelled'=>'Appointment cancelled','reminder'=>'Appointment reminder','rescheduled'=>'Appointment rescheduled','request-expired'=>'Appointment request needs rescheduling','request-received'=>'Appointment request received','document-correction'=>'Document correction required','follow-up-task'=>'Follow-up action updated','follow-up-reminder'=>'Follow-up action reminder','document-ready'=>'Document ready - choose delivery','pickup-ready'=>'Hard copy ready for pickup','feedback-required'=>'Feedback requested','no-show'=>'Missed appointment - request a new schedule','no-show-corrected'=>'Missed appointment record corrected',default=>'Appointment confirmation'};
                if($row->kind==='follow-up-reminder'){
                    $appointment=DB::table('shared_appointments')->where('visit_id',$row->visit_id)->first();
                    $data=$appointment?json_decode(\Illuminate\Support\Facades\Crypt::decryptString($appointment->payload),true):[];
                    $tasks=$data['followUpTasks']??(empty($data['followUpTask'])?[]:[$data['followUpTask']+['id'=>'legacy']]);
                    $due=\Carbon\CarbonImmutable::now('Asia/Manila')->addDay()->toDateString();
                    $valid=$appointment&&$appointment->status!=='Cancelled'&&collect($tasks)->contains(fn($task)=>empty($task['completed'])&&($task['dueDate']??null)===$due&&hash_equals($row->dedup_key,\App\Support\VisitProcess::followUpReminderKey($appointment->id,(string)($task['id']??'legacy'),$due)));
                    if(!$valid){DB::table('notification_outbox')->where('id',$row->id)->update(['status'=>'superseded','updated_at'=>now()]);continue;}
                }
                if($row->kind==='no-show'){
                    $appointment=DB::table('shared_appointments')->where('visit_id',$row->visit_id)->first();
                    $data=$appointment?json_decode(\Illuminate\Support\Facades\Crypt::decryptString($appointment->payload),true):[];
                    if(!$appointment||$appointment->status!=='No-show'||!hash_equals($row->dedup_key,hash('sha256','no-show|'.$appointment->id.'|'.($data['noShowNotificationRevision']??'')))){DB::table('notification_outbox')->where('id',$row->id)->update(['status'=>'superseded','updated_at'=>now()]);continue;}
                }
                if($row->kind==='feedback-required'){
                    $queue=DB::table('queues')->where('visit_id',$row->visit_id)->first();
                    $visit=$queue?\App\Support\QueueData::read($queue->portal_payload):[];
                    if(!$queue||$queue->status!=='Completed'||!empty($visit['feedback'])){DB::table('notification_outbox')->where('id',$row->id)->update(['status'=>'superseded','updated_at'=>now()]);continue;}
                    $message['body']='Your visit is complete. Please open Visit History in UniServe and share your feedback about your visit. Reference: '.$row->visit_id;
                }
                if(in_array($row->kind,['document-ready','pickup-ready'])){
                    $queue=DB::table('queues')->where('visit_id',$row->visit_id)->first();
                    $visit=$queue?\App\Support\QueueData::read($queue->portal_payload):[];
                    if(!$queue||($visit['pickupStatus']??'')!=='Ready'||($row->kind==='pickup-ready'&&($visit['deliveryFormat']??'')!=='hard')||($row->kind==='document-ready'&&($visit['deliveryFormat']??'')==='digital')){
                        DB::table('notification_outbox')->where('id',$row->id)->update(['status'=>'superseded','updated_at'=>now()]);continue;
                    }
                    if(($visit['deliveryFormat']??'')==='hard'){
                        $greeting=trim((string)($visit['name']??''));$message['subject']='Hard copy ready for pickup';
                        $message['body']=($greeting!==''?'Hi '.$greeting.',':'Hello,')."\n\nYour hard copy is ready for pickup at OSS. Open Check My Visit using your Visit ID and join the pickup queue before coming. Bring your Visit ID and a valid ID.\n\nVisit ID: ".$row->visit_id."\n\nOffice of Student Services";
                    }
                }
                if(in_array($row->kind,['confirmation','rescheduled','reminder']) && \Illuminate\Support\Facades\Schema::hasTable('shared_appointments')){
                    $appointment=DB::table('shared_appointments')->where('visit_id',$row->visit_id)->first();
                    if(!$appointment || $appointment->status!=='Booked' || $appointment->date!==$scheduled->format('Y-m-d') || $appointment->time!==$scheduled->format('H:i')){
                        DB::table('notification_outbox')->where('id',$row->id)->update(['status'=>'superseded','updated_at'=>now()]);
                        continue;
                    }

                }
                \App\Support\OfficeMail::send($message['recipient'],$message['subject'],$message['body']);
                DB::table('notification_outbox')->where('id',$row->id)->update(['status'=>'sent','sent_at'=>now(),'last_error'=>null,'updated_at'=>now()]);
                $category=match($row->kind){'document-ready','pickup-ready'=>'Transactions','feedback-required'=>'Feedback',default=>'Appointments'};
                $action=match($row->kind){'document-ready','pickup-ready'=>'Document pickup email sent','feedback-required'=>'Feedback reminder sent',default=>'Appointment email sent'};
                \App\Support\SystemAudit::record((object)['id'=>null,'full_name'=>'System'],$category,$action,$row->visit_id,[['field'=>'Email type','from'=>'','to'=>$row->kind]]);
            } catch (\Throwable $e) {
                DB::table('notification_outbox')->where('id',$row->id)->update(['status'=>$row->attempts >= 4 ? 'failed' : 'pending','last_error'=>'Mail transport failed. Check SMTP configuration.','updated_at'=>now()]);
                $category=match($row->kind){'document-ready','pickup-ready'=>'Transactions','feedback-required'=>'Feedback',default=>'Appointments'};
                $action=match($row->kind){'document-ready','pickup-ready'=>'Document pickup email delivery failed','feedback-required'=>'Feedback reminder delivery failed',default=>'Appointment email delivery failed'};
                \App\Support\SystemAudit::record((object)['id'=>null,'full_name'=>'System'],$category,$action,$row->visit_id,[['field'=>'Email type','from'=>'','to'=>$row->kind]]);
            }
        }
        return self::SUCCESS;
    }
}
