<?php
use Illuminate\Support\Facades\{Artisan,DB,Schema};
it('creates a fresh portal database without a manual SQL import',function(){
 $previous=config('database.default');
 config(['database.connections.deployment_check'=>array_merge(config('database.connections.sqlite'),['database'=>':memory:']),'database.default'=>'deployment_check']);
 try{
  Artisan::call('migrate',['--force'=>true]);
  foreach(['staff_users','queues','queue_counters','shared_appointments','service_catalog','shared_chats','notification_outbox'] as $table)expect(Schema::hasTable($table))->toBeTrue();
  expect(DB::table('staff_users')->where('role','SUPER_ADMIN')->count())->toBe(1);
  expect(DB::table('service_catalog')->count())->toBeGreaterThan(0);
 }finally{DB::purge('deployment_check');config(['database.default'=>$previous]);}
});
