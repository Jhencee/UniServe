<?php
return [
    // Enable only after provisioning persistent private API storage and an off-server copy process.
    'scheduled'=>(bool)env('BACKUP_SCHEDULE_ENABLED',false),
];
