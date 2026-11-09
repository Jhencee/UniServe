<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;margin:0 auto;border:1px solid #800000;background:#ffffff;font-family:Arial,sans-serif;color:#252525;table-layout:fixed;border-collapse:collapse">
<tr><td style="padding:22px;background:#800000;background-image:linear-gradient(160deg, #800000, #5c0000);color:#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed"><tr>
<td width="46" style="width:46px;vertical-align:top"><img src="{{ $logoSrc??'cid:uniserve-pup' }}" alt="PUP logo" width="36" height="36" style="display:block;width:36px;height:36px;border-radius:50%;border:0"></td>
<td style="vertical-align:top;padding-right:8px"><strong style="font-family:Georgia,serif;font-size:13px;line-height:1.4">Polytechnic University of the Philippines</strong><div style="font-size:9px;line-height:1.6;margin-top:3px;text-transform:uppercase">Santa Maria Campus<br>{{ $ticket['office']??'Office of Student Services' }}</div></td>
<td width="78" style="width:78px;vertical-align:top;text-align:right;font-family:monospace;font-size:9px;line-height:1.6">{{ $scheduled?'Issued':'Requested' }}<br>{{ $issued->format('M j, Y') }}<br>{{ $issued->format('g:i A') }}</td>
</tr></table>
<div style="text-align:center;padding-top:24px">
@unless($scheduled)<div class="ticket-v2-line">Awaiting schedule confirmation</div>@endunless
<div style="font-size:32px;line-height:1.3;font-weight:bold;margin-top:12px;word-break:break-word;overflow-wrap:anywhere">{{ $visitId??$reference }}</div>
<div style="font-size:12px;font-weight:bold;line-height:1.5;text-transform:uppercase;margin-top:10px">{{ $ticket['service']??$ticket['serviceLabel']??'' }}</div>
<div style="font-size:11px;line-height:1.5;margin-top:12px">{{ $visitor }}</div>
</div></td></tr>
<tr><td style="padding:22px;border-top:2px dashed #c08080">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed">
@foreach(array_chunk($fields,2,true) as $pair)
<tr>@foreach($pair as $label=>$value)<td width="50%" style="width:50%;vertical-align:top;padding:0 12px 18px 0"><div style="font-size:10px;font-weight:bold;letter-spacing:.6px;text-transform:uppercase;color:#800000">{{ $label }}</div><div style="margin-top:6px;font-size:13px;font-weight:bold;line-height:1.6;word-break:break-word">{{ $value }}</div></td>@endforeach</tr>
@endforeach
</table>
<p style="margin:0;padding-top:14px;border-top:1px dashed #e5e7eb;font-size:11px;line-height:1.6;font-style:italic;color:#6b7280">{{ $scheduled?'Show your Visit ID and required documents at the OSS counter. An Admin will check you in when you arrive. No queue number is issued for scheduled appointments.':'Your requested slot is pending staff approval. Wait for a confirmation email and Visit ID before travelling. Use your request reference to check for updates.' }}</p>
</td></tr>
<tr><td style="padding:12px 18px;background:#800000;color:#ffffff;border-top:2px dashed #c08080;text-align:center;font-size:11px;line-height:1.6;word-break:break-word"><strong>{{ $visitId?'Visit ID':'Request reference' }}: {{ $visitId??$reference }}</strong>@if($visitId)<br><span style="font-size:10px">Reference: {{ $reference }}</span>@endif</td></tr>
</table>
