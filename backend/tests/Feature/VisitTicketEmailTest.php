<?php
use App\Jobs\SendVisitTicket;
use Illuminate\Support\Facades\Mail;

it('sends a branded walk-in ticket with the issued reference',function(){
    $ticket=['email'=>'visitor@gmail.com','visitId'=>'VIS-ABC12345','number'=>'A-001','serviceLabel'=>'Scholarship','visitorType'=>'Student','source'=>'Walk-in','status'=>'Waiting','createdAt'=>'2026-10-19T10:00:00+08:00'];
    Mail::shouldReceive('html')->once()->andReturnUsing(function($html,$callback){
        expect($html)->toContain('A-001','VIS-ABC12345','Scholarship','11:59 PM','Oct 19, 2026')->not->toContain('Philippine time','Download the attached');
        $message=Mockery::mock(\Illuminate\Mail\Message::class);
        $message->shouldReceive('embed')->once()->andReturn('cid:test-logo');
        $message->shouldReceive('html','to','subject')->andReturnSelf();
        $message->shouldNotReceive('attachData');
        $callback($message);
    });
    $job=new SendVisitTicket($ticket);
    expect($job->afterCommit)->toBeTrue();
    $job->handle();
});

it('labels appointment requests as awaiting confirmation and escapes ticket content',function(){
    $ticket=['email'=>'visitor@gmail.com','visitId'=>'VIS-ABC12345','service'=>'<script>alert(1)</script>','type'=>'Guest','source'=>'Appointment','status'=>'Requested','createdAt'=>'2026-10-19T10:00:00+08:00'];
    $html=view('emails.visit-ticket',['ticket'=>$ticket])->render();
    expect($html)->toContain('Awaiting schedule confirmation','not a confirmed booking','&lt;script&gt;')->not->toContain('<script>');
});

it('uses the maroon ticket for confirmed appointments with their scheduled date and expiry',function(){
    $ticket=['visitId'=>'VIS-CONFIRMED','source'=>'Appointment','service'=>'Good Moral Character','type'=>'Student','status'=>'Booked','date'=>'2026-10-21','time'=>'10:00','createdAt'=>'2026-10-20T08:00:00+08:00'];
    $html=\App\Support\OfficeMail::html('Appointment confirmation','Bring your documents.',null,$ticket);
    expect($html)->toContain('background:#800000','Appointment confirmation','Oct 21, 2026 - 10:00 AM','Oct 21, 2026 - 11:59 PM','Bring your documents.')
        ->not->toContain('Awaiting schedule confirmation','not a confirmed booking','Download the attached','Philippine time');
});

it('highlights schedule details and numbers arrival guidelines below the ticket',function(){
 $ticket=['visitId'=>'VIS-CONFIRMED','source'=>'Appointment','service'=>'Good Moral','type'=>'Student','status'=>'Booked','date'=>'2026-10-21','time'=>'10:00','createdAt'=>'2026-10-20T08:00:00+08:00'];
 $body="Hi Visitor,\n\nConfirmed.\n\nService: Good Moral\nDate: October 21, 2026\nTime: 10:00 AM\nVisit ID: VIS-CONFIRMED\n\nBring your documents.\n\nArrival guidelines\nShow your Visit ID.\nBring <original> documents.\n\nOffice of Student Services";
 $html=\App\Support\OfficeMail::html('Appointment confirmation',$body,null,$ticket);
 expect($html)->toContain('Your appointment details','<ol style=','Bring &lt;original&gt; documents.')->not->toContain('Bring <original>');
 expect(substr_count($html,'Arrival guidelines'))->toBe(1);
 expect(substr_count($html,'<li style='))->toBe(2);
});
