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

    public function checkQueueRequirements(string $id, array $headers): void
    {
        $row=\Illuminate\Support\Facades\DB::table('queues')->where('id',$id)->first();
        if(!$row||$row->status!=='Serving')return;
        $queue=\App\Support\QueueData::read($row->portal_payload);
        foreach(\App\Support\QueueData::requirements($queue)['items'] as $item)if(!$item['checked']){
            $this->patchJson('/api/queue/'.$id.'/requirements',['serviceKey'=>$queue['serviceKey'],'requirement'=>$item['label'],'checked'=>true],$headers)->assertOk();
        }
    }
}
