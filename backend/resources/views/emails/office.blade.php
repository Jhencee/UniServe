<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#fff;font-family:Arial,sans-serif;color:#243040">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff">
<tr><td style="padding:0 0 16px;border-bottom:1px solid #e4e7ec;color:#600000"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:10px;vertical-align:middle;width:64px"><img src="{{ config('mail.logo_url') }}" alt="UniServe logo" width="64" height="64" style="display:block;width:64px;height:64px;object-fit:contain;border:0"></td><td style="vertical-align:middle"><div style="font-family:Arial,sans-serif;font-size:22px;line-height:26px;font-weight:bold">UniServe</div><div style="font-size:12px;line-height:18px;margin-top:3px;color:#475467">PUP Santa Maria<br>Office of Student Services</div></td></tr></table></td></tr>
@php
    $greeting = null;
    if (preg_match('/\A(Hi|Hello|Dear)[ \t]+([^\r\n]+),[ \t]*(?:\r?\n)+/u', $body, $match)) {
        $greeting = ['salutation' => $match[1], 'name' => $match[2]];
        $body = ltrim(substr($body, strlen($match[0])));
    }
@endphp
<tr><td style="padding:20px 0"><h1 style="margin:0 0 12px;font-family:Georgia,serif;font-size:21px;color:#600000">{{ $title }}</h1>
@if($greeting)<p style="margin:0 0 10px;font-size:14px;line-height:1.6">{{ $greeting['salutation'] }} <strong>{{ $greeting['name'] }}</strong>,</p>@endif
@if($body !== '')<div style="font-size:14px;line-height:1.6">{!! nl2br(e($body)) !!}</div>@endif
@if($code)<div style="margin:18px 0 12px;padding:10px 0;text-align:center;font-size:28px;font-weight:bold;letter-spacing:6px;color:#800000">{{ $code }}</div><p style="font-size:13px;color:#667085">{{ $codeNotice ?? 'This code expires in five minutes. Never share it with anyone.' }}</p>@endif
@if($details)<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0">@foreach($details as $label=>$value)@if($label !== 'Request reference')<tr><td style="padding:4px 14px 4px 0;font-size:14px;color:#667085;vertical-align:top;width:72px">{{ $label }}</td><td style="padding:4px 0;font-size:14px;font-weight:bold;color:#243040;overflow-wrap:anywhere">{{ $value }}</td></tr>@endif @endforeach</table>@endif
@if(isset($details['Request reference']))<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;border:1px solid #e4e7ec;border-left:3px solid #800000;background:#f9f7f7"><tr><td style="padding:12px 14px"><div style="font-size:12px;color:#667085">Request reference</div><div style="margin-top:4px;font-size:17px;font-weight:bold;letter-spacing:.4px;color:#800000;overflow-wrap:anywhere">{{ $details['Request reference'] }}</div></td></tr></table>@endif
@if($pickup ?? false)
<h2 style="margin:20px 0 10px;font-size:15px;color:#600000">{{ ($pickupHard ?? false)?'Collect your hard copy':'Choose how to receive your document' }}</h2>
<ol style="margin:0;padding-left:20px;font-size:14px;line-height:1.6;color:#243040">
@if($pickupHard ?? false)
<li style="padding:0 0 8px">Open <strong>Check My Visit</strong> and enter your <strong>Visit ID</strong>.</li>
<li style="padding:0 0 8px">Join the pickup queue before coming to OSS.</li>
<li style="padding:0 0 8px">Bring your <strong>Visit ID</strong> and a <strong>valid ID</strong>.</li>
@else
<li style="padding:0 0 8px">Open <strong>Check My Visit</strong> and enter your <strong>Visit ID</strong>.</li>
<li style="padding:0 0 8px">Choose <strong>Hard copy</strong> to collect it at OSS, or <strong>Soft copy</strong> to receive it by email.</li>
<li style="padding:0 0 8px">For a hard copy, join the pickup queue before coming to OSS and bring your <strong>Visit ID</strong> and a <strong>valid ID</strong>. For a soft copy, OSS will email it to your verified address after processing.</li>
@endif
</ol>
@unless($pickupHard ?? false)<p style="margin:8px 0 0;font-size:13px;line-height:1.6;color:#667085">Check My Visit will show your next step after you choose.</p>@endunless
<p style="margin:16px 0 0;font-size:14px;color:#243040">Office of Student Services</p>
@endif
@if($closing)<div style="font-size:14px;line-height:1.6">{!! nl2br(e($closing)) !!}</div>@endif
@if($rules)<h2 style="margin:16px 0 6px;font-size:15px;color:#600000">Arrival guidelines</h2><ul style="margin:0;padding-left:20px;font-size:13px;line-height:1.6;color:#475467">@foreach($rules as $rule)<li style="margin-bottom:4px">{{ $rule }}</li>@endforeach</ul><p style="margin:14px 0 0;font-size:14px;color:#243040">Office of Student Services</p>@endif
</td></tr><tr><td style="padding:12px 0;border-top:1px solid #e4e7ec;font-size:11px;line-height:1.5;color:#667085">This is an automated UniServe email. If you did not request it, you can ignore it.</td></tr>
</table></td></tr></table></body></html>
