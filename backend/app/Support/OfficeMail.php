<?php
namespace App\Support;

class OfficeMail
{
    public static function send(string $recipient,string $subject,string $body,?string $code=null):void
    {
        $html=self::html($subject,$body,$code);
        \Illuminate\Support\Facades\Mail::html($html,function($mail)use($recipient,$subject){
            $mail->to($recipient)->subject($subject);
        });
    }
    public static function html(string $title,string $body,?string $code=null):string
    {
        $details=[];$intro=$body;$closing='';
        if(preg_match_all('/^(Service|Date|Time|Visit ID):[ \t]*(.+)$/m',$body,$matches,PREG_OFFSET_CAPTURE)){
            foreach($matches[1] as $index=>$label)$details[$label[0]]=trim($matches[2][$index][0]);
            $first=$matches[0][0];$last=$matches[0][count($matches[0])-1];
            $intro=trim(substr($body,0,$first[1]));
            $closing=trim(substr($body,$last[1]+strlen($last[0])));
        }
        $rules=[];
        if(preg_match('/\n\nArrival guidelines\n(.+?)\n\nOffice of Student Services/s',$closing,$match)){
            $rules=explode("\n",$match[1]);$closing=str_replace($match[0],'',$closing);
        }
        $intro=preg_replace('/\n{3,}/',"\n\n",$intro);
        return view('emails.office',['title'=>$title,'body'=>$intro,'closing'=>$closing,'code'=>$code,'details'=>$details,'rules'=>$rules])->render();
    }
}
