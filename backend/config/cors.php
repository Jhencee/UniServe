<?php

return [
    'paths' => ['api/*'],
    'allowed_methods' => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    'allowed_origins' => array_values(array_filter(array_map('trim',explode(',',env('FRONTEND_ORIGINS','http://localhost,http://127.0.0.1'.(env('APP_ENV')==='production'?'':',null')))))),
    'allowed_origins_patterns' => ['#^http://(localhost|127\.0\.0\.1)(:[0-9]+)?$#'],
    'allowed_headers' => ['Content-Type', 'Accept', 'Authorization', 'X-Visitor-Token', 'X-Chat-Token', 'X-Visit-Token'],
    'exposed_headers' => [],
    'max_age' => 0,
    'supports_credentials' => false,
];
