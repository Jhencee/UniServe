<?php
namespace App\Console\Commands;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use App\Support\SystemAudit;
class ExpireConfidentialApprovals extends Command
{
 protected $signature='confidential:expire';
 protected $description='Record expired confidential approvals once';
 public function handle():int{
  foreach(DB::table('confidential_requests')->where('status','Approved')->where('expires_at','<=',now())->pluck('id') as $id){
   DB::transaction(function()use($id){$row=DB::table('confidential_requests')->where('id',$id)->lockForUpdate()->first();if(!$row||$row->status!=='Approved'||$row->expires_at>now()->toDateTimeString())return;
    DB::table('confidential_requests')->where('id',$id)->update(['status'=>'Expired','updated_at'=>now()]);
    SystemAudit::record((object)['id'=>null,'full_name'=>'System'],'Confidential','Temporary access expired',$row->case_id,[['field'=>'Admin','from'=>'','to'=>DB::table('staff_users')->where('id',$row->requester_id)->value('full_name')??'Former Admin'],['field'=>'Access','from'=>'','to'=>$row->scope]]);
   });
  }return self::SUCCESS;
 }
}
