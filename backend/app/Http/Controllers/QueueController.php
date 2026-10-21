<?php

namespace App\Http\Controllers;

use App\Support\StaffAuth;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class QueueController extends Controller
{
    public function callNext(Request $r){
        $actor=StaffAuth::user($r,'ADMIN');\App\Support\QueueDayClosure::run();\App\Support\Availability::requireOpen();
        $queue=DB::transaction(function()use($actor){
            \App\Support\VisitFlow::requireCounter($actor);
            $rows=DB::table('queues')->where('status','Waiting')->lockForUpdate()->get()->map(fn($row)=>\App\Support\QueueData::read($row->portal_payload))->filter(fn($q)=>!\App\Support\ServicePrivacy::confidential($q['serviceKey']??'')||($actor->confidential_access??false))->filter(fn($q)=>($q['source']??'')!=='Appointment'||empty($q['scheduledAt'])||!\Carbon\CarbonImmutable::parse($q['scheduledAt'])->isFuture())->all();
            usort($rows,function($a,$b){$key=fn($q)=>[empty($q['isSenior'])&&empty($q['isPWD'])?1:0,($q['source']??'')==='Appointment'?0:1,$q['queueEnteredAt']??$q['scheduledAt']??$q['createdAt']];return $key($a)<=>$key($b);});
            abort_unless(count($rows),409,'No visit is ready to be called.');$q=$rows[0];$q['status']='Called';$q['calledAt']=now()->toIso8601String();$q['assignedAdminId']=$actor->id;$q['assignedAdminName']=$actor->full_name;
            DB::table('queues')->where('id',$q['id'])->update(['status'=>'Called','assigned_admin_id'=>$actor->id,'assigned_admin_name'=>$actor->full_name,'called_at'=>now(),'portal_payload'=>\App\Support\QueueData::write($q)]);
            \App\Support\SystemAudit::record($actor,'Queue','Called next visitor',$q['visitId']);return $q;
        });return response()->json(['queue'=>$queue]);
    }
    public function create(Request $request)
    {
        $request->merge(['contact'=>\App\Support\PhilippineContact::normalize($request->input('contact','')),'email'=>strtolower(trim((string)$request->input('email','')))]);
        $data = $request->validate([
            'visitorType' => ['required', 'in:Student,Guest'],
            'serviceKey' => ['required', 'string', 'max:50'],
            'serviceLabel' => ['required', 'string', 'max:150'],
            'name' => ['required', 'string', 'max:150'],
            'idNumber' => ['nullable', 'string', 'max:50'],
            'idType' => ['nullable', 'string', 'max:100'],
            'guestClass' => ['nullable', 'string', 'max:100'],
            'contact' => ['required', 'regex:/^09[0-9]{9}$/'],
            'email' => ['required', 'email', 'max:120', 'regex:/@gmail\.com$/i'],
            'isSenior' => ['boolean'], 'isPWD' => ['boolean'], 'possibleDuplicate' => ['boolean'],
        ]);
        \App\Support\VisitorAccess::requireEmail($request,$data['email']);
        if(\Illuminate\Support\Facades\Schema::hasTable('service_catalog')){ $service=DB::table('service_catalog')->where('key',$data['serviceKey'])->first();abort_unless($service,422,'Unknown service.');$data['serviceLabel']=$service->label;}
        $queue = DB::transaction(function () use ($data) {
            $calendar = DB::table('office_calendar')->where('id', 1)->lockForUpdate()->first();
            $availability = \App\Support\OfficeCalendar::status(null, json_decode($calendar->payload, true));
            if (!$availability['open']) {
                throw new \Illuminate\Http\Exceptions\HttpResponseException(response()->json(['message' => $availability['reason'], 'availability' => $availability], 409));
            }
            \App\Support\Availability::requireOpen();
            $capacity=\App\Support\WalkInCapacity::status();abort_unless($capacity['accepting'],409,$capacity['message']);
            $settings=\Illuminate\Support\Facades\Schema::hasTable('shared_system_settings')?json_decode(DB::table('shared_system_settings')->where('id',1)->value('payload'),true):[];
            $prefix = $data['visitorType'] === 'Student' ? ($settings['queuePrefixStudent']??'A') : ($settings['queuePrefixGuest']??'G');
            $day = now('Asia/Manila')->toDateString();
            DB::table('queue_counters')->insertOrIgnore(['day_key' => $day, 'prefix' => $prefix, 'last_seq' => 0]);
            $counter = DB::table('queue_counters')->where('day_key', $day)->where('prefix', $prefix)->lockForUpdate()->first();
            $seq = $counter->last_seq + 1;
            do {
                $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
                $visitId = 'VIS-';
                foreach (str_split(random_bytes(8)) as $byte) $visitId .= $alphabet[ord($byte) % strlen($alphabet)];
                $legacyId = substr($visitId,0,8).'-'.substr($visitId,8);
            } while (DB::table('queues')->whereIn(\Illuminate\Support\Facades\Schema::hasColumn('queues','visit_id')?'visit_id':'portal_payload->visitId',[$visitId,$legacyId])->exists());
            DB::table('queue_counters')->where('day_key', $day)->where('prefix', $prefix)->update(['last_seq' => $seq]);
            $queue = $data + ['id' => 'Q'.bin2hex(random_bytes(8)), 'visitId' => $visitId,
                'number' => $prefix.'-'.str_pad($seq, 3, '0', STR_PAD_LEFT), 'prefix' => $prefix, 'seq' => $seq,
                'source' => 'Walk-in', 'status' => 'Waiting', 'createdAt' => now()->toIso8601String(),
                'checkedInAt' => now()->toIso8601String(), 'assignedAdminId' => null, 'assignedAdminName' => null,
                'calledAt' => null, 'servingAt' => null, 'completedAt' => null, 'recallCount' => 0, 'shared' => true];
            DB::table('queues')->insert(\App\Support\QueueData::index($queue) + [
                'id' => $queue['id'], 'queue_number' => $queue['number'], 'prefix' => $prefix, 'seq' => $seq,
                'visitor_type' => $data['visitorType'], 'service_label_text' => $data['serviceLabel'],
                'visitor_name' => null, 'id_number' => null, 'contact' => null,
                'source' => 'Walk-in', 'status' => 'Waiting', 'portal_payload' => \App\Support\QueueData::write($queue),
            ]);
            \App\Jobs\SendVisitTicket::dispatch($queue);
            return $queue;
        });
        $token=\Illuminate\Support\Facades\Crypt::encryptString(json_encode(['purpose'=>'visit','visitId'=>$queue['visitId'],'expires'=>time()+3600]));
        return response()->json(['queue' => $queue,'visitToken'=>$token], 201);
    }

    public function index(Request $request)
    {
        $actor=StaffAuth::user($request, 'ADMIN');\App\Support\QueueDayClosure::run();
        return response()->json(['queues' => DB::table('queues')->whereNotNull('portal_payload')->orderBy('created_at')->get()
            ->map(fn ($row) => \App\Support\QueueData::forStaff(\App\Support\QueueData::read($row->portal_payload),$actor))]);
    }

    public function visit(Request $request,string $visitId)
    {
        \App\Support\QueueDayClosure::run();
        $compact = preg_replace('/[^A-Z0-9]/', '', strtoupper($visitId));
        $candidates = [strtoupper($visitId)];
        if (preg_match('/^VIS[A-Z0-9]{8}$/', $compact)) {
            $suffix = substr($compact, 3);
            $candidates[] = 'VIS-'.$suffix;
            $candidates[] = 'VIS-'.substr($suffix,0,4).'-'.substr($suffix,4);
        }
        $row = DB::table('queues')->orderByDesc('created_at')->orderByDesc('id')->whereIn(\Illuminate\Support\Facades\Schema::hasColumn('queues','visit_id')?'visit_id':'portal_payload->visitId', $candidates)->first();
        abort_unless($row, 404, 'Visit not found.');
        $queue=\App\Support\QueueData::read($row->portal_payload);
        \App\Support\VisitorAccess::ownsQueue($request,$queue);
        $appointment=!empty($queue['appointmentId'])?DB::table('shared_appointments')->where('id',$queue['appointmentId'])->first():null;
        if($appointment){$a=AppointmentController::present($appointment);$queue['appointmentProgress']=array_intersect_key($a,array_flip(['createdAt','scheduledConfirmedAt']));$queue['followUpTask']=$a['followUpTask']??null;}
        return response()->json(['queue' => $queue]);
    }

    public function update(Request $request, string $id)
    {
        $actor = StaffAuth::user($request, 'ADMIN');\App\Support\QueueDayClosure::run();
        $data = $request->validate([
            'status' => ['required', 'in:Waiting,Called,Serving,Completed,Skipped,Cancelled'],
            'serviceKey' => ['sometimes', 'nullable', 'string', 'max:50'],
            'serviceLabel' => ['sometimes', 'string', 'max:150'],
            'calledAt' => ['sometimes', 'nullable', 'date'], 'servingAt' => ['sometimes', 'nullable', 'date'],
            'completedAt' => ['sometimes', 'nullable', 'date'], 'recalledAt' => ['sometimes', 'nullable', 'date'],
            'transferredAt' => ['sometimes', 'nullable', 'date'], 'recallCount' => ['sometimes', 'integer', 'min:0'],
            'closureReason' => ['sometimes', 'string', 'min:5', 'max:500'],
        ]);
        if(in_array($data['status'],['Called','Serving']))\App\Support\Availability::requireOpen();
        $queue = DB::transaction(function () use ($id, $data, $actor) {
            DB::table('staff_users')->where('id',$actor->id)->lockForUpdate()->first();
            $row = DB::table('queues')->where('id', $id)->lockForUpdate()->first();
            abort_unless($row && $row->portal_payload, 404, 'Queue entry not found.');
            abort_if($row->assigned_admin_id && $row->assigned_admin_id !== $actor->id && in_array($row->status, ['Called', 'Serving']), 409, 'Another Admin is handling this visit.');
            $queue = array_replace(\App\Support\QueueData::read($row->portal_payload), $data);
            $transitions=['Unfinished'=>['Waiting','Cancelled'],'Waiting'=>['Waiting','Called','Cancelled'],'Called'=>['Called','Serving','Waiting','Skipped','Cancelled'],'Serving'=>['Serving','Completed','Waiting','Cancelled'],'Skipped'=>['Skipped','Waiting','Called','Cancelled'],'Completed'=>['Completed'],'Cancelled'=>['Cancelled']];
            if($row->status==='Called'&&$data['status']==='Waiting')abort_unless(isset($data['serviceKey']),409,'Choose a service to transfer this called visit.');
            abort_unless(in_array($data['status'],$transitions[$row->status]??[]),409,'This queue transition is not allowed.');
            $stored=\App\Support\QueueData::read($row->portal_payload);
            if($row->status==='Unfinished'&&!empty($stored['appointmentId'])){
                $appointment=DB::table('shared_appointments')->where('id',$stored['appointmentId'])->first();
                abort_if($appointment&&in_array($appointment->status,['Requested','Booked']),409,'Another visit is already being arranged. Use the appointment to schedule or check in this visitor.');
            }
            if(\App\Support\ServicePrivacy::confidential($stored['serviceKey']??''))abort_unless($actor->confidential_access??false,403,'Confidential access required to handle the original visit.');
            if(in_array($row->status,['Completed','Cancelled'])){
                abort_if(isset($data['serviceKey'])&&$data['serviceKey']!==($stored['serviceKey']??null),409,'An ended visit cannot change service.');
                request()->attributes->set('system_audit_recorded',true);
                return $stored;
            }
            if(isset($data['serviceKey'])&&\App\Support\ServicePrivacy::confidential($stored['serviceKey']??''))abort_unless(\App\Support\ServicePrivacy::confidential($data['serviceKey']),409,'Transfer confidential visits to a confidential service so their history remains protected.');
            if(in_array($data['status'],['Called','Serving']))\App\Support\VisitFlow::requireCounter($actor,$id);
            if($row->status==='Unfinished'&&$data['status']==='Waiting'){
                \App\Support\Availability::requireOpen();
                $queue['checkedInAt']=now()->toIso8601String();
                $queue['recoveryHistory'][]=['previousStatus'=>$stored['previousStatus']??'Unfinished','recoveredAt'=>now()->toIso8601String(),'adminName'=>$actor->full_name];
                foreach(['calledAt','servingAt','completedAt'] as $field)$stored[$field]=null;
                if(!empty($queue['appointmentId']))DB::table('shared_appointments')->where('id',$queue['appointmentId'])->update(['status'=>'Checked-in','updated_at'=>now()]);
            }
            if(in_array($row->status,['Skipped','Unfinished'])&&$data['status']==='Waiting')$queue['queueEnteredAt']=now()->toIso8601String();
            if($data['status']==='Skipped')$queue['skippedAt']=now()->toIso8601String();
            foreach(['calledAt','servingAt','completedAt'] as $field)$queue[$field]=$stored[$field]??null;
            if($data['status']==='Waiting'&&isset($data['serviceKey'])){
                $step=$stored;
                \App\Support\VisitFlow::archiveStep($step,$actor,'Transferred');
                $queue['serviceHistory']=$step['serviceHistory'];
                \App\Support\VisitFlow::closeLog($queue,'Transferred');
                foreach(['calledAt','servingAt','completedAt'] as $field)$queue[$field]=null;
                $queue['queueEnteredAt']=now()->toIso8601String();
                $queue['transferredAt']=now()->toIso8601String();
            }
            if($data['status']==='Called'&&$row->status!=='Called')$queue['calledAt']=now()->toIso8601String();
            if(isset($data['recallCount'])&&$data['recallCount']>($stored['recallCount']??0)&&$data['status']==='Called'){$queue['recallCount']=($stored['recallCount']??0)+1;$queue['recalledAt']=now()->toIso8601String();}
            if(isset($data['serviceKey'])&&!empty($queue['appointmentId'])){
                $appointment=DB::table('shared_appointments')->where('id',$queue['appointmentId'])->lockForUpdate()->first();
                if($appointment){$a=\App\Http\Controllers\AppointmentController::present($appointment);$a['originalService']??=$a['service'];$a['serviceKey']=$data['serviceKey'];$a['serviceHistory']=$queue['serviceHistory']??[];
                $a['service']=DB::table('service_catalog')->where('key',$data['serviceKey'])->value('label')??$a['service'];
                DB::table('shared_appointments')->where('id',$appointment->id)->update(['service_key'=>$data['serviceKey'],'payload'=>\Illuminate\Support\Facades\Crypt::encryptString(json_encode($a)),'revision'=>$appointment->revision+1,'updated_at'=>now()]);}
            }
            if(isset($data['serviceKey'])&&\Illuminate\Support\Facades\Schema::hasTable('service_catalog')){$service=DB::table('service_catalog')->where('key',$data['serviceKey'])->first();abort_unless($service,422,'Unknown service.');$queue['serviceLabel']=$service->label;}
            if($data['status']==='Cancelled'){
                $queue['cancelledAt']=now()->toIso8601String();
                if(\Illuminate\Support\Facades\Schema::hasTable('notification_outbox'))DB::table('notification_outbox')->where('visit_id',$queue['visitId'])->whereIn('status',['pending','paused','failed'])->update(['status'=>'cancelled','updated_at'=>now()]);
                if(!empty($queue['appointmentId']))DB::table('shared_appointments')->where('id',$queue['appointmentId'])->update(['status'=>'Cancelled','updated_at'=>now()]);
                if(!empty($queue['appointmentId'])){ $appointment=DB::table('shared_appointments')->where('id',$queue['appointmentId'])->first();if($appointment)\App\Support\AppointmentNotifications::cancellation($appointment,$actor); }
            }
            if(\App\Support\ServicePrivacy::confidential($queue['serviceKey']??''))abort_unless($actor->confidential_access??false,403,'Confidential access required to handle this visit.');
            if ($data['status']==='Called' && $queue['source']==='Appointment' && !empty($queue['scheduledAt'])) abort_if(\Carbon\CarbonImmutable::parse($queue['scheduledAt'])->isFuture(),409,'This appointment is scheduled for a later time.');
            if (in_array($row->status,['Completed','Cancelled']) && $data['status']!==$row->status) abort(409,'This visit has already ended.');
            if ($data['status']==='Serving' && !in_array($row->status,['Called','Serving'])) abort(409,'Call the visitor before beginning service.');
            if ($data['status']==='Completed' && !in_array($row->status,['Serving','Completed'])) abort(409,'Begin service before completing this visit.');
            if ($data['status']==='Serving' && $row->status!=='Serving') $queue['servingAt']=now()->toIso8601String();
            if ($data['status']==='Completed' && $row->status!=='Completed') $queue['completedAt']=now()->toIso8601String();
            \App\Support\ServiceOutcome::save($queue,$actor);
            $queue['assignedAdminId'] = $actor->id;
            $queue['assignedAdminName'] = $actor->full_name;
            DB::table('queues')->where('id', $id)->update([
                'status' => $queue['status'], 'assigned_admin_id' => $actor->id, 'assigned_admin_name' => $actor->full_name,
                'service_label_text' => $queue['serviceLabel'], 'portal_payload' => \App\Support\QueueData::write($queue),
                'called_at' => empty($queue['calledAt']) ? null : date('Y-m-d H:i:s', strtotime($queue['calledAt'])),
                'serving_at' => empty($queue['servingAt']) ? null : date('Y-m-d H:i:s', strtotime($queue['servingAt'])),
                'completed_at' => empty($queue['completedAt']) ? null : date('Y-m-d H:i:s', strtotime($queue['completedAt'])),
            ]);
            $changes=[];
            if(!empty($data['closureReason']))$changes[]=['field'=>'Reason not served','from'=>'','to'=>$data['closureReason']];
            if($stored['status']!==$queue['status'])$changes[]=['field'=>'Queue status','from'=>$stored['status'],'to'=>$queue['status']];
            if(($stored['serviceKey']??null)!==($queue['serviceKey']??null))$changes[]=['field'=>'Service','from'=>$stored['serviceLabel']??'','to'=>$queue['serviceLabel']];
            if(($stored['recallCount']??0)!==($queue['recallCount']??0))$changes[]=['field'=>'Recall count','from'=>(string)($stored['recallCount']??0),'to'=>(string)$queue['recallCount']];
            if($changes){
                $action=isset($data['serviceKey'])&&($stored['serviceKey']??null)!==$queue['serviceKey']?'Visit transferred':(($stored['recallCount']??0)!==($queue['recallCount']??0)?'Visitor recalled':match($queue['status']){'Called'=>'Visitor called','Serving'=>'Service started','Completed'=>'Service completed','Skipped'=>'Visitor skipped','Cancelled'=>'Visit cancelled',default=>'Visitor returned to waiting'});
                if($queue['status']==='Serving')$changes[]=['field'=>'Visitor log','from'=>'','to'=>'Time In recorded'];
                if($queue['status']==='Completed')$changes[]=['field'=>'Records','from'=>'','to'=>'Time Out and completed transaction recorded'];
                \App\Support\SystemAudit::record($actor,'Queue',$action,$queue['visitId'],$changes);
            }
            request()->attributes->set('system_audit_recorded',true);
            return $queue;
        });
        return response()->json(['queue' => $queue]);
    }

    public function cancel(Request $request,string $visitId)
    {
        \App\Support\QueueDayClosure::run();
        $queue = DB::transaction(function () use ($visitId,$request) {
            $row = DB::table('queues')->where(\Illuminate\Support\Facades\Schema::hasColumn('queues','visit_id')?'visit_id':'portal_payload->visitId', $visitId)->lockForUpdate()->first();
            abort_unless($row, 404, 'Visit not found.');
            \App\Support\VisitorAccess::ownsQueue($request,\App\Support\QueueData::read($row->portal_payload));
            abort_unless(in_array($row->status, ['Waiting', 'Called', 'Skipped']), 409, 'This visit can no longer be cancelled.');
            $queue = \App\Support\QueueData::read($row->portal_payload);
            $queue['status'] = 'Cancelled';
            if(!empty($queue['appointmentId']))DB::table('shared_appointments')->where('id',$queue['appointmentId'])->update(['status'=>'Cancelled','updated_at'=>now()]);
            if (\Illuminate\Support\Facades\Schema::hasTable('notification_outbox')) {
                DB::table('notification_outbox')->where(\Illuminate\Support\Facades\Schema::hasColumn('queues','visit_id')?'visit_id':'portal_payload->visitId',$queue['visitId'])->whereIn('status',['pending','paused','failed'])->update(['status'=>'cancelled','updated_at'=>now()]);
            }
            if(!empty($queue['appointmentId'])){ $appointment=DB::table('shared_appointments')->where('id',$queue['appointmentId'])->first();if($appointment)\App\Support\AppointmentNotifications::cancellation($appointment); }
            DB::table('queues')->where('id', $row->id)->update(['status' => 'Cancelled', 'portal_payload' => \App\Support\QueueData::write($queue)]);
            \App\Support\SystemAudit::record(null,'Queue','Visit cancelled',$queue['visitId']);
            return $queue;
        });
        return response()->json(['queue' => $queue]);
    }

    public function followUp(Request $request, string $id)
    {
        $actor=StaffAuth::user($request,'ADMIN');
        $d=$request->validate(['reason'=>'required|string|min:5|max:500']);
        $result=DB::transaction(function()use($request,$id,$actor,$d){
            $row=DB::table('queues')->where('id',$id)->lockForUpdate()->first();abort_unless($row,404);
            abort_unless(in_array($row->status,['Waiting','Called','Serving','Skipped','Unfinished']),409,'This visit has already ended.');
            abort_if($row->assigned_admin_id&&$row->assigned_admin_id!==$actor->id&&in_array($row->status,['Called','Serving']),409,'Another Admin is handling this visit.');
            $q=\App\Support\QueueData::read($row->portal_payload);
            if(\App\Support\ServicePrivacy::confidential($q['serviceKey']))abort_unless($actor->confidential_access??false,403,'Confidential access required.');
            if($row->status!=='Unfinished')\App\Support\VisitFlow::archiveStep($q,$actor,'Another visit requested');
            \App\Support\VisitFlow::closeLog($q,'Another visit requested');
            $q['status']='Unfinished';$q['unfinishedAt']=now()->toIso8601String();$q['followUpReason']=$d['reason'];
            $appointment=DB::table('shared_appointments')->where('visit_id',$q['visitId'])->lockForUpdate()->first();
            abort_if($row->status==='Unfinished'&&$appointment&&in_array($appointment->status,['Requested','Booked']),409,'Another visit is already arranged. Update its appointment instead.');
            $a=$appointment?AppointmentController::present($appointment):[
                'id'=>'A'.bin2hex(random_bytes(8)),'code'=>'APT-'.strtoupper(bin2hex(random_bytes(4))),
                'visitId'=>$q['visitId'],'type'=>$q['visitorType'],'name'=>$q['name'],'email'=>$q['email'],'contact'=>$q['contact'],
                'serviceKey'=>$q['serviceKey'],'service'=>$q['serviceLabel'],'idNumber'=>$q['idNumber']??'',
                'idType'=>$q['idType']??'','guestClass'=>$q['guestClass']??'',
                'isSenior'=>$q['isSenior']??false,'isPWD'=>$q['isPWD']??false,'attachments'=>[],
                'createdAt'=>now()->toIso8601String(),'shared'=>true,
            ];
            $a['scheduleHistory'][]=['date'=>$appointment->date??null,'time'=>$appointment->time??null,'status'=>$row->status,'changedAt'=>now()->toIso8601String(),'changedBy'=>$actor->full_name];
            $a['serviceHistory']=$q['serviceHistory']??[];$a['rescheduleRequested']=true;$a['rescheduleReason']=$d['reason'];
            DB::table('shared_appointments')->updateOrInsert(['id'=>$a['id']],['visit_id'=>$q['visitId'],'email'=>\App\Support\EmailIndex::key($a['email']),'service_key'=>$q['serviceKey'],'status'=>'Requested','date'=>null,'time'=>null,'queue_id'=>$id,'revision'=>($appointment->revision??0)+1,'payload'=>\Illuminate\Support\Facades\Crypt::encryptString(json_encode($a)),'created_at'=>$appointment->created_at??now(),'updated_at'=>now()]);
            $q['appointmentId']=$a['id'];
            DB::table('queues')->where('id',$id)->update(['status'=>'Unfinished','portal_payload'=>\App\Support\QueueData::write($q)]);
            DB::table('notification_outbox')->where('visit_id',$q['visitId'])->whereIn('status',['pending','paused','failed'])->update(['status'=>'superseded','updated_at'=>now()]);
            \App\Support\SystemAudit::record($actor,'Queue','Another visit arranged; awaiting schedule',$q['visitId']);
            return ['queue'=>$q,'appointment'=>AppointmentController::present(DB::table('shared_appointments')->where('id',$a['id'])->first())];
        });
        return response()->json($result);
    }
}
