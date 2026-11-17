<?php
namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use App\Support\SystemAudit;

class ResetStaffMfa extends Command
{
    protected $signature='security:reset-mfa {username}';
    protected $description='Emergency MFA reset from a trusted server console when the authenticator and recovery codes are lost';
    public function handle(): int
    {
        $user=DB::table('staff_users')->where('username',$this->argument('username'))->first();
        if(!$user){$this->error('Staff account not found.');return self::FAILURE;}
        if(!$this->confirm('Disable two-step sign-in for this account? This is an audited emergency recovery action.',false))return self::FAILURE;
        DB::table('staff_users')->where('id',$user->id)->update(['mfa_version'=>bin2hex(random_bytes(16)),'mfa_secret'=>null,'mfa_recovery_codes'=>null,'mfa_last_step'=>null]);
        \App\Support\TrustedDevices::revokeAll($user->id);
        SystemAudit::record(null,'Authentication','Emergency console MFA reset',$user->id);
        $this->info('MFA disabled. Existing MFA-bound tokens are invalid. Sign in and enroll a new authenticator.');
        return self::SUCCESS;
    }
}
