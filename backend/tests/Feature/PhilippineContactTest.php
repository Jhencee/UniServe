<?php
use App\Support\PhilippineContact;
it('normalizes Philippine international mobile numbers without accepting other country codes',function(){
    expect(PhilippineContact::normalize('+63 917 123 4567'))->toBe('09171234567');
    expect(PhilippineContact::normalize('0917-123-4567'))->toBe('09171234567');
    expect(PhilippineContact::normalize('+1 9171234567'))->not->toMatch('/^09\d{9}$/');
    expect(PhilippineContact::normalize('+63 917123456'))->not->toMatch('/^09\d{9}$/');
});
