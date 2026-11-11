<?php
use App\Jobs\SendVisitTicket;
use App\Support\OfficeMail;
use Illuminate\Support\Facades\Mail;

it('discards previously queued ticket emails',function(){
 Mail::fake();
 (new SendVisitTicket(['email'=>'visitor@gmail.com','source'=>'Walk-in']))->handle();
 (new SendVisitTicket(['email'=>'visitor@gmail.com','source'=>'Appointment']))->handle();
 Mail::assertNothingSent();Mail::assertNothingQueued();
});
it('uses the cancellation email layout for appointment updates and preserves guidelines',function(){
 foreach(['Appointment confirmation','Appointment rescheduled','Appointment reminder','Appointment cancelled'] as $title){
  $body="Hi Visitor,\n\nYour appointment update.\n\nService: Good Moral\nDate: October 21, 2026\nTime: 10:00 AM\nVisit ID: VIS-TEST\n\nBring required documents.\n\nArrival guidelines\nArrive on time.\nBring <original> documents.\n\nOffice of Student Services";
  $html=OfficeMail::html($title,$body);
  expect($html)->toContain($title,'Good Moral','10:00 AM','VIS-TEST','Arrival guidelines','Bring &lt;original&gt; documents.')->not->toContain('ticket-number','ticket-stub','ticket-v2','Bring <original>');
 }
});
it('retains browser appointment ticket rendering',function(){
 $ticket=['visitId'=>null,'code'=>'APT-TEST','name'=>'Visitor','service'=>'Good Moral','status'=>'Requested','createdAt'=>'2026-10-21T08:00:00+08:00'];
 $html=view('tickets.appointment',['ticket'=>$ticket,'logoSrc'=>'pup.jpg'])->render();
 expect($html)->toContain('ticket-v2-card','APT-TEST','Pending','Requested');
});

it('loads the PUP logo from HTTPS without attaching it to emails',function(){
 config(['mail.default'=>'array']);
 \App\Support\OfficeMail::send('visitor@gmail.com','Your verification code','Enter your code.','123456');
 $message=Mail::mailer('array')->getSymfonyTransport()->messages()->last()->getOriginalMessage();
 expect($message->getHtmlBody())->toContain('https://oss.uniserve.vercel.app/User/pup.jpg')->not->toContain('cid:');
 expect($message->getAttachments())->toHaveCount(0);
});
