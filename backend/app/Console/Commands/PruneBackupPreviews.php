<?php
namespace App\Console\Commands;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;
class PruneBackupPreviews extends Command
{
    protected $signature='backup:prune-previews';
    protected $description='Remove expired temporary restore previews; never remove saved backups';
    public function handle():int
    {
        $disk=Storage::disk('local');
        foreach($disk->files('backup-previews') as $file) {
            if(preg_match('~^backup-previews/[0-9a-f-]{36}\.json$~D',$file) && $disk->lastModified($file)<time()-3600) $disk->delete($file);
        }
        return self::SUCCESS;
    }
}
