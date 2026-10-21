<?php
namespace App\Support;
class AccountPassword {
 public const HINT='At least 12 characters with uppercase and lowercase letters, a number, and a special character.';
 public static function rules():array { return ['string','min:12','max:72','regex:/[A-Z]/','regex:/[a-z]/','regex:/[0-9]/','regex:/[^A-Za-z0-9\s]/']; }
}
