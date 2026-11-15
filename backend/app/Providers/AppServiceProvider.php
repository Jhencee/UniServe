<?php

namespace App\Providers;

use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        \Illuminate\Support\Facades\Queue::looping(function(){
            try { \Illuminate\Support\Facades\Cache::put('system:worker-heartbeat',now()->toIso8601String(),600); }
            catch (\Throwable $e) { report($e); }
        });
    }
}
