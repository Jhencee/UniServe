<?php
namespace App\Http\Controllers;

use App\Support\{StaffAuth, DatabaseBackup};
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{Cache, DB, Schema};

class SystemOversightController extends Controller
{
    public function index(Request $request)
    {
        StaffAuth::user($request,'SUPER_ADMIN');
        $audit=DB::table('system_audit');
        $server=(clone $audit)->where('source','server');
        $failed=(clone $server)->where('created_at','>=',now()->subDay())
            ->where(fn($q)=>$q->where('action','like','%failed%')->orWhere('action','Access denied')->orWhere('action','like','%blocked%'))->count();
        $logins=(clone $server)->where('action','Signed in')->whereNotNull('actor_id')
            ->select('actor_id')->selectRaw('MAX(created_at) AS last_login')->groupBy('actor_id')->pluck('last_login','actor_id');
        $accounts=DB::table('staff_users')->whereIn('role',['ADMIN','SUPER_ADMIN'])->orderBy('full_name')->get()->map(function($u)use($logins){
            $last=$logins[$u->id]??null;
            return ['id'=>$u->id,'name'=>$u->full_name,'role'=>$u->role,'active'=>(bool)$u->is_active,
                'confidentialAccess'=>(bool)$u->confidential_access,'headAdmin'=>false,
                'lastSignIn'=>$last,'reviewInactive'=>(bool)$u->is_active && $last && \Carbon\CarbonImmutable::parse($last)->lt(now()->subDays(90)),
                'loginEvidence'=>$last?'server-audit':'No retained successful sign-in event'];
        });
        $recentChanges=(clone $server)->whereIn('category',['Accounts','Settings'])->orderByDesc('created_at')->limit(12)
            ->get(['actor_name','category','action','created_at','changes'])->map(function($row){
                // Only account/configuration field labels and values; never visitor records or credentials.
                $changes=json_decode($row->changes,true)??[];
                $row->changes=array_values(array_filter($changes,fn($c)=>!preg_match('/password|token|secret|key/i',$c['field']??'')));
                return $row;
            });
        $malformed=0;
        foreach((clone $audit)->orderByDesc('created_at')->limit(1000)->get(['changes','created_at']) as $entry){
            if(!is_array(json_decode($entry->changes,true))) $malformed++;
        }
        $settings=json_decode(DB::table('shared_system_settings')->where('id',1)->value('payload')??'{}',true);
        $scheduler=$this->heartbeat('system:scheduler-heartbeat');
        $worker=$this->heartbeat('system:worker-heartbeat');
        $smtp=config('mail.default')==='smtp' && config('mail.mailers.smtp.host') && config('mail.mailers.smtp.username') && config('mail.mailers.smtp.password');
        $mailer=config('mail.default');
        $mail=['state'=>$smtp?'configured':'unverified','detail'=>$smtp?'SMTP configured; delivery is not proven by configuration.':'Mail delivery has not been verified. Check the configured transport.','transport'=>$mailer,
            'lastSent'=>DB::table('notification_outbox')->where('status','sent')->max('sent_at'),
            'failed'=>DB::table('notification_outbox')->where('status','failed')->count()];
        $backups=DatabaseBackup::history();
        return response()->json(['checkedAt'=>now()->toIso8601String(),
            'security'=>['failedOrDenied24h'=>$failed,'structuralIssues'=>$malformed,'auditCheck'=>'Structure of the most recent 1,000 audit entries only. Not a cryptographic tamper-proof check.'],
            'accounts'=>$accounts,'changes'=>$recentChanges,
            'configuration'=>['maintenance'=>(bool)($settings['maintenanceMode']??false),'sessionMinutes'=>$settings['sessionTimeout']??30],
            'health'=>['api'=>['state'=>'responding','detail'=>'Authenticated API request succeeded.'],
                'database'=>['state'=>'responding','detail'=>'Database queries completed.'],
                'scheduler'=>$scheduler,'worker'=>$worker,'mail'=>$mail,
                'queue'=>['pending'=>Schema::hasTable('jobs')?DB::table('jobs')->count():null,'failed'=>Schema::hasTable('failed_jobs')?DB::table('failed_jobs')->count():null],
                'realtime'=>['state'=>config('broadcasting.default')==='reverb'?'configured':'disabled','detail'=>'Browser connection is checked separately.']],
            'backups'=>['latest'=>$backups[0]??null,'scheduled'=>(bool)config('backups.scheduled',false),'storage'=>'API server private storage; persistent volume and off-server copy required.',
                'restoreTested'=>false,'scope'=>'Application database, including encrypted document payloads. Excludes APP_KEY, deployment secrets, runtime jobs/cache and application source.']])
            ->header('Cache-Control','no-store');
    }

    private function heartbeat(string $key): array
    {
        try {
            $last=Cache::get($key);
            $fresh=$last && \Carbon\CarbonImmutable::parse($last)->gt(now()->subMinutes(3));
            return ['state'=>$fresh?'observed':'unverified','lastObserved'=>$last,'detail'=>$fresh?'Heartbeat observed within the last 3 minutes.':'No recent heartbeat. Confirm the service is running and uses shared persistent cache.'];
        } catch(\Throwable $e) { return ['state'=>'unverified','lastObserved'=>null,'detail'=>'Heartbeat cache unavailable.']; }
    }
}
