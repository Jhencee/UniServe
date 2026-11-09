<?php
use Illuminate\Support\Facades\{Schema,DB,Cache,Hash,Queue};
use Illuminate\Database\Schema\Blueprint;
use App\Jobs\SendPasswordResetCode;
beforeEach(function(){Schema::create('staff_users',function(Blueprint $t){$t->string('id')->primary();$t->string('full_name');$t->string('email');$t->boolean('is_active');$t->string('password_hash');});(require database_path('migrations/2026_10_12_000004_audit_and_notifications.php'))->up();DB::table('staff_users')->insert(['id'=>'reset-test','full_name'=>'Test','email'=>'reset@example.com','is_active'=>true,'password_hash'=>Hash::make('OldPassword123!')]);config(['mail.default'=>'smtp','mail.mailers.smtp.username'=>'test','mail.mailers.smtp.password'=>'test']);Queue::fake();Cache::flush();});
afterEach(function(){foreach(['staff_users','notification_outbox','system_audit','calendar_audit'] as $table)Schema::dropIfExists($table);});
it('resets only with the correct one-use code and a valid password',function(){
 $id=$this->postJson('/api/password/reset-code',['email'=>'reset@example.com'])->assertOk()->json('challengeId');$code=null;Queue::assertPushed(SendPasswordResetCode::class,function($job)use(&$code){$code=$job->code;return true;});
 $data=['challengeId'=>$id,'code'=>'000000','password'=>'NewPassword123!','password_confirmation'=>'NewPassword123!'];$this->postJson('/api/password/reset',$data)->assertUnprocessable();$data['code']=$code;$this->postJson('/api/password/reset',$data)->assertUnprocessable();$this->postJson('/api/password/verify-reset-code',['challengeId'=>$id,'code'=>'000000'])->assertUnprocessable();$this->postJson('/api/password/verify-reset-code',['challengeId'=>$id,'code'=>$code])->assertOk();$this->postJson('/api/password/reset',$data)->assertOk();expect(Hash::check('NewPassword123!',DB::table('staff_users')->value('password_hash')))->toBeTrue();$this->postJson('/api/password/reset',$data)->assertUnprocessable();
});
it('rejects emails without an active staff account',function(){$this->postJson('/api/password/reset-code',['email'=>'unknown@example.com'])->assertUnprocessable()->assertJsonPath('message','This email is not linked to an active staff account.');Queue::assertNothingPushed();});
