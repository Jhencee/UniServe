<?php
namespace App\Support;

class PhilippineContact
{
    public static function normalize(string $value): string
    {
        $digits=preg_replace('/\D/','',$value);
        return preg_match('/^639\d{9}$/',$digits) ? '0'.substr($digits,2) : $digits;
    }
}
