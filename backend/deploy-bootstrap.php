<?php
require __DIR__.'/vendor/autoload.php';
$app=require __DIR__.'/bootstrap/app.php';$app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();
use Illuminate\Support\Facades\{DB,Hash};
$password=getenv('INITIAL_ADMIN_PASSWORD');
if(!$password||strlen($password)<16)throw new RuntimeException('INITIAL_ADMIN_PASSWORD must contain at least 16 characters.');
$admin=DB::table('staff_users')->where('role','SUPER_ADMIN')->where('username','admin')->first();
if($admin&&Hash::check('admin123',$admin->password_hash))DB::table('staff_users')->where('id',$admin->id)->update(['password_hash'=>Hash::make($password),'email'=>getenv('INITIAL_ADMIN_EMAIL')?:$admin->email,'updated_at'=>now()]);
