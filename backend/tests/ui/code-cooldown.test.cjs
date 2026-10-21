const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
test('resend counts down, survives reopening, and enables exactly at expiry',()=>{
  let now=1000,tick;const values=new Map();
  const context={window:{},Date:{now:()=>now},sessionStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},setInterval:fn=>{tick=fn;}};
  vm.createContext(context);vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../../shared/code-cooldown.js'),'utf8'),context);
  const api=context.window.CodeCooldown,button={isConnected:true};
  api.start('visitor:A@gmail.com');api.bind(button,'visitor:a@gmail.com');
  assert.equal(button.textContent,'Resend code (60s)');assert.equal(button.disabled,true);
  now+=10000;tick();assert.equal(button.textContent,'Resend code (50s)');
  button.isConnected=false;const reopened={isConnected:true};api.bind(reopened,'visitor:a@gmail.com');
  assert.equal(reopened.textContent,'Resend code (50s)');
  assert.equal(api.remaining('staff:a@gmail.com'),0);
  now+=50000;tick();assert.equal(reopened.textContent,'Resend code');assert.equal(reopened.disabled,false);
});
