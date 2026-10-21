<?php
use App\Support\AccountPassword;
use Illuminate\Support\Facades\Validator;
it('enforces the shared staff password rules',function(){
 foreach(['Short1!','alllowercase123!','ALLUPPERCASE123!','NoNumbersHere!','NoSpecialChar123','Password123 '] as $value)expect(Validator::make(['password'=>$value],['password'=>AccountPassword::rules()])->fails())->toBeTrue();
 expect(Validator::make(['password'=>'StrongPassword123!'],['password'=>AccountPassword::rules()])->passes())->toBeTrue();
});
