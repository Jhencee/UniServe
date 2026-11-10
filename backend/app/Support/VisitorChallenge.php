<?php
namespace App\Support;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class VisitorChallenge
{
    public static function validate(Request $request): void
    {
        if(!config('services.turnstile.enabled'))return;
        abort_unless(config('services.turnstile.site_key') && config('services.turnstile.secret_key'),503,'Security verification is not configured. Contact OSS.');
        $data=$request->validate(['turnstileToken'=>'required|string|max:2048'],['turnstileToken.required'=>'Complete the security check before requesting a code.']);
        try {
            $response=Http::asForm()->timeout(10)->post('https://challenges.cloudflare.com/turnstile/v0/siteverify',[
                'secret'=>config('services.turnstile.secret_key'),'response'=>$data['turnstileToken'],'remoteip'=>$request->ip(),
            ]);
        }catch(\Throwable $e){
            // Log transport diagnostics only, never request bodies, keys, or tokens.
            $causes=[];
            for($cause=$e;$cause!==null;$cause=$cause->getPrevious()){
                $context=method_exists($cause,'getHandlerContext')?$cause->getHandlerContext():[];
                $message=strtolower($cause->getMessage());
                $causes[]=[
                    'type'=>get_class($cause),
                    'curl_errno'=>$context['errno']??null,
                    'timeout'=>str_contains($message,'timed out')||str_contains($message,'timeout'),
                    'tls'=>str_contains($message,'ssl')||str_contains($message,'certificate'),
                    'dns'=>str_contains($message,'resolve host'),
                    'connection'=>str_contains($message,'connect'),
                ];
            }
            Log::warning('Turnstile visitor verification transport failed',['causes'=>$causes]);
            abort(503,'Security verification is unavailable. Please try again.');
        }
        if(!$response->successful()){
            Log::warning('Turnstile visitor verification HTTP failure',['status'=>$response->status()]);
            abort(503,'Security verification is unavailable. Please try again.');
        }
        $check=$response->json();
        abort_unless(($check['success']??false)===true && ($check['action']??'')==='visitor-code',422,'Security check failed or expired. Please complete it again.');
        $hosts=config('services.turnstile.hostnames',[]);
        abort_if($hosts && !in_array($check['hostname']??'',$hosts,true),422,'Security check did not match this site.');
    }
}
