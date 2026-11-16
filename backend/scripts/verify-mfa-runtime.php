<?php

// Public RFC 6238 SHA-1 vectors. No application credentials or database access.
require_once __DIR__.'/../app/Support/StaffMfa.php';

$secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
foreach ([59=>'94287082',1111111109=>'07081804',1111111111=>'14050471',1234567890=>'89005924',2000000000=>'69279037'] as $timestamp=>$expected) {
    if (!hash_equals($expected, \App\Support\StaffMfa::code($secret,$timestamp,8))) {
        fwrite(STDERR,"MFA runtime verification failed.\n");
        exit(1);
    }
}
echo 'MFA runtime verification passed ('.(PHP_INT_SIZE*8)."-bit PHP).\n";
