<?php
test('the application opens the visitor landing page',function(){ $this->get('/')->assertRedirect('/Landing/landing.html'); });
