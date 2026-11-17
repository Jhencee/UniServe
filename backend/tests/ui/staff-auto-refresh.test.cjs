const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function setup(){
  let tick,version='one',status=200,calls=0,modal=false;const events=[],listeners={};
  const c={state_view:'dashboard',AbortSignal,Date,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},
    document:{visibilityState:'visible',activeElement:null,getElementById:()=>modal?{}:null,addEventListener(){}},
    sessionStorage:{getItem:()=>'{"token":"fixture"}'},window:{addEventListener:(name,fn)=>listeners[name]=fn,dispatchEvent:e=>events.push(e)},
    setInterval:(fn,ms)=>{assert.equal(ms,15000);tick=fn;return 1;},clearInterval(){},
    fetch:async()=>{calls++;return {ok:status===200,status,headers:{get:()=>null},json:async()=>({version})};}};
  vm.createContext(c);vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../../shared/staff-auto-refresh.js'),'utf8'),c);
  return {c,events,listeners,tick:async()=>{await new Promise(r=>setImmediate(r));await tick();},setVersion:v=>version=v,setStatus:v=>status=v,setModal:v=>modal=v,get calls(){return calls;}};
}
test('refreshes changed data only and reports actual successful polling',async()=>{
  const s=setup();await s.tick();assert.equal(s.c.window.UniServeAutoRefresh.active,true);
  assert.equal(s.events.filter(e=>e.type==='uniserve:changed').length,0);
  s.setVersion('two');await s.tick();assert.equal(s.events.filter(e=>e.type==='uniserve:changed').length,1);
  await s.tick();assert.equal(s.events.filter(e=>e.type==='uniserve:changed').length,1);
});
test('pauses on hidden tabs, dialogs, editing and working WebSockets',async()=>{
  const s=setup();await new Promise(r=>setImmediate(r));const baseline=s.calls;
  s.c.document.visibilityState='hidden';await s.tick();s.c.document.visibilityState='visible';
  s.setModal(true);await s.tick();s.setModal(false);
  s.c.document.activeElement={matches:()=>true};await s.tick();s.c.document.activeElement=null;
  s.c.window.UniServeRealtime={connected:true};await s.tick();assert.equal(s.calls,baseline);
});
test('stops on session end and does not claim failed checks are active',async()=>{
  const s=setup();await s.tick();s.setStatus(500);await s.tick();assert.equal(s.c.window.UniServeAutoRefresh.active,false);
  s.setStatus(200);await s.tick();s.listeners['uniserve:session-ended']();const calls=s.calls;
  await s.tick();assert.equal(s.calls,calls);assert.equal(s.c.window.UniServeAutoRefresh.active,false);
});
