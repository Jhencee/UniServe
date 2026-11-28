<?php
namespace App\Support;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\{DB, Crypt, Schema};

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

    public static function followUpReminderKey(string $appointmentId, string $taskId, string $dueDate): string
    {
        return hash('sha256', 'follow-up-reminder|'.$appointmentId.'|'.$taskId.'|'.$dueDate);
    }

    public static function queueFollowUpReminders(): int
    {
        if (!Schema::hasTable('shared_appointments') || !Schema::hasTable('notification_outbox')) return 0;
        $now = CarbonImmutable::now('Asia/Manila');
        if ($now->hour < 9) return 0;
        $due = $now->addDay()->toDateString();
        $count = 0;
        DB::table('shared_appointments')->where('status','!=','Cancelled')->orderBy('id')->chunk(100, function ($rows) use ($due, &$count) {
            foreach ($rows as $row) {
                $appointment = json_decode(Crypt::decryptString($row->payload), true);
                if (empty($appointment['email'])) continue;
                $tasks = $appointment['followUpTasks'] ?? (empty($appointment['followUpTask']) ? [] : [$appointment['followUpTask']+['id'=>'legacy']]);
                foreach ($tasks as $task) {
                    if (!empty($task['completed']) || ($task['dueDate']??null)!==$due) continue;
                    $taskId = (string)($task['id']??'legacy');
                    $message = "Hello,\n\nYou have an incomplete follow-up action due tomorrow (".$due."). Open Check My Visit or Visit History in UniServe to see the action and its details.\n\nReference: ".$row->visit_id."\n\nOffice of Student Services";
                    $count += DB::table('notification_outbox')->insertOrIgnore(PrivateNotification::fields($appointment['email'], 'Follow-up action reminder', $message) + [
                        'visit_id'=>$row->visit_id, 'scheduled_at'=>now(), 'send_at'=>now(), 'kind'=>'follow-up-reminder',
                        'dedup_key'=>self::followUpReminderKey($row->id,$taskId,$due), 'actor_id'=>'system', 'created_at'=>now(), 'updated_at'=>now()
                    ]);
                }
            }
        });
        return $count;
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
