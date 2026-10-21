const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function setup(enabled=true){
  const status={textContent:''},element={hidden:true,isConnected:true,querySelector:selector=>selector==='[role="status"]'?status:{}};
  let callbacks,renders=0,resets=0,removes=0;
  const context={window:{location:{protocol:'http:'},turnstile:{render:(el,options)=>{callbacks=options;renders++;return 'widget';},reset:()=>resets++,remove:()=>removes++}},document:{getElementById:()=>element,documentElement:{dataset:{theme:'light'}}},fetch:async()=>({ok:true,json:async()=>({enabled,siteKey:'public'})})};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../../shared/visitor-turnstile.js'),'utf8'),context);
  return {api:context.window.VisitorTurnstile,element,status,callbacks:()=>callbacks,renders:()=>renders,resets:()=>resets,removes:()=>removes};
}
test('visitor code requests require a completed visitor-specific challenge',async()=>{
 const s=setup();await s.api.mount('security');
 assert.equal(s.callbacks().action,'visitor-code');assert.equal(s.element.hidden,false);
 await assert.rejects(s.api.getToken('security'),/Complete the security check/);
 s.callbacks().callback('token');assert.equal(await s.api.getToken('security'),'token');assert.equal(s.renders(),1);
 s.api.reset('security');assert.equal(s.resets(),1);await assert.rejects(s.api.getToken('security'));
});
test('expired tokens cannot be submitted and disabled checks do not block requests',async()=>{
 const s=setup();await s.api.mount('security');s.callbacks().callback('token');s.callbacks()['expired-callback']();await assert.rejects(s.api.getToken('security'));
 const disabled=setup(false);await disabled.api.mount('security');assert.equal(disabled.element.hidden,true);assert.equal(await disabled.api.getToken('security'),'');assert.equal(disabled.renders(),0);
});
