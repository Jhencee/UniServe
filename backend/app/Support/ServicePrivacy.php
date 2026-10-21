<?php
namespace App\Support;
use Illuminate\Support\Facades\{DB,Schema};
class ServicePrivacy {
 const DEFAULTS=['incident_report','concern','scholarship_txn','excuse_letter'];
 public static function confidential(?string $key):bool {
  if(Schema::hasTable('service_catalog')){$row=DB::table('service_catalog')->where('key',$key)->first();if($row){$data=json_decode($row->payload,true);if(array_key_exists('confidential',$data??[]))return (bool)$data['confidential'];}}
  return in_array($key,self::DEFAULTS,true);
 }
}
