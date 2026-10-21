<?php
namespace App\Http\Middleware;
class SecurityHeaders {
 public function handle($request,\Closure $next){$response=$next($request);$response->headers->set('X-Content-Type-Options','nosniff');$response->headers->set('Referrer-Policy','no-referrer');$response->headers->set('X-Frame-Options','DENY');$response->headers->set('Cache-Control','no-store, private');return $response;}
}
