<?php
// Read-only operational summary; no credentials or personal records are printed.
require __DIR__.'/../vendor/autoload.php';
$app = require __DIR__.'/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
use Illuminate\Support\Facades\{DB,Schema};
$result = ['database'=>DB::connection()->getDriverName(), 'mailTransport'=>config('mail.default'), 'queueConnection'=>config('queue.default'), 'broadcastConnection'=>config('broadcasting.default')];
foreach (['pdo_mysql','fileinfo','openssl','zip'] as $extension) $result['extensions'][$extension] = extension_loaded($extension);
$result['phpPostMaxSize'] = ini_get('post_max_size');
if ($result['database']==='mysql') $result['mysqlMaxAllowedPacketBytes'] = (int) DB::selectOne('SELECT @@max_allowed_packet AS value')->value;
foreach (['jobs'=>'queue','failed_jobs'=>'queue','notification_outbox'=>'status'] as $table=>$column) {
    if (Schema::hasTable($table)) $result[$table] = DB::table($table)->select($column)->selectRaw('COUNT(*) AS total')->groupBy($column)->get()->toArray();
}
echo json_encode($result, JSON_PRETTY_PRINT).PHP_EOL;
