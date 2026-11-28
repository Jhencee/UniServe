<?php
namespace App\Support;

use Illuminate\Support\Facades\{Crypt,DB,Schema};
use RuntimeException;

final class TransactionCode
{
    private array $used = [];

    public function __construct(array $reserved = [])
    {
        foreach ($reserved as $code) {
            if (is_string($code) && preg_match('/^OSS-\d{6}$/', $code)) $this->used[$code] = true;
        }
    }

    public static function fromDatabase(): self
    {
        $codes = [];
        if (Schema::hasTable('shared_transactions')) {
            foreach (DB::table('shared_transactions')->get(['payload']) as $row) {
                $record = json_decode(Crypt::decryptString($row->payload), true);
                if (is_array($record) && isset($record['code'])) $codes[] = $record['code'];
            }
        }
        return new self($codes);
    }

    public function reserve(?string $code): bool
    {
        if (!is_string($code) || !preg_match('/^OSS-\d{6}$/', $code) || isset($this->used[$code])) return false;
        $this->used[$code] = true;
        return true;
    }

    public function next(): string
    {
        if (count($this->used) >= 1000000) throw new RuntimeException('No six-digit OSS record codes remain.');
        do {
            $code = 'OSS-'.str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        } while (isset($this->used[$code]));
        $this->used[$code] = true;
        return $code;
    }
}
