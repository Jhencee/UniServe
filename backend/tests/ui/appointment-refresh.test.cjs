const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../shared/appointment-api.js'),'utf8');
function setup(record,error){
 const calls=[],shown=[],notices=[];let reset=0,cleared=false;
 const context={sessionStorage:{getItem:()=>record?.id||'missing',removeItem:()=>{cleared=true;}},loadDB:()=>({appointments:record?[record]:[]}),visitStep:'pass',persistSession(){},renderVisitScreen(){reset++;},showPassModalReadonly:a=>shown.push(a),visitorRequest:async url=>{calls.push(url);if(error)throw error;return {appointment:{...record,visitId:'VIS-SERVER'}};},toast:message=>notices.push(message),escapeHtml:String};
 vm.createContext(context);
 const start=source.indexOf('    refreshAppointmentPass=async function(){');
 vm.runInContext(source.slice(start,source.indexOf('    const originalLookup=',start)),context);
 return {context,calls,shown,notices,reset:()=>reset,cleared:()=>cleared};
}
test('appointment refresh uses permanent ID instead of stale cached Visit ID',async()=>{
 const s=setup({id:'APT-REQUEST1',visitId:'VIS-STALE',shared:true});await s.context.refreshAppointmentPass();
 assert.deepEqual(s.calls,['/appointments/visit/APT-REQUEST1']);assert.equal(s.shown.at(-1).visitId,'VIS-SERVER');assert.equal(s.reset(),0);
});
test('missing server appointment keeps the open ticket without navigating back',async()=>{
 const s=setup({id:'old',shared:true},Object.assign(Error('Appointment not found.'),{status:404}));await s.context.refreshAppointmentPass();
 assert.equal(s.cleared(),false);assert.equal(s.context.visitStep,'pass');assert.equal(s.reset(),0);assert.equal(s.shown.length,1);assert.match(s.notices[0],/Visit History/);
});
test('missing local appointment recovers instead of leaving an empty page',async()=>{
 const s=setup();await s.context.refreshAppointmentPass();assert.equal(s.cleared(),true);assert.equal(s.reset(),1);assert.equal(s.calls.length,0);
});
test('temporary refresh failure preserves the displayed ticket',async()=>{
 const record={id:'a1',shared:true};const s=setup(record,Error('Network unavailable'));await s.context.refreshAppointmentPass();assert.equal(s.shown[0],record);assert.equal(s.reset(),0);assert.equal(s.cleared(),false);
});

test('a late appointment refresh cannot reopen a screen after navigation',async()=>{
 const s=setup({id:'a',shared:true});let finish;s.context.visitorNavigationVersion=0;s.context.visitorHubOpen=false;
 s.context.visitorRequest=()=>new Promise(resolve=>finish=resolve);
 const pending=s.context.refreshAppointmentPass();s.context.visitorNavigationVersion++;s.context.visitorHubOpen=true;
 finish({appointment:{id:'a',shared:true,visitId:'VIS-LATE'}});await pending;
 assert.equal(s.shown.length,1);assert.equal(s.reset(),0);
});
