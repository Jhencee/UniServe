<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\{Schema,DB,Crypt};
return new class extends Migration {
 public function up():void{
  if(!Schema::hasColumn('queues','visit_id'))Schema::table('queues',function(Blueprint $t){$t->string('visit_id',80)->nullable()->index();$t->string('email_hash',64)->nullable()->index();});
  DB::table('queues')->whereNotNull('portal_payload')->orderBy('id')->chunk(100,function($rows){foreach($rows as $row){$q=json_decode($row->portal_payload,true);if(!$q)continue;$changes=['portal_payload'=>json_encode(['_encrypted'=>Crypt::encryptString(json_encode($q))]),'visit_id'=>$q['visitId']??null,'email_hash'=>hash('sha256',strtolower($q['email']??''))];foreach(['visitor_name','contact','id_number'] as $column)if(Schema::hasColumn('queues',$column))$changes[$column]=null;DB::table('queues')->where('id',$row->id)->update($changes);}});
 }
 public function down():void {throw new RuntimeException('Decrypting private records requires an explicit reviewed recovery procedure.');}
};
