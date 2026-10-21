<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\{DB,Schema};
return new class extends Migration {
 public function up():void {
  if(!Schema::hasTable('queues')||DB::getDriverName()!=='mysql')return;
  $column=DB::select("SHOW COLUMNS FROM queues LIKE 'status'")[0];
  if(!str_starts_with($column->Type,'enum(')||str_contains($column->Type,"'Unfinished'"))return;
  $type=substr($column->Type,0,-1).",'Unfinished')";
  $null=$column->Null==='YES'?' NULL':' NOT NULL';
  $default=$column->Default===null?($column->Null==='YES'?' DEFAULT NULL':''):' DEFAULT '.DB::connection()->getPdo()->quote($column->Default);
  DB::statement('ALTER TABLE queues MODIFY status '.$type.$null.$default);
 }
 public function down():void { /* Keep the added status so historical records remain valid. */ }
};
