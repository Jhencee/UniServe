<?php
// Read-only check: no credentials or personal records are printed.
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$db = Illuminate\Support\Facades\DB::connection();
$tables = ['staff_users','queues','queue_counters','service_catalog','shared_appointments','shared_transactions','shared_visitor_log','shared_chats','shared_system_settings','office_calendar','notification_outbox','system_audit','confidential_cases','confidential_requests'];
$result=['connection'=>$db->getDriverName(),'database'=>$db->getDatabaseName(),'tables'=>[]];
foreach($tables as $table){
    $result['tables'][$table]=['readable'=>true,'rows'=>$db->table($table)->count()];
}
$result['pendingMigrations']=array_values(array_diff(array_map(fn($f)=>basename($f,'.php'),glob(__DIR__.'/../database/migrations/*.php')),$db->table('migrations')->pluck('migration')->all()));
echo json_encode($result, JSON_PRETTY_PRINT).PHP_EOL;
