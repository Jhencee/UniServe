@php
 $appointment=($ticket['source']??'')==='Appointment';
 $confirmed=$appointment && !empty($ticket['date']) && !empty($ticket['time']);
 $reference=$ticket['number']??$ticket['visitId'];
 $service=$ticket['serviceLabel']??$ticket['service']??'';
 $created=\Carbon\CarbonImmutable::parse($ticket['createdAt'])->setTimezone('Asia/Manila');
 $expiry=$appointment ? (!empty($ticket['date']) ? \Carbon\CarbonImmutable::parse($ticket['date'],'Asia/Manila')->endOfDay() : null) : $created->endOfDay();
@endphp
<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>UniServe ticket {{ $reference }}</title><style>
@media screen and (max-width:480px) {
.email-outer { padding:12px 6px !important; }
.ticket-header { padding:16px 12px 10px !important; }
.ticket-bottom { padding:18px 14px !important; }
.ticket-body { padding:10px 12px 22px !important; }
.ticket-logo { width:28px !important;height:28px !important; }
.ticket-logo-cell { width:35px !important; }
.ticket-university { font-size:10px !important; }
.ticket-campus { font-size:8px !important; }
.ticket-issued { width:70px !important;font-size:8px !important; }
.ticket-number { font-size:32px !important;letter-spacing:0 !important; }
.ticket-service { font-size:11px !important; }
.ticket-status { font-size:10px !important; }
.ticket-value { font-size:11px !important;margin-top:7px !important; }
.ticket-label { font-size:8px !important;letter-spacing:.2px !important; }
.ticket-stub { width:36px !important; }
.ticket-stub-text { font-size:10px !important;padding:12px 6px !important; }
.ticket-expiry { font-size:10px !important; }
.ticket-fine { font-size:9px !important; }
}
</style></head>
<body style="margin:0;background:#f7f7f8;color:#252525;font-family:Arial,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" class="email-outer" style="padding:24px 12px">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;table-layout:fixed;background:#fff;border:1px solid #800000"><tr><td style="vertical-align:top">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
<tr><td class="ticket-header" style="background:#800000;color:#fff;padding:22px 24px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="table-layout:fixed"><tr><td class="ticket-logo-cell" width="48" style="width:48px;vertical-align:top"><img class="ticket-logo" src="cid:uniserve-pup" alt="PUP" width="38" height="38" style="display:block;border-radius:50%"></td><td style="vertical-align:top;padding-right:8px"><strong class="ticket-university" style="display:block;font-family:Georgia,serif;font-size:12px;line-height:1.4">Polytechnic University of the Philippines</strong><div class="ticket-campus" style="margin-top:3px;font-size:10px;line-height:1.5;letter-spacing:.3px"><div style="display:block;white-space:nowrap">SANTA MARIA CAMPUS</div><div style="display:block;white-space:nowrap">OFFICE OF STUDENT SERVICES</div></div></td><td class="ticket-issued" width="100" style="width:100px;vertical-align:top;font-family:monospace;font-size:10px;line-height:1.6;text-align:right">Issued<br>{{ $created->format('Y-m-d') }}<br>{{ $created->format('g:i A') }}</td></tr></table></td></tr>
<tr><td align="center" class="ticket-body" style="background:#800000;color:#fff;padding:14px 20px 28px"><p class="ticket-status" style="font-size:11px;line-height:1.5;font-weight:bold;margin:0 0 12px">{{ $appointment ? ($confirmed ? ($emailTitle??'Appointment confirmed') : 'Awaiting schedule confirmation') : 'You are in the queue. Wait for OSS to call you.' }}</p><div class="ticket-number" style="font-size:44px;font-weight:bold;letter-spacing:1px;overflow-wrap:anywhere">{{ $reference }}</div><p class="ticket-service" style="font-size:13px;font-weight:bold;margin:10px 0 16px;text-transform:uppercase">{{ $service }}</p><div style="font-size:12px">{{ $ticket['visitorType']??$ticket['type']??'' }}{{ !empty($ticket['isPWD']) ? ' - PWD priority' : '' }}{{ !empty($ticket['isSenior']) ? ' - Senior citizen' : '' }}</div></td></tr>
<tr><td class="ticket-bottom" style="padding:22px 24px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="width:50%;vertical-align:top;padding:0 12px 20px 0"><div class="ticket-label" style="font-size:9px;font-weight:bold;color:#800000;letter-spacing:.6px">VISIT ID</div><div class="ticket-value" style="font-size:12px;line-height:1.5;font-weight:bold;margin-top:9px;overflow-wrap:anywhere">{{ $ticket['visitId'] }}</div></td><td style="vertical-align:top;padding-bottom:20px"><div class="ticket-label" style="font-size:9px;font-weight:bold;color:#800000;letter-spacing:.6px">SERVICE</div><div class="ticket-value" style="font-size:12px;line-height:1.5;font-weight:bold;margin-top:9px">{{ $service }}</div></td></tr><tr><td style="vertical-align:top;padding-right:12px"><div class="ticket-label" style="font-size:9px;font-weight:bold;color:#800000;letter-spacing:.6px">{{ $appointment ? 'STATUS' : 'CHECKED-IN' }}</div><div class="ticket-value" style="font-size:12px;line-height:1.5;font-weight:bold;margin-top:9px">{{ $appointment ? $ticket['status'] : $created->format('g:i A') }}</div></td><td style="vertical-align:top"><div class="ticket-label" style="font-size:9px;font-weight:bold;color:#800000;letter-spacing:.6px">ENTRY METHOD</div><div class="ticket-value" style="font-size:12px;line-height:1.5;font-weight:bold;margin-top:9px">{{ $appointment ? ($confirmed ? 'Scheduled appointment' : 'Appointment request') : 'Walk-in' }}</div></td></tr></table>
@if($confirmed)<p style="margin:20px 0 0;font-size:12px;font-weight:bold;color:#800000">Scheduled: {{ \Carbon\CarbonImmutable::parse($ticket['date'].' '.$ticket['time'],'Asia/Manila')->format('M j, Y - g:i A') }}</p>@endif
<p class="ticket-expiry" style="font-size:11px;color:#800000;font-weight:bold;margin:22px 0 0">{{ $expiry ? 'Expires: '.$expiry->format('M j, Y - g:i A') : 'Validity: Awaiting schedule' }}</p>
<p class="ticket-fine" style="border-top:1px dashed #e5e7eb;padding-top:14px;margin:16px 0 0;font-size:11px;font-style:italic;line-height:1.6;color:#6b7280">{{ $appointment ? ($confirmed ? 'Show your Visit ID and required documents at the OSS counter. An Admin will check you in when you arrive.' : 'This is a request, not a confirmed booking. OSS will send your confirmed date and time.') : 'This pass is valid for the issue date only and is non-transferable. Please present it at the counter when your number is called.' }}</p></td></tr></table></td>
<td class="ticket-stub" width="50" align="center" style="width:50px;background:#800000;color:#fff;border-left:2px dashed #c98080;vertical-align:middle"><div class="ticket-stub-text" style="writing-mode:vertical-rl;text-orientation:mixed;font-family:monospace;font-size:11px;font-weight:bold;letter-spacing:1px;padding:16px 8px">{{ !empty($ticket['number']) ? 'QUEUE NO.' : 'VISIT ID' }} &nbsp; {{ $reference }} &nbsp; {{ !empty($ticket['number']) ? $ticket['visitId'] : '' }}</div></td></tr></table>
@if($confirmed && !empty($emailBody))
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin-top:22px;text-align:left"><tr><td style="padding:0 4px;font-size:13px;line-height:1.7;color:#475467">
@if(!empty($emailIntro))<p style="margin:0 0 16px">{!! nl2br(e($emailIntro)) !!}</p>@endif
@if(!empty($emailDetails))
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#faf6f6;border-left:3px solid #800000"><tr><td style="padding:16px 18px">
<h2 style="margin:0 0 10px;font-size:14px;color:#800000">Your appointment details</h2>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">
@foreach($emailDetails as $label=>$value)<tr><td style="padding:5px 12px 5px 0;width:72px;vertical-align:top;font-size:12px;color:#667085">{{ $label }}</td><td style="padding:5px 0;font-size:13px;line-height:1.5;font-weight:bold;color:#800000;overflow-wrap:anywhere">{{ $value }}</td></tr>@endforeach
</table></td></tr></table>
@endif
@if(!empty($emailClosing))<p style="margin:16px 0">{!! nl2br(e($emailClosing)) !!}</p>@endif
@if(!empty($emailRules))
<h2 style="margin:20px 0 10px;font-size:14px;color:#800000">Arrival guidelines</h2>
<ol style="margin:0;padding-left:22px;font-size:13px;line-height:1.7;color:#475467">@foreach($emailRules as $rule)<li style="padding-left:3px;margin-bottom:8px">{{ $rule }}</li>@endforeach</ol>
<p style="margin:16px 0 0;font-size:12px;color:#667085">Office of Student Services</p>
@endif
</td></tr></table>
@endif
<p style="max-width:580px;font-size:11px;line-height:1.6;color:#6b7280">This is the issued ticket; check UniServe for live status. A completed or cancelled visit is no longer valid.</p></td></tr></table></body></html>
