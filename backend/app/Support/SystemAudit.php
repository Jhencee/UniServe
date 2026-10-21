<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class SystemAudit
{
    public static function record(?object $actor, string $category, string $action, ?string $target = null, array $changes = [], string $source = 'server', ?string $id = null): void
    {
        if($category==='Confidential'&&$target&&\Illuminate\Support\Facades\Schema::hasTable('confidential_cases'))$target=DB::table('confidential_cases')->where('id',$target)->value('code')??$target;
        DB::table('system_audit')->insertOrIgnore(['id'=>$id ?? (string) Str::uuid(), 'actor_id'=>$actor?->id,
            'actor_name'=>$actor?->full_name ?? 'Visitor', 'category'=>$category, 'action'=>$action,
            'target'=>$target, 'changes'=>json_encode($changes), 'source'=>$source, 'created_at'=>now()]);
        if(app()->bound('request'))request()->attributes->set('system_audit_recorded',true);
        if(config('broadcasting.default')==='reverb'){
            try{event(new \App\Events\PortalChanged('audit',['private-office']));}catch(\Throwable $exception){report($exception);}
        }
    }
}
