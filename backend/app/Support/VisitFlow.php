<?php

namespace App\Support;

use Illuminate\Support\Facades\{DB, Schema, Crypt};

class VisitFlow
{
    public static function settings(): array
    {
        return Schema::hasTable('shared_system_settings')
            ? (json_decode(DB::table('shared_system_settings')->where('id', 1)->value('payload'), true) ?? []) : [];
    }

    public static function requireIntake(): void
    {
        abort_if(self::settings()['maintenanceMode'] ?? false, 503, 'New requests are unavailable during maintenance. You can still check an existing visit.');
    }

    public static function requireCounter(object $actor, ?string $except = null): void
    {
        // Lock the staff row so simultaneous calls cannot claim two visitors.
        DB::table('staff_users')->where('id', $actor->id)->lockForUpdate()->first();
        if (self::settings()['allowParallelService'] ?? false) return;
        $active = DB::table('queues')->where('assigned_admin_id', $actor->id)->whereIn('status', ['Called', 'Serving']);
        if ($except) $active->where('id', '!=', $except);
        abort_if($active->exists(), 409, 'Finish, transfer, or mark your current visitor absent before calling another.');
    }

    public static function archiveStep(array &$q, object $actor, string $outcome): void
    {
        $q['serviceHistory'][] = [
            'serviceKey' => $q['serviceKey'] ?? 'other', 'serviceLabel' => $q['serviceLabel'] ?? 'Other',
            'calledAt' => $q['calledAt'] ?? null, 'servingAt' => $q['servingAt'] ?? null,
            'endedAt' => now()->toIso8601String(), 'outcome' => $outcome,
            'adminName' => $q['assignedAdminName'] ?? $actor->full_name,
        ];
    }

    public static function closeLog(array $q, string $outcome): void
    {
        if (!Schema::hasTable('shared_visitor_log')) return;
        $row = DB::table('shared_visitor_log')->where('queue_id', $q['id'])->first();
        if (!$row) return;
        $log = json_decode(Crypt::decryptString($row->payload), true);
        $log['timeOut'] ??= now()->toIso8601String();
        $log['outcome'] = $outcome;
        $log['serviceHistory'] = $q['serviceHistory'] ?? [];
        DB::table('shared_visitor_log')->where('id', $row->id)->update(['payload' => Crypt::encryptString(json_encode($log)), 'updated_at' => now()]);
    }
}
