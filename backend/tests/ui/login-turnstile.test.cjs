const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('Turnstile renders automatically after script load',async()=>{
  const elements={loginTurnstile:{hidden:true},loginTurnstileStatus:{textContent:''},loginTurnstileStart:{disabled:false,hidden:false}};
  let rendered=0,resets=0;
  const context={window:{},UniServeConfig:{apiBase:'/api'},fetch:async()=>({ok:true,json:async()=>({enabled:true,siteKey:'public'})}),document:{
    getElementById:id=>elements[id],documentElement:{dataset:{theme:'light'}},createElement:()=>({}),
    head:{appendChild:script=>{context.window.turnstile={ready:()=>assert.fail('ready must not be called for async scripts'),render:(selector,options)=>{rendered++;options.callback('verified-token');return 'widget';},reset:()=>resets++};script.onload();}},
  }};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../../shared/login-turnstile.js'),'utf8'),context);
  await context.window.LoginTurnstile.init();
  assert.equal(rendered,1);assert.equal(elements.loginTurnstile.hidden,false);
  assert.equal(await context.window.LoginTurnstile.getToken(),'verified-token');
  assert.equal(rendered,1);context.window.LoginTurnstile.reset();assert.equal(resets,1);
  assert.equal(elements.loginTurnstileStart.disabled,false);
  assert.equal(elements.loginTurnstileStart.hidden,false);
});
