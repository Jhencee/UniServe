<?php
namespace App\Support;

use Illuminate\Support\Facades\{Cache,DB};

class CaseAccess
{
    public static function canEdit(object $user, string $id): bool
    {
        $case = DB::table('confidential_cases')->where('id', $id)->first();
        return $case && (($user->confidential_approver ?? false) || $case->assigned_admin_id === $user->id)
            && self::canView($user, $id);
    }

    public static function canEditAppointment(object $user, object $appointment): bool
    {
        if (!ServicePrivacy::confidential($appointment->service_key)) return true;
        if ($appointment->queue_id) {
            $row = DB::table('queues')->where('id', $appointment->queue_id)->first();
            $queue = $row ? QueueData::read($row->portal_payload) : [];
            $caseId = $queue['transactionId'] ?? DB::table('shared_transactions')->where('queue_id', $appointment->queue_id)->value('id');
            if ($caseId) return self::canEdit($user, $caseId);
            if (($queue['status'] ?? '') === 'Completed') return false;
        }
        return $appointment->status !== 'Completed' && (bool) ($user->confidential_access ?? false);
    }

    public static function canView(object $user, string $id): bool
    {
        $case = DB::table('confidential_cases')->where('id', $id)->first();
        if (!$case) return false;
        $permitted = ($user->confidential_approver ?? false)
            || $case->assigned_admin_id === $user->id
            || DB::table('confidential_requests')->where('case_id', $id)
                ->where('requester_id', $user->id)->where('status', 'Approved')
                ->where('expires_at', '>', now())->exists();
        return $permitted && (bool) Cache::get('conf-unlock:'.$user->id.':'.$id.':view');
    }

    public static function canViewAppointment(object $user, object $appointment): bool
    {
        if (!ServicePrivacy::confidential($appointment->service_key)) return true;
        if ($appointment->queue_id) {
            $row = DB::table('queues')->where('id', $appointment->queue_id)->first();
            $queue = $row ? QueueData::read($row->portal_payload) : [];
            $caseId = $queue['transactionId'] ?? DB::table('shared_transactions')->where('queue_id', $appointment->queue_id)->value('id');
            if ($caseId) return self::canView($user, $caseId);
            // Completed confidential visits must never fall back to intake permission.
            if ($appointment->status === 'Completed' || ($queue['status'] ?? '') === 'Completed') return false;
        }
        if ($appointment->status === 'Completed') return false;
        return (bool) ($user->confidential_access ?? false);
    }
}
