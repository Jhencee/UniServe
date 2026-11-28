<?php
namespace App\Support;

use Illuminate\Support\Facades\DB;

class RequiredFeedback
{
    public static function pending(string $email): ?array
    {
        $email=strtolower(trim($email));
        if($email==='')return null;
        foreach(DB::table('queues')->where('status','Completed')->orderBy('completed_at')->get() as $row){
            $visit=QueueData::read($row->portal_payload);
            if(strtolower(trim($visit['email']??''))!==$email || !empty($visit['pickupOfVisitId']) || !empty($visit['pickupTransactionId']) || isset($visit['feedback']))continue;
            return ['visitId'=>$visit['visitId']??null];
        }
        return null;
    }
    public static function requireComplete(string $email): void
    {
        if(self::pending($email))throw new \Illuminate\Http\Exceptions\HttpResponseException(response()->json(['message'=>'Please submit feedback for your completed visit before starting another visit.','feedbackRequired'=>true],409));
    }
}
