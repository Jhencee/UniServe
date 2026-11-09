<?php
namespace App\Console\Commands;

use Illuminate\Console\Command;

class ReviewPendingVisits extends Command
{
    protected $signature = 'appointments:review-pending';
    protected $description = 'Release elapsed unconfirmed slots and notify visitors without marking no-shows';

    public function handle(): int
    {
        $this->info(\App\Support\VisitProcess::expireRequests().' request(s) need a new schedule.');
        return self::SUCCESS;
    }
}
