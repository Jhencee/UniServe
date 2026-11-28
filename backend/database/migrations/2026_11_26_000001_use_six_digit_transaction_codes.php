<?php

use App\Support\TransactionCode;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\{Crypt,DB,Schema};

return new class extends Migration {
    public function up(): void
    {
        if (!Schema::hasTable('shared_transactions')) return;

        DB::transaction(function () {
            $rows = DB::table('shared_transactions')->get();
            $records = [];
            $reserved = [];

            foreach ($rows as $row) {
                $record = json_decode(Crypt::decryptString($row->payload), true);
                if (!is_array($record)) continue;
                $records[$row->id] = [$row, $record];
                if (isset($record['code'])) $reserved[] = $record['code'];
            }

            $codes = new TransactionCode($reserved);
            $seen = [];
            $changedCodes = [];
            $oldCodeCounts = [];

            foreach ($records as $id => [$row, $record]) {
                $oldCode = $record['code'] ?? null;
                if (is_string($oldCode)) $oldCodeCounts[$oldCode] = ($oldCodeCounts[$oldCode] ?? 0) + 1;

                if (is_string($oldCode) && preg_match('/^OSS-\d{6}$/', $oldCode) && !isset($seen[$oldCode])) {
                    $newCode = $oldCode;
                    $seen[$oldCode] = true;
                } else {
                    $newCode = $codes->next();
                    $record['code'] = $newCode;
                    DB::table('shared_transactions')->where('id', $id)->update(['payload' => Crypt::encryptString(json_encode($record))]);
                }

                if (Schema::hasTable('confidential_cases')) {
                    DB::table('confidential_cases')->where('id', $id)->update(['code' => $newCode]);
                }
                if (is_string($oldCode) && $oldCode !== $newCode) $changedCodes[$oldCode] = $newCode;
            }

            if (Schema::hasTable('system_audit')) {
                foreach ($changedCodes as $oldCode => $newCode) {
                    if (($oldCodeCounts[$oldCode] ?? 0) === 1) {
                        DB::table('system_audit')->where('target', $oldCode)->update(['target' => $newCode]);
                    }
                }
            }
        });
    }

    public function down(): void
    {
        // Codes cannot safely be restored because the previous values are not stored separately.
    }
};
