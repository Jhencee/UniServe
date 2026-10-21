<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Schedule::command('notifications:send')->everyMinute()->withoutOverlapping();
Schedule::command('appointments:no-shows')->everyMinute()->withoutOverlapping();
Schedule::command('confidential:expire')->everyMinute()->withoutOverlapping();
Schedule::command('walk-ins:notify-cutoff')->everyMinute()->withoutOverlapping();
Schedule::command('queue:close-previous-day')->everyMinute()->withoutOverlapping();

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');
