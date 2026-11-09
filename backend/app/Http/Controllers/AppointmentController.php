<?php
namespace App\Http\Controllers;
use App\Support\{StaffAuth,VisitorAccess,OfficeCalendar,SystemAudit};
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{DB,Crypt};
use Illuminate\Support\Str;
class AppointmentController extends Controller {
 public static function present(object $row): array {
  $a=json_decode(Crypt::decryptString($row->payload),true);
  foreach(['checkedInAt','calledAt','servingAt','completedAt'] as $field)unset($a[$field]);
  if($row->queue_id&&in_array($row->status,['Checked-in','Completed','Cancelled'])){
   $queue=DB::table('queues')->where('id',$row->queue_id)->first();
   if($queue)$a=array_merge($a,array_intersect_key(\App\Support\QueueData::read($queue->portal_payload),array_flip(['checkedInAt','calledAt','servingAt','completedAt'])));
  }
  $record=array_merge($a,['id'=>$row->id,'requestReference'=>$a['code']??$row->visit_id,'visitId'=>str_starts_with($row->visit_id,'VIS-')?$row->visit_id:null,'status'=>$row->status,'date'=>$row->date,'time'=>$row->time,'queueId'=>$row->queue_id,'revision'=>$row->revision,'shared'=>true]);
  $record['reviewDueAt']=\App\Support\VisitProcess::reviewDeadline($row)->toIso8601String();
  $record['needsRescheduling']=!empty($a['reviewExpiredAt'])&&$row->status==='Requested'&&!$row->date;
  $record['arrivalPolicy']=['earlyMinutes'=>30,'lateMinutes'=>max(1,(int)(\App\Support\VisitFlow::settings()['noShowThresholdMinutes']??60))];
  if(!request()->bearerToken())unset($record['documentVersions']);
  $record['ticketHtml']= view('tickets.appointment',['ticket'=>$record,'logoSrc'=>'pup.jpg'])->render();
  unset($record['permissions']);
  if(request()->bearerToken()){
   $staff=StaffAuth::user(request(),'ADMIN');
   $record['permissions']=['editFollowUp'=>$row->status!=='Cancelled'&&\App\Support\CaseAccess::canEditAppointment($staff,$row)];
  }
  return $record;
 }
 public function access(Request $r,object $row): void {
  if($r->bearerToken()){$u=StaffAuth::user($r,'ADMIN');abort_unless(\App\Support\CaseAccess::canViewAppointment($u,$row),403,'Confidential case access and an active unlock are required.');return;}
  abort_unless(\App\Support\EmailIndex::key(VisitorAccess::email($r))===$row->email,403,'This visit belongs to another visitor.');
 }
 private function open(): void { \App\Support\Availability::requireOpen(); }
 public function services() {return response()->json(['services'=>DB::table('service_catalog')->get()->map(fn($s)=>json_decode($s->payload,true)+['confidential'=>\App\Support\ServicePrivacy::confidential($s->key)])]);}
 public function saveService(Request $r,string $key) {
  $u=StaffAuth::user($r,'ADMIN');abort_unless($u->confidential_approver??false,403,'Only the OSS Head can manage services.');abort_unless(preg_match('/^[a-z0-9_\-]{1,50}$/',$key),422,'Invalid service key.');
  $d=$r->validate(['confidential'=>'sometimes|boolean','label'=>'required|string|max:150','desc'=>'nullable|string|max:1000','announcement'=>'nullable|string|max:1000','icon'=>'required|string|max:30','requirements'=>'array|max:30','requirements.*'=>'string|max:200','templates'=>'array|max:10','templates.*.name'=>'required|string|max:200','templates.*.dataUrl'=>'required|string|max:3000000']);
  $before=\App\Support\ServicePrivacy::confidential($key);
  if(array_key_exists('confidential',$d)&&$d['confidential']!==$before)abort_unless($u->confidential_approver??false,403,'Only the OSS Head can change service confidentiality.');
  $d['confidential']=$d['confidential']??$before;
  foreach($d['templates']??[] as $file)abort_unless(preg_match('~^data:(application/pdf|image/png|image/jpeg|application/msword|application/vnd\.[a-z0-9.+-]+);base64,[A-Za-z0-9+/=]+$~',$file['dataUrl']),422,'Use a PDF, Office document, PNG or JPEG template.');
  DB::transaction(function()use($u,$key,$d,$before){
  DB::table('service_catalog')->updateOrInsert(['key'=>$key],['label'=>$d['label'],'payload'=>json_encode($d+['key'=>$key])]);SystemAudit::record($u,'Settings','Saved service '.$d['label'],$key);
  if($before!==$d['confidential']){
   if($d['confidential'])foreach(DB::table('shared_transactions')->get() as $row){$t=json_decode(\Illuminate\Support\Facades\Crypt::decryptString($row->payload),true);if(($t['service']??'')===$key)DB::table('confidential_cases')->insertOrIgnore(['id'=>$t['id'],'code'=>$t['code']??$t['id'],'created_at'=>now(),'updated_at'=>now()]);}
   SystemAudit::record($u,'Confidential',$d['confidential']?'Service marked confidential':'Service confidentiality removed',$key,[['field'=>'Confidential','from'=>$before?'Yes':'No','to'=>$d['confidential']?'Yes':'No']]);
  }
});return response()->json(['saved'=>true]);
 }
 public function deleteService(Request $r,string $key) {
  $u=StaffAuth::user($r,'ADMIN');abort_unless($u->confidential_approver??false,403,'Only the OSS Head can manage services.');abort_if(\App\Support\ServicePrivacy::confidential($key),409,'Remove confidentiality through the OSS Head before deleting this service.');abort_if(DB::table('shared_appointments')->where('service_key',$key)->whereIn('status',['Requested','Booked','Checked-in'])->exists(),409,'This service has active appointments.');DB::table('service_catalog')->where('key',$key)->delete();SystemAudit::record($u,'Settings','Removed service',$key);return response()->json(['saved'=>true]);
 }
 public function index(Request $r) {
  $u=StaffAuth::user($r,'ADMIN');\App\Support\QueueDayClosure::run();
  return response()->json(['appointments'=>DB::table('shared_appointments')->orderByDesc('created_at')->get()->map(function($a)use($u){$record=self::present($a);if(!\App\Support\CaseAccess::canViewAppointment($u,$a))$record=array_intersect_key($record,array_flip(['id','visitId','code','service','serviceKey','status','date','time','revision','shared','createdAt']))+['name'=>'Restricted record','type'=>'','attachments'=>[],'restricted'=>true];return $record;})]);
 }
 public function show(Request $r,string $visitId) {
  \App\Support\QueueDayClosure::run();
  $row=DB::table('shared_appointments')->where(fn($q)=>$q->where('visit_id',strtoupper($visitId))->orWhere('id',$visitId))->first();abort_unless($row,404,'Appointment not found.');$this->access($r,$row);
  $queue=$row->queue_id&&in_array($row->status,['Checked-in','Completed','Cancelled'])?DB::table('queues')->where('id',$row->queue_id)->first():null;
  return response()->json(['appointment'=>self::present($row),'queue'=>$queue?($r->bearerToken()?\App\Support\QueueData::forStaff(\App\Support\QueueData::read($queue->portal_payload),StaffAuth::user($r,'ADMIN')):\App\Support\QueueData::read($queue->portal_payload)):null]);
 }
 public function slots(Request $r) {
  $d=$r->validate(['date'=>'required|date_format:Y-m-d','office'=>'required|string|max:150','exclude'=>'nullable|string|max:80']);
  $except=null;
  if(!empty($d['exclude'])){$row=DB::table('shared_appointments')->where('id',$d['exclude'])->first();abort_unless($row,404);$this->access($r,$row);$except=$row->id;}
  $availability=\App\Support\AppointmentSlots::availability($d['date'],$d['office'],$except);
  $result=['offices'=>\App\Support\AppointmentSlots::offices(),'slots'=>array_values(array_map(fn($slot)=>$slot['time'],array_filter($availability,fn($slot)=>$slot['available']))),'slotMinutes'=>30];
  if($r->bearerToken()){
   StaffAuth::user($r,'ADMIN');$result['availability']=$availability;
   if($except&&in_array($row->status,['Requested','Booked','Checked-in'])&&$row->date===$d['date']){
    $editing=self::present($row);
    if(($editing['office']??'Office of Student Services')===$d['office'])$result['currentReservation']=['time'=>$row->time,'status'=>$row->status];
   }
  }
  return response()->json($result);
 }
 public function offices() { return response()->json(['offices'=>\App\Support\AppointmentSlots::offices()]); }
 public function store(Request $r) {
  $r->merge(['contact'=>\App\Support\PhilippineContact::normalize($r->input('contact','')),'email'=>strtolower(trim((string)$r->input('email','')))]);
  $d=$r->validate(['office'=>'required|string|max:150','date'=>'required|date_format:Y-m-d','time'=>'required|date_format:H:i','submissionKey'=>'nullable|uuid','type'=>'required|in:Student,Guest','name'=>'required|string|max:150','email'=>['required','email','max:120'],'contact'=>['required','regex:/^09[0-9]{9}$/'],'serviceKey'=>'required|string|exists:service_catalog,key','idNumber'=>'nullable|string|max:50','idType'=>'nullable|string|max:100','guestClass'=>'nullable|string|max:100','isSenior'=>'boolean','isPWD'=>'boolean','attachments'=>'sometimes|array|max:5','attachments.*.name'=>'required|string|max:200','attachments.*.dataUrl'=>'required|string|max:7000000']);
  VisitorAccess::requireEmail($r,$d['email']);
  $result=DB::transaction(function()use($d){
   DB::table('office_calendar')->where('id',1)->lockForUpdate()->first();\App\Support\VisitFlow::requireIntake();
   if(!empty($d['submissionKey'])){
    $existing=DB::table('shared_appointments')->where('submission_key',$d['submissionKey'])->first();
    if($existing){request()->attributes->set('system_audit_recorded',true);return self::present($existing);}
   }
   \App\Support\AppointmentSlots::reserve($d['date'],$d['time'],$d['office']);
   $svc=DB::table('service_catalog')->where('key',$d['serviceKey'])->first();
   $files=[];
   foreach($d['attachments']??[] as $f){
    abort_unless(preg_match('~^data:(application/pdf|image/png|image/jpeg);base64,([A-Za-z0-9+/=]+)$~',$f['dataUrl'],$m),422,'Upload PDF, PNG or JPEG files only.');
    $bytes=base64_decode($m[2],true);abort_unless($bytes!==false && strlen($bytes)<=5*1024*1024,422,'Each file must be at most 5 MB.');
    $mime=(new \finfo(FILEINFO_MIME_TYPE))->buffer($bytes);abort_unless($mime===$m[1],422,'File contents do not match its type.');
    $files[]=['name'=>$f['name'],'dataUrl'=>$f['dataUrl'],'size'=>strlen($bytes),'type'=>$mime];
   }
   do{$visitId='APT-'.strtoupper(Str::random(8));}while(DB::table('shared_appointments')->where('visit_id',$visitId)->orWhere('id',$visitId)->exists());
   $a=array_merge($d,['id'=>$visitId,'code'=>$visitId,'requestReference'=>$visitId,'visitId'=>null,'email'=>strtolower($d['email']),'service'=>$svc->label,'status'=>'Requested','date'=>$d['date'],'time'=>$d['time'],'preferredDate'=>$d['date'],'preferredTime'=>$d['time'],'queueId'=>null,'attachments'=>$files,'createdAt'=>now()->toIso8601String(),'shared'=>true,'revision'=>0]);
   $a['possibleDuplicate']=DB::table('shared_appointments')->where('email',\App\Support\EmailIndex::key($a['email']))->where('service_key',$d['serviceKey'])->whereIn('status',['Requested','Booked','Checked-in'])->exists();
   DB::table('shared_appointments')->insert(['id'=>$a['id'],'visit_id'=>$visitId,'email'=>\App\Support\EmailIndex::key($a['email']),'service_key'=>$d['serviceKey'],'submission_key'=>$d['submissionKey']??null,'status'=>'Requested','date'=>$d['date'],'time'=>$d['time'],'payload'=>Crypt::encryptString(json_encode($a)),'created_at'=>now(),'updated_at'=>now()]);
   SystemAudit::record(null,'Appointments','Appointment request received',$visitId,[['field'=>'Supporting files','from'=>'','to'=>(string)count($files)]]);

   return self::present(DB::table('shared_appointments')->where('id',$a['id'])->first());
  });
  // Mailbox ownership is verified before accepting the request.
  return response()->json(['appointment'=>$result],201);
 }
 public function update(Request $r,string $id) {
  $u=StaffAuth::user($r,'ADMIN');$d=$r->validate(['date'=>'required|date_format:Y-m-d','time'=>'required|date_format:H:i','revision'=>'required|integer|min:0']);
  $a=DB::transaction(function()use($id,$d,$u,$r){
   DB::table('office_calendar')->where('id',1)->lockForUpdate()->first();
   $row=DB::table('shared_appointments')->where('id',$id)->lockForUpdate()->first();abort_unless($row,404);
   $this->access($r,$row);
   abort_unless($row->revision===$d['revision'],409,'Another Admin changed this request. Refresh it.');
   $recoverable=$row->queue_id&&DB::table('queues')->where('id',$row->queue_id)->where('status','Unfinished')->exists();
   abort_unless(in_array($row->status,['Requested','Booked','No-show','Unfinished'])&&(!$row->queue_id||$recoverable),409,'This appointment can no longer be scheduled.');
   $at=CarbonImmutable::parse($d['date'].' '.$d['time'],'Asia/Manila');abort_unless($at>CarbonImmutable::now('Asia/Manila'),422,'Choose a future appointment time.');
   $original=json_decode(Crypt::decryptString($row->payload),true);
   $availability=OfficeCalendar::status($at);abort_unless($availability['open'],422,$availability['reason']);
   \App\Support\AppointmentSlots::reserve($d['date'],$d['time'],$original['office']??'Office of Student Services',$id);
   if(!str_starts_with($row->visit_id,'VIS-')){
    do{$issuedVisitId='VIS-'.strtoupper(bin2hex(random_bytes(4)));}while(DB::table('shared_appointments')->where('visit_id',$issuedVisitId)->exists() || DB::table('queues')->where(\Illuminate\Support\Facades\Schema::hasColumn('queues','visit_id')?'visit_id':'portal_payload->visitId',$issuedVisitId)->exists());
    DB::table('shared_appointments')->where('id',$id)->update(['visit_id'=>$issuedVisitId]);
    $row->visit_id=$issuedVisitId;
   }
   $payload=self::present($row);
   unset($payload['ticketHtml']);
   $payload['scheduleHistory'][]=['date'=>$row->date,'time'=>$row->time,'status'=>$row->status,'changedAt'=>now()->toIso8601String(),'changedBy'=>$u->full_name];
   unset($payload['reviewExpiredAt']);
   $payload['scheduledConfirmedAt']=now()->toIso8601String();$payload['earlierSlotOptIn']=false;$payload['rescheduleRequested']=false;$payload['calendarReview']=false;unset($payload['rescheduleReason']);
   if($row->queue_id){$previous=DB::table('queues')->where('id',$row->queue_id)->first();if($previous)$payload['serviceHistory']=\App\Support\QueueData::read($previous->portal_payload)['serviceHistory']??[];}
   DB::table('shared_appointments')->where('id',$id)->update(['payload'=>Crypt::encryptString(json_encode($payload))]);
   DB::table('shared_appointments')->where('id',$id)->update(['date'=>$d['date'],'time'=>$d['time'],'status'=>'Booked','revision'=>$row->revision+1,'updated_at'=>now()]);
   SystemAudit::record($u,'Appointments',$row->status==='Requested'?'Appointment scheduled':'Appointment rescheduled',$row->visit_id,[['field'=>'Schedule','from'=>$row->date?CarbonImmutable::parse($row->date.' '.$row->time,'Asia/Manila')->format('M j, Y, g:i A'):'Not set','to'=>$at->format('M j, Y, g:i A')]]);
   $a=self::present(DB::table('shared_appointments')->where('id',$id)->first());
   $notify=Request::create('/','POST',['visitId'=>$a['visitId'],'email'=>$a['email'],'name'=>$a['name'],'service'=>$a['service'],'date'=>$a['date'],'time'=>$a['time'],'kind'=>$row->status==='Requested'?'confirmation':'rescheduled']);$notify->headers->set('Authorization','Bearer '.$r->bearerToken());
   (new NotificationController)->store($notify);
   return $a;
  });
  return response()->json(['appointment'=>$a]);
 }
 public function replaceDocument(Request $r,string $id,string $index) {
  // Visitor-only: staff reviews replacements using the existing review action.
  abort_if($r->bearerToken(),403,'The visitor must submit the replacement.');
  $d=$r->validate(['revision'=>'required|integer|min:0','name'=>'required|string|max:200','dataUrl'=>'required|string|max:7000000']);
  abort_unless(ctype_digit($index),404);
  $a=DB::transaction(function()use($r,$id,$index,$d){
   $row=DB::table('shared_appointments')->where('id',$id)->lockForUpdate()->first();abort_unless($row,404);$this->access($r,$row);
   abort_unless(in_array($row->status,['Requested','Booked']),409,'Documents can only be replaced before check-in.');
   abort_unless($row->revision===$d['revision'],409,'This request changed. Refresh before replacing the file.');
   $a=json_decode(Crypt::decryptString($row->payload),true);$i=(int)$index;
   abort_unless(isset($a['attachments'][$i])&&($a['attachments'][$i]['review']['status']??'')==='Needs correction',409,'Only documents needing correction can be replaced.');
   abort_unless(preg_match('~^data:(application/pdf|image/png|image/jpeg);base64,([A-Za-z0-9+/=]+)$~',$d['dataUrl'],$m),422,'Upload a PDF, PNG or JPEG.');
   $bytes=base64_decode($m[2],true);abort_unless($bytes!==false&&strlen($bytes)<=5*1024*1024,422,'Each file must be at most 5 MB.');
   abort_unless((new \finfo(FILEINFO_MIME_TYPE))->buffer($bytes)===$m[1],422,'File contents do not match its type.');
   $a['documentVersions'][$i][]=array_merge($a['attachments'][$i],['replacedAt'=>now()->toIso8601String()]);
   $a['attachments'][$i]=['name'=>$d['name'],'dataUrl'=>$d['dataUrl'],'size'=>strlen($bytes),'type'=>$m[1],'review'=>['status'=>'Pending review'],'uploadedAt'=>now()->toIso8601String(),'version'=>count($a['documentVersions'][$i])+1];
   DB::table('shared_appointments')->where('id',$id)->update(['payload'=>Crypt::encryptString(json_encode($a)),'revision'=>$row->revision+1,'updated_at'=>now()]);
   SystemAudit::record(null,'Appointments','Visitor submitted corrected document',$row->visit_id);
   return self::present(DB::table('shared_appointments')->where('id',$id)->first());
  });return response()->json(['appointment'=>$a]);
 }
 public function reviewDocument(Request $r,string $id,string $index) {
  $u=StaffAuth::user($r,'ADMIN');
  $d=$r->validate(['status'=>'required|in:Pending review,Accepted,Needs correction','reason'=>'nullable|string|max:1000','requirement'=>'nullable|string|max:200','revision'=>'required|integer|min:0']);
  abort_unless(ctype_digit($index),404);
  $a=DB::transaction(function()use($r,$id,$index,$d,$u){
   $row=DB::table('shared_appointments')->where('id',$id)->lockForUpdate()->first();abort_unless($row,404);
   $this->access($r,$row);
   abort_unless($row->revision===$d['revision'],409,'Another Admin changed this request. Refresh it.');
   abort_unless(in_array($row->status,['Requested','Booked']),409,'Documents can only be reviewed before check-in.');
   abort_unless(\App\Support\CaseAccess::canEditAppointment($u,$row),403,'Document review requires edit access to this visit.');
   $a=self::present($row);abort_unless(isset($a['attachments'][(int)$index]),404,'Document not found.');
   $reason=trim($d['reason']??'');abort_if($d['status']==='Needs correction'&&$reason==='',422,'Explain what the visitor needs to correct.');
   $file=&$a['attachments'][(int)$index];$before=$file['review']['status']??'Pending review';
   $requirement=trim(array_key_exists('requirement',$d)?($d['requirement']??''):($file['review']['requirement']??''));
   $catalog=json_decode(DB::table('service_catalog')->where('key',$row->service_key)->value('payload')??'{}',true);
   abort_if($requirement!==''&&!in_array($requirement,array_map('trim',$catalog['requirements']??[]),true),422,'Select a requirement listed for this service.');
   $file['review']=['status'=>$d['status'],'reason'=>$d['status']==='Needs correction'?$reason:'','requirement'=>$requirement,'serviceKey'=>$row->service_key,'reviewedAt'=>now()->toIso8601String()];
   DB::table('shared_appointments')->where('id',$id)->update(['payload'=>Crypt::encryptString(json_encode($a)),'revision'=>$row->revision+1,'updated_at'=>now()]);
   if($d['status']==='Needs correction')\App\Support\VisitProcess::notify(DB::table('shared_appointments')->where('id',$id)->first(),'document-correction','A document needs correction: '.$reason);
   SystemAudit::record($u,'Appointments','Document review updated',$row->visit_id,[['field'=>'Document '.((int)$index+1),'from'=>$before,'to'=>$d['status']]]);
   return self::present(DB::table('shared_appointments')->where('id',$id)->first());
  });
  return response()->json(['appointment'=>$a]);
 }
 public function checkIn(Request $r,string $id) {
  \App\Support\QueueDayClosure::run();
  abort_unless($r->bearerToken(),403,'Present your Visit ID at the OSS counter. An Admin will check you in when you arrive.');
  StaffAuth::user($r,'ADMIN');
  $result=DB::transaction(function()use($r,$id){
   DB::table('office_calendar')->where('id',1)->lockForUpdate()->first();$this->open();
   $row=DB::table('shared_appointments')->where('id',$id)->lockForUpdate()->first();abort_unless($row,404);$this->access($r,$row);
   if($row->queue_id&&$row->status==='Checked-in'){request()->attributes->set('system_audit_recorded',true);return ['appointment'=>self::present($row),'queue'=>\App\Support\QueueData::forStaff(\App\Support\QueueData::read(DB::table('queues')->where('id',$row->queue_id)->value('portal_payload')),StaffAuth::user($r,'ADMIN'))];}
   abort_unless($row->status==='Booked',409,'Only confirmed appointments can check in.');
   abort_unless($row->date===CarbonImmutable::now('Asia/Manila')->toDateString(),409,'Check in on your appointment day.');
   abort_unless(OfficeCalendar::status(CarbonImmutable::parse($row->date.' '.$row->time,'Asia/Manila'))['open'],409,'Your appointment needs rescheduling.');
   $at=CarbonImmutable::parse($row->date.' '.$row->time,'Asia/Manila');
   $now=CarbonImmutable::now('Asia/Manila');
   $outside=$now<$at->subMinutes(30)||$now>=$at->addMinutes(max(1,(int)(\App\Support\VisitFlow::settings()['noShowThresholdMinutes']??60)));
   $override=trim((string)$r->input('arrivalOverrideReason',''));
   abort_if($outside&&mb_strlen($override)<5,409,'Check-in opens 30 minutes before the appointment. Late arrivals need staff review. Enter an override reason or arrange another schedule.');
   abort_if(mb_strlen($override)>500,422,'Keep the arrival override reason within 500 characters.');
   if($outside)SystemAudit::record(StaffAuth::user($r,'ADMIN'),'Appointments','Arrival window overridden: '.$override,$row->visit_id);
   $a=self::present($row);$id=$row->queue_id?:'Q'.bin2hex(random_bytes(8));
   if($row->queue_id)abort_unless(DB::table('queues')->where('id',$id)->where('status','Unfinished')->exists(),409,'Review the linked visit before check-in.');
   $q=['id'=>$id,'number'=>null,'visitId'=>$row->visit_id,'visitorType'=>$a['type'],'name'=>$a['name'],'email'=>$a['email'],'contact'=>$a['contact'],'idNumber'=>$a['idNumber']??'','serviceKey'=>$row->service_key,'serviceLabel'=>$a['service'],'source'=>'Appointment','appointmentId'=>$row->id,'office'=>$a['office']??'Office of Student Services','scheduledAt'=>CarbonImmutable::parse($row->date.' '.$row->time,'Asia/Manila')->toIso8601String(),'status'=>'Waiting','isSenior'=>$a['isSenior']??false,'isPWD'=>$a['isPWD']??false,'createdAt'=>now()->toIso8601String(),'checkedInAt'=>now()->toIso8601String(),'assignedAdminId'=>null,'assignedAdminName'=>null,'shared'=>true];
   $q['serviceHistory']=$a['serviceHistory']??[];
   $q['idType']=$a['idType']??'';$q['guestClass']=$a['guestClass']??'';
   DB::table('queues')->updateOrInsert(['id'=>$id],\App\Support\QueueData::index($q)+['queue_number'=>'SCHED-'.substr($id,1,12),'prefix'=>'S','seq'=>0,'visitor_type'=>$a['type'],'visitor_name'=>null,'service_label_text'=>$a['service'],'contact'=>null,'id_number'=>null,'source'=>'Appointment','status'=>'Waiting','assigned_admin_id'=>null,'assigned_admin_name'=>null,'called_at'=>null,'serving_at'=>null,'completed_at'=>null,'portal_payload'=>\App\Support\QueueData::write($q)]);
   DB::table('shared_appointments')->where('id',$row->id)->update(['queue_id'=>$id,'status'=>'Checked-in','revision'=>$row->revision+1,'updated_at'=>now()]);
   SystemAudit::record($r->bearerToken()?StaffAuth::user($r):null,'Appointments','Appointment checked in',$row->visit_id);
   return ['appointment'=>self::present(DB::table('shared_appointments')->where('id',$row->id)->first()),'queue'=>\App\Support\QueueData::forStaff($q,StaffAuth::user($r,'ADMIN'))];
  });return response()->json($result);
 }
 public function requestReschedule(Request $r,string $id) {
  $d=$r->validate(['reason'=>'required|string|min:5|max:500']);
  $a=DB::transaction(function()use($r,$id,$d){
   $row=DB::table('shared_appointments')->where('id',$id)->lockForUpdate()->first();abort_unless($row,404);$this->access($r,$row);
   abort_unless(in_array($row->status,['Requested','Booked','No-show','Unfinished']),409,'This visit can no longer request rescheduling.');
   $a=json_decode(Crypt::decryptString($row->payload),true);$a['rescheduleRequested']=true;$a['rescheduleReason']=$d['reason'];$a['rescheduleRequestedAt']=now()->toIso8601String();
   DB::table('shared_appointments')->where('id',$id)->update(['payload'=>Crypt::encryptString(json_encode($a)),'revision'=>$row->revision+1,'updated_at'=>now()]);
   SystemAudit::record(null,'Appointments','Visitor requested rescheduling',$row->visit_id);
   return self::present(DB::table('shared_appointments')->where('id',$id)->first());
  });return response()->json(['appointment'=>$a]);
 }
 public function cancel(Request $r,string $id) {
  DB::transaction(function()use($r,$id){
   $row=DB::table('shared_appointments')->where('id',$id)->lockForUpdate()->first();abort_unless($row,404);$this->access($r,$row);
   abort_unless(in_array($row->status,['Requested','Booked','No-show','Unfinished','Cancelled']),409,'Checked-in visits must be cancelled through the queue.');
   if($row->status==='Cancelled'){$r->attributes->set('system_audit_recorded',true);return;}
   DB::table('shared_appointments')->where('id',$id)->update(['status'=>'Cancelled','revision'=>$row->revision+1,'updated_at'=>now()]);
   if($row->queue_id){$queue=DB::table('queues')->where('id',$row->queue_id)->where('status','Unfinished')->first();if($queue){$q=\App\Support\QueueData::read($queue->portal_payload);$q['status']='Cancelled';$q['cancelledAt']=now()->toIso8601String();DB::table('queues')->where('id',$queue->id)->update(['status'=>'Cancelled','portal_payload'=>\App\Support\QueueData::write($q)]);}}
   $actor=$r->bearerToken()?StaffAuth::user($r):null;
   SystemAudit::record($actor,'Appointments','Appointment cancelled',$row->visit_id);
   \App\Support\AppointmentNotifications::cancellation($row,$actor);
  });return response()->json(['cancelled'=>true]);
 }
}
