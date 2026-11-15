<?php
namespace App\Console\Commands;
use App\Support\DatabaseBackup;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

class RestoreEncryptedBackup extends Command
{
    protected $signature='backup:restore {file} {--verify : Verify decryption and schema without changing records}';
    protected $description='Verify or restore an encrypted UniServe application database backup';
    public function handle():int
    {
        try {
            $backup=json_decode(file_get_contents($this->argument('file')),true,512,JSON_THROW_ON_ERROR);
            $tables=DatabaseBackup::decode($backup,!$this->option('verify'));
            if($this->option('verify')) {
                $complete=!array_diff(DatabaseBackup::tables(),array_keys($tables));
                $this->info(($complete?'Complete':'Partial legacy').' backup decrypts and columns match. This is not a restore rehearsal. No records changed.');
                return self::SUCCESS;
            }
            if(!$this->confirm('This replaces the configured database. Have you saved a backup, stopped API writes, scheduler and all queue workers, and preserved the original APP_KEY?')) return self::FAILURE;
            $file=Cache::lock('backup-restore-lock',300)->block(5,fn()=>DatabaseBackup::restore($tables,(object)['id'=>null,'full_name'=>'System operator']));
            Cache::forever('system:credential-epoch',(string)Str::uuid());
            $this->info('Restored; pending notification emails are paused. Recovery file: '.$file.'. Sign in again and check records before restarting services.');
            return self::SUCCESS;
        } catch(\Throwable $e) {
            report($e);
            $this->error('Restore refused or rolled back. Check file, original application key, complete tables, matching schema and private storage.');
            return self::FAILURE;
        }
    }
}
