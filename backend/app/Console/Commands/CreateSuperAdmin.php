<?php

namespace App\Console\Commands;

use App\Support\AccountPassword;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;

class CreateSuperAdmin extends Command
{
    protected $signature = 'portal:create-super-admin';

    protected $description = 'Interactively create the first Super Admin without default credentials';

    public function handle(): int
    {
        if (DB::table('staff_users')->where('role', 'SUPER_ADMIN')->exists()) {
            $this->error('A Super Admin already exists. Manage accounts through the portal.');
            return self::FAILURE;
        }
        $data = [
            'username' => $this->ask('Username'),
            'full_name' => $this->ask('Full name'),
            'email' => $this->ask('Email address'),
            'password' => $this->secret('Password: '.AccountPassword::HINT),
            'password_confirmation' => $this->secret('Confirm password'),
        ];
        $validator = Validator::make($data, [
            'username' => ['required', 'string', 'max:50', 'regex:/^[a-zA-Z0-9_.-]+$/', 'unique:staff_users,username'],
            'full_name' => ['required', 'string', 'max:120'],
            'email' => ['required', 'email', 'max:120', 'unique:staff_users,email'],
            'password' => ['required', 'confirmed', ...AccountPassword::rules()],
        ]);
        if ($validator->fails()) {
            foreach ($validator->errors()->all() as $error) $this->error($error);
            return self::FAILURE;
        }
        DB::table('staff_users')->insert([
            'id' => 'sa-'.Str::lower(Str::random(16)),
            'username' => $data['username'], 'full_name' => $data['full_name'], 'email' => $data['email'],
            'password_hash' => Hash::make($data['password']), 'role' => 'SUPER_ADMIN',
            'is_active' => true, 'confidential_access' => false,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->info('Super Admin created.');
        return self::SUCCESS;
    }
}
