<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        config(['services.turnstile.enabled'=>false]);
    }

    public function verifiedPostJson($uri, array $data = [], array $headers = [])
    {
        return $this->postJson($uri,$data,$headers+['X-Visitor-Token'=>\App\Support\VisitorAccess::token($data['email']??'fixture@gmail.com')]);
    }
}
