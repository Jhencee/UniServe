<?php
namespace App\Http\Controllers;

use App\Support\{StaffAuth,SystemAudit,DatabaseBackup};
use Illuminate\Http\Request;
use Illuminate\Support\Facades\{Cache,DB,Storage};
use Illuminate\Support\Str;

class BackupController extends Controller
{
    private function decode(array $backup):array { return DatabaseBackup::decode($backup); }

    public function export(Request $request) {
        $actor=StaffAuth::user($request,'SUPER_ADMIN');
        [$backup,$meta]=Cache::lock('backup-restore-lock',300)->block(5,function()use($actor){
            $backup=DatabaseBackup::snapshot();
            abort_if(strlen(json_encode($backup))>28*1024*1024,413,'This backup exceeds the browser restore limit. Use backup:create on the API server and follow the documented offline recovery procedure.');
            return [$backup,DatabaseBackup::save($backup,'download',$actor)];
        });
        SystemAudit::record($actor,'Data','Created verified encrypted database backup',$meta['id']);
        return response()->json($backup)->header('Cache-Control','no-store');
    }

    public function history(Request $request) {
        StaffAuth::user($request,'SUPER_ADMIN');
        $restores=DB::table('system_audit')->where('source','server')->where('category','Data')
            ->whereIn('action',['Restored encrypted database backup','Encrypted database backup restored'])
            ->orderByDesc('created_at')->limit(20)->get(['actor_name','created_at','target','action']);
        return response()->json(['backups'=>DatabaseBackup::history(),'restores'=>$restores,'historyLimit'=>20,'schedule'=>['enabled'=>(bool)config('backups.scheduled',false),'time'=>'02:00','timezone'=>'Asia/Manila'],'scope'=>'Latest 20 saved backup manifests and latest 20 retained successful restore events.'])->header('Cache-Control','no-store');
    }

    public function download(Request $request,string $id) {
        $actor=StaffAuth::user($request,'SUPER_ADMIN');
        $saved=DatabaseBackup::read($id);
        SystemAudit::record($actor,'Data','Downloaded server recovery backup',$id);
        return response()->json($saved['backup'])->header('Cache-Control','no-store');
    }

    public function preview(Request $request)
    {
        $actor=StaffAuth::user($request,'SUPER_ADMIN');
        $data=$request->validate(['backup'=>'required|array','backup.format'=>'required|string','backup.encrypted'=>'required|string|max:30000000','backup.createdAt'=>'required|date']);
        $tables=$this->decode($data['backup']);
        $token=(string)Str::uuid();
        // Store only a small token reference in cache: database cache values may be smaller than a backup.
        $path='backup-previews/'.$token.'.json';
        abort_unless(Storage::disk('local')->put($path,json_encode($data['backup'],JSON_THROW_ON_ERROR)),500,'Could not stage the backup preview in private storage.');
        Cache::put('backup-restore:'.$token,['actor'=>$actor->id,'path'=>$path],600);
        return response()->json(['token'=>$token,'createdAt'=>$data['backup']['createdAt'],'tables'=>collect($tables)->map(fn($rows,$table)=>['table'=>$table,'backupRows'=>count($rows),'currentRows'=>DB::table($table)->count()])->values(),'message'=>'Records in the listed tables will be replaced. A recovery backup will be saved first. Restored pending emails will be paused to prevent duplicate delivery. You must sign in again using an account from this backup.']);
    }

    public function restore(Request $request)
    {
        $actor=StaffAuth::user($request,'SUPER_ADMIN');
        \App\Support\StaffSessions::requireConfirmation($request);
        $data=$request->validate(['token'=>'required|uuid','confirmation'=>'required|in:RESTORE']);
        return Cache::lock('backup-restore-lock',300)->block(5,function()use($data,$actor){
            $key='backup-restore:'.$data['token'];$preview=Cache::get($key);
            abort_unless($preview&&$preview['actor']===$actor->id,422,'Preview expired. Select your backup again.');
            abort_unless(Storage::disk('local')->exists($preview['path']),422,'Preview file expired or is unavailable on this API host. Select the backup again.');
            $tables=$this->decode(json_decode(Storage::disk('local')->get($preview['path']),true,512,JSON_THROW_ON_ERROR));
            $recovery=DatabaseBackup::restore($tables,$actor);
            Cache::forever('system:credential-epoch',(string)Str::uuid());
            Cache::forget($key);
            Storage::disk('local')->delete($preview['path']);
            return response()->json(['restored'=>true,'recoveryBackup'=>$recovery]);
        });
    }
}
