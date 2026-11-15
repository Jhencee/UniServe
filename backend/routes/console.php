<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Schedule::call(fn()=>\Illuminate\Support\Facades\Cache::put('system:scheduler-heartbeat',now()->toIso8601String(),600))->name('system-heartbeat')->everyMinute();
Schedule::command('backup:create')->dailyAt('02:00')->timezone('Asia/Manila')->withoutOverlapping(60)->when(fn()=>config('backups.scheduled',false));
Schedule::command('backup:prune-previews')->hourly()->withoutOverlapping();

Schedule::command('notifications:send')->everyMinute()->withoutOverlapping();
Schedule::command('appointments:no-shows')->everyMinute()->withoutOverlapping();
Schedule::command('confidential:expire')->everyMinute()->withoutOverlapping();
Schedule::command('walk-ins:notify-cutoff')->everyMinute()->withoutOverlapping();
Schedule::command('queue:close-previous-day')->everyMinute()->withoutOverlapping();

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::command('appointments:review-pending')->everyMinute()->withoutOverlapping();
