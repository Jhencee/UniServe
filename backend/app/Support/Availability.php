<?php
namespace App\Support;
use Illuminate\Support\Facades\{DB,Schema};
class Availability {
 public static function requireOpen():void {
  if(Schema::hasTable('shared_system_settings')){ $s=json_decode(DB::table('shared_system_settings')->where('id',1)->value('payload'),true);abort_if($s['maintenanceMode']??false,503,'The office is undergoing maintenance.'); }
  $a=OfficeCalendar::status();abort_unless($a['open'],409,$a['reason']);
 }
}
