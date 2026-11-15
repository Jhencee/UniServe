<?php
namespace App\Console\Commands;

use App\Support\{DatabaseBackup, SystemAudit};
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;

class CreateDatabaseBackup extends Command
{
    protected $signature='backup:create';
    protected $description='Create and verify an encrypted application database backup in private API storage';
    public function handle():int
    {
        try {
            $meta=Cache::lock('backup-restore-lock',300)->block(5,function(){
                $backup=DatabaseBackup::snapshot();
                return DatabaseBackup::save($backup,'scheduled-or-operator');
            });
            SystemAudit::record(null,'Data','Created verified server database backup',$meta['id']);
            $this->info('Verified backup: '.$meta['id'].' ('.$meta['rows'].' application rows). Copy it off-server and retain the original APP_KEY separately.');
            return self::SUCCESS;
        } catch(\Throwable $e) {
            report($e);
            $this->error('Backup failed. Check private storage, database access and the application key. No successful backup is recorded.');
            return self::FAILURE;
        }
    }
}
