<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

final class VisitId
{
    public static function next(): string
    {
        do {
            $id = 'VIS-'.str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
            $queueColumn = Schema::hasColumn('queues', 'visit_id') ? 'visit_id' : 'portal_payload->visitId';
            $exists = DB::table('queues')->where($queueColumn, $id)->exists()
                || DB::table('shared_appointments')->where('visit_id', $id)->exists();
        } while ($exists);

        return $id;
    }
}
