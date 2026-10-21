<?php
namespace App\Support;
class EmailIndex {public static function key(string $email):string{return hash_hmac('sha256',strtolower(trim($email)),config('app.key'));}}
