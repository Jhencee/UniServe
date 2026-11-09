<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Schema;

it('installs from an empty database and creates an administrator without default credentials', function () {
    if (DB::getDriverName() !== 'sqlite' || DB::connection()->getDatabaseName() !== ':memory:') {
        throw new RuntimeException('Installation checks require an isolated in-memory database.');
    }
    try {
        $this->artisan('migrate', ['--force' => true])->assertExitCode(0);
        foreach (['staff_users', 'queues', 'queue_counters', 'shared_appointments', 'notification_outbox', 'jobs'] as $table) {
            expect(Schema::hasTable($table))->toBeTrue();
        }
        expect(DB::table('staff_users')->count())->toBe(0);
        $this->artisan('portal:create-super-admin')
            ->expectsQuestion('Username', 'deployment.admin')
            ->expectsQuestion('Full name', 'Deployment Administrator')
            ->expectsQuestion('Email address', 'admin@example.com')
            ->expectsQuestion('Password: '.\App\Support\AccountPassword::HINT, 'admin123')
            ->expectsQuestion('Confirm password', 'admin123')
            ->assertExitCode(1);
        expect(DB::table('staff_users')->count())->toBe(0);
        $this->artisan('portal:create-super-admin')
            ->expectsQuestion('Username', 'deployment.admin')
            ->expectsQuestion('Full name', 'Deployment Administrator')
            ->expectsQuestion('Email address', 'admin@example.com')
            ->expectsQuestion('Password: '.\App\Support\AccountPassword::HINT, 'SecureDeployment123!')
            ->expectsQuestion('Confirm password', 'SecureDeployment123!')
            ->assertExitCode(0);
        $user = DB::table('staff_users')->sole();
        expect($user->role)->toBe('SUPER_ADMIN')
            ->and(Hash::check('SecureDeployment123!', $user->password_hash))->toBeTrue();
        $this->artisan('portal:create-super-admin')->assertExitCode(1);
        expect(DB::table('staff_users')->count())->toBe(1);
    } finally {
        Schema::dropAllTables();
    }
});

it('uses cached configuration for the public Reverb endpoint', function () {
    config(['broadcasting.default' => 'reverb', 'broadcasting.connections.reverb.key' => 'public-key',
        'reverb.public.port' => 443, 'reverb.public.scheme' => 'wss']);
    $response = (new \App\Http\Controllers\RealtimeController)->config();
    expect($response->getData(true))->toMatchArray([
        'enabled' => true, 'key' => 'public-key', 'port' => 443, 'scheme' => 'wss',
    ]);
});

it('requires changing the legacy installation password', function () {
    expect(\App\Support\StaffAuth::needsPasswordChange((object) [
        'password_hash' => Hash::make('admin123'),
    ]))->toBeTrue();
});
