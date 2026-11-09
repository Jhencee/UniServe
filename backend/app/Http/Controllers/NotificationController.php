<?php

namespace App\Http\Controllers;

use App\Support\StaffAuth;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class NotificationController extends Controller
{
    public function store(Request $request)
    {
        $actor = StaffAuth::user($request,'ADMIN');
        $data = $request->validate(['visitId'=>['required','string','max:80'], 'email'=>['required','email','max:120'],
            'name'=>['required','string','max:150'],'service'=>['required','string','max:150'],
            'date'=>['required','date_format:Y-m-d'],'time'=>['required','date_format:H:i'],
            'kind'=>['required','in:confirmation,rescheduled,reminder']]);
        $scheduled = CarbonImmutable::parse($data['date'].' '.$data['time'],'Asia/Manila');
        if(\Illuminate\Support\Facades\Schema::hasTable('shared_appointments')){
            $row=DB::table('shared_appointments')->where('visit_id',$data['visitId'])->first();abort_unless($row,404,'Appointment not found.');
            (new AppointmentController)->access($request,$row);
            $a=AppointmentController::present($row);
            abort_unless($row->status==='Booked'&&$row->date===$data['date']&&$row->time===$data['time']&&$a['email']===$data['email'],409,'Refresh the appointment before sending its pass.');
            $data['name']=$a['name'];$data['service']=$a['service'];$data['office']=$a['office']??'Office of Student Services';
        }
        abort_unless($scheduled->isFuture(),422,'Choose an upcoming appointment time.');
        $calendar = \App\Support\OfficeCalendar::status($scheduled);
        abort_unless($calendar['open'],422,'The appointment falls outside available calendar hours.');
        $snapshot = $data['visitId'].'|'.$scheduled->toIso8601String().'|'.strtolower($data['email']).'|'.($row->revision??0);
        $settings=\Illuminate\Support\Facades\Schema::hasTable('shared_system_settings')?json_decode(DB::table('shared_system_settings')->where('id',1)->value('payload'),true):[];
        $grace=(int)($settings['gracePeriodMinutes']??15);$threshold=(int)($settings['noShowThresholdMinutes']??60);
        $rules=[
            'Arrive on time and bring the required documents and your Visit ID.',
            'Present your Visit ID at the OSS counter. An Admin will check you in; having a booked appointment alone does not add you to the waiting queue.',
            $grace>0&&$grace<$threshold?'If you are more than '.$grace.' minutes late, speak with OSS staff so they can review your arrival.':'If you arrive late, speak with OSS staff so they can review your arrival.',
            'If you have not been checked in '.$threshold.' minutes after your scheduled time, your appointment may be marked as a no-show. Contact OSS to arrange a new schedule.',
            'If you cannot attend, cancel through Check My Visit before check-in, or contact OSS to request rescheduling.',
        ];
        $queued=DB::transaction(function() use($data,$actor,$scheduled,$snapshot,$rules) {
            $count=0;
            DB::table('notification_outbox')->where('visit_id',$data['visitId'])->whereIn('status',['pending','paused'])->where(fn($q)=>$q->where('scheduled_at','!=',$scheduled->utc())->orWhere('recipient','!=',\App\Support\EmailIndex::key($data['email'])))->update(['status'=>'superseded','updated_at'=>now()]);
            foreach ([$data['kind'], 'reminder'] as $kind) {
                $sendAt = $kind === 'reminder' ? $scheduled->subDay() : CarbonImmutable::now();
                if ($kind === 'reminder' && $sendAt->isPast()) continue;
                $subject = match($kind){'reminder'=>'Appointment reminder','rescheduled'=>'Appointment rescheduled',default=>'Appointment confirmation'};
                $body = 'Hi '.$data['name'].",\n\nYour appointment ".($kind==='rescheduled'?'has been rescheduled.':($kind==='reminder'?'is coming up.':'is confirmed.'))."\n\nOffice: ".($data['office']??'Office of Student Services')."\nService: ".$data['service']."\nDate: ".$scheduled->format('l, F j, Y')."\nTime: ".$scheduled->format('g:i A')."\nVisit ID: ".$data['visitId']."\n\nBring your required documents and show your Visit ID at the OSS counter. An Admin will check you in when you arrive.\n\nOffice of Student Services";
                $body=str_replace("\n\nOffice of Student Services","\n\nArrival guidelines\n".implode("\n",$rules)."\n\nOffice of Student Services",$body);
                $count+=DB::table('notification_outbox')->insertOrIgnore(\App\Support\PrivateNotification::fields($data['email'],$subject,$body)+['visit_id'=>$data['visitId'],
                    'scheduled_at'=>$scheduled->utc(),'send_at'=>$sendAt->utc(),'kind'=>$kind,'dedup_key'=>hash('sha256',$snapshot.'|'.$kind),'actor_id'=>$actor->id,'created_at'=>now(),'updated_at'=>now()]);
                $count+=DB::table('notification_outbox')->where('dedup_key',hash('sha256',$snapshot.'|'.$kind))->where('status','failed')->update(['status'=>'pending','attempts'=>0,'last_error'=>null,'updated_at'=>now()]);
            }
            return $count;
        });
        if($queued)\App\Support\SystemAudit::record($actor,'Appointments','Appointment emails queued',$data['visitId'],[['field'=>'Emails','from'=>'','to'=>(string)$queued]]);
        $request->attributes->set('system_audit_recorded',true);
        if(config('mail.default')==='smtp'&&config('mail.mailers.smtp.username')&&config('mail.mailers.smtp.password'))\App\Jobs\DeliverAppointmentNotifications::dispatch();
        $token=\Illuminate\Support\Facades\Crypt::encryptString(json_encode(['visitId'=>$data['visitId'],'expires'=>$scheduled->addDays(30)->timestamp,'purpose'=>'cancel-notifications']));
        return response()->json(['queued'=>true,'cancelToken'=>$token,'mailConfigured'=>config('mail.default') === 'smtp' && !empty(config('mail.mailers.smtp.username')) && !empty(config('mail.mailers.smtp.password'))],202);
    }
    public function index(Request $request)
    {
        StaffAuth::user($request,'ADMIN');
        $data = $request->validate(['visitId'=>['required','string','max:80']]);
        $row=DB::table('shared_appointments')->where('visit_id',$data['visitId'])->first();
        abort_unless($row,404,'Appointment not found.');
        (new AppointmentController)->access($request,$row);
        return response()->json(['notifications'=>DB::table('notification_outbox')->where('visit_id',$data['visitId'])->orderByDesc('id')->get(['id','kind','status','send_at','sent_at','attempts'])]);
    }
    public function cancel(Request $request)
    {
        StaffAuth::user($request,'ADMIN');
        $data = $request->validate(['visitId'=>['required','string','max:80']]);
        $row=DB::table('shared_appointments')->where('visit_id',$data['visitId'])->first();
        abort_unless($row,404,'Appointment not found.');
        (new AppointmentController)->access($request,$row);
        $count = DB::table('notification_outbox')->where('visit_id',$data['visitId'])->whereIn('status',['pending','paused','failed'])->update(['status'=>'cancelled','updated_at'=>now()]);
        return response()->json(['cancelled'=>$count]);
    }
    public function cancelToken(Request $request)
    {
        $data=$request->validate(['token'=>['required','string','max:5000']]);
        try{$payload=json_decode(\Illuminate\Support\Facades\Crypt::decryptString($data['token']),true,512,JSON_THROW_ON_ERROR);}catch(\Throwable $e){abort(403,'Invalid cancellation token.');}
        abort_unless(($payload['purpose']??'')==='cancel-notifications' && ($payload['expires']??0)>time(),403,'Cancellation token expired.');
        $count=DB::table('notification_outbox')->where('visit_id',$payload['visitId'])->whereIn('status',['pending','paused','failed'])->update(['status'=>'cancelled','updated_at'=>now()]);
        return response()->json(['cancelled'=>$count]);
    }
}
