<?php
namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\{Cache, DB, Schema, Storage};

class SystemReadiness extends Command
{
    protected $signature='system:readiness';
    protected $description='Check backend deployment prerequisites without printing secrets or changing application records';
    public function handle(): int
    {
        $rows=[];$failed=0;
        $add=function($label,$ok,$note)use(&$rows,&$failed){$rows[]=[$label,$ok?'PASS':'CHECK',$note];if(!$ok)$failed++;};
        $add('Debug output',!config('app.debug'),'APP_DEBUG must be false on the hosted API.');
        $add('Application key',(bool)config('app.key'),'Preserve the existing key; never regenerate it for a deployment.');
        $add('Shared cache',in_array(config('cache.default'),['database','redis']),'Use persistent shared database or Redis cache across API and jobs.');
        try { DB::select('SELECT 1');$add('Database',true,'Connection succeeded.'); }
        catch(\Throwable $e){$add('Database',false,'Check database credentials and reachability.');}
        try {$add('Security migration',Schema::hasColumn('staff_users','mfa_secret'),'Run php artisan migrate --force after preserving a compatible pre-upgrade backup.');}
        catch(\Throwable $e){$add('Security migration',false,'Unable to inspect schema.');}
        foreach(['scheduler','worker'] as $service){
            try {$last=Cache::get('system:'.$service.'-heartbeat');$fresh=$last&&\Carbon\CarbonImmutable::parse($last)->gt(now()->subMinutes(3));$add(ucfirst($service).' heartbeat',(bool)$fresh,'Run the matching host job and recheck within three minutes.');}
            catch(\Throwable $e){$add(ucfirst($service).' heartbeat',false,'Shared heartbeat cache unavailable.');}
        }
        $path='readiness-probes/'.bin2hex(random_bytes(12)).'.txt';
        try {$disk=Storage::disk('local');$written=$disk->put($path,'probe');$add('Private storage',$written&&$disk->get($path)==='probe','Read/write probe only; persistence across deployments is not proven.');}
        catch(\Throwable $e){$add('Private storage',false,'Private API storage is not readable/writable.');}
        finally {try{Storage::disk('local')->delete($path);}catch(\Throwable $e){}}
        $this->table(['Check','Result','Meaning'],$rows);
        $this->warn('Still verify: mounted persistent storage survives a redeploy, off-server backup copies, a separate restore rehearsal, actual email receipt, HTTPS API URL and exact frontend CORS origin. This command does not certify those checks.');
        return $failed?self::FAILURE:self::SUCCESS;
    }
}
