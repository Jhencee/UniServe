<?php
namespace App\Support;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\{DB, Crypt};

class VisitProcess
{
    public static function reviewDeadline(object $row): CarbonImmutable
    {
        $created = CarbonImmutable::parse($row->created_at, config('app.timezone'))->setTimezone('Asia/Manila');
        $deadline = $created->addHours(24);
        if ($row->date && $row->time) {
            $slot = CarbonImmutable::parse($row->date.' '.$row->time, 'Asia/Manila');
            if ($slot < $deadline) $deadline = $slot;
        }
        return $deadline;
    }

    public static function notify(object $row, string $kind, string $message): void
    {
        $a = json_decode(Crypt::decryptString($row->payload), true);
        if (empty($a['email'])) return;
        DB::table('notification_outbox')->insertOrIgnore(PrivateNotification::fields(
            $a['email'], 'Your OSS request: '.$message,
            "Hi ".$a['name'].",\n\n".$message."\nOpen My Visit for the latest details and next steps.\nReference: ".$row->visit_id."\n\nOffice of Student Services"
        ) + ['visit_id'=>$row->visit_id, 'scheduled_at'=>now(), 'send_at'=>now(), 'kind'=>$kind,
            'dedup_key'=>hash('sha256', $kind.'|'.$row->id.'|'.$row->revision), 'actor_id'=>'system', 'created_at'=>now(), 'updated_at'=>now()]);
    }

    public static function expireRequests(): int
    {
        $count = 0;
        foreach (DB::table('shared_appointments')->where('status', 'Requested')->whereNotNull('date')->get(['id']) as $candidate) {
            $count += DB::transaction(function () use ($candidate) {
                DB::table('office_calendar')->where('id', 1)->lockForUpdate()->first();
                $row = DB::table('shared_appointments')->where('id', $candidate->id)->lockForUpdate()->first();
                if (!$row || $row->status !== 'Requested' || !$row->date || !$row->time) return 0;
                $slot = CarbonImmutable::parse($row->date.' '.$row->time, 'Asia/Manila');
                if ($slot > CarbonImmutable::now('Asia/Manila')) return 0;
                $a = json_decode(Crypt::decryptString($row->payload), true);
                $a['scheduleHistory'][] = ['date'=>$row->date, 'time'=>$row->time, 'status'=>'Requested', 'changedAt'=>now()->toIso8601String(), 'changedBy'=>'System scheduler'];
                $a['rescheduleRequested'] = true;
                $a['rescheduleReason'] = 'The requested time passed before staff confirmation. Please arrange a new schedule.';
                $a['reviewExpiredAt'] = now()->toIso8601String();
                // Keep the existing supported Requested state, but release the expired slot.
                DB::table('shared_appointments')->where('id', $row->id)->update(['date'=>null, 'time'=>null, 'revision'=>$row->revision+1, 'payload'=>Crypt::encryptString(json_encode($a)), 'updated_at'=>now()]);
                self::notify(DB::table('shared_appointments')->where('id', $row->id)->first(), 'request-expired', 'Your unconfirmed request needs a new schedule. You have not been marked as a no-show.');
                SystemAudit::record(null, 'Appointments', 'Unconfirmed appointment needs rescheduling', $row->visit_id);
                return 1;
            });
        }
        return $count;
    }
}
