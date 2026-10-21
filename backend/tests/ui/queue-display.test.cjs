const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function display(open, intake = null, empty = false) {
  const el = {innerHTML:''}, calls = [];
  const waiting = empty ? [] : [{id:'w',number:'A-002',status:'Waiting',source:'Walk-in'}];
  const db = {systemSettings:{maintenanceMode:false},queues:empty ? [] : [{id:'c',number:'A-001',status:'Called'},...waiting]};
  const context = {document:{getElementById:()=>el},loadDB:()=>db,waitingQueueSorted:()=>waiting,isDue:()=>true,
    OfficeCalendar:{get:()=>({lunch:{end:'13:00'}}),clock:()=> '1:00 PM',status:()=>({open,lunch:!open,reason:'Closed for lunch',nextLabel:'today, Monday, October 12 at 1:00 PM'})},
    window:{UniServeWalkInCapacity:intake,speechSynthesis:{cancel:()=>calls.push('cancel')}},pdCalledIds:new Set(),pdRecallStamps:{},pdVoice:true,
    speakCall:()=>calls.push('speak'),escapeHtml:String,fmtTime:()=> '12:00 PM',fmtWaitDuration:()=> '4 min',queueRef:q=>q.number,refClass:()=>'',pdSourceTag:()=>({cls:'walk',txt:'Walk-in'}),Date,Set};
  vm.createContext(context);
  const source=fs.readFileSync(path.resolve(__dirname,'../../../Landing/landing.js'),'utf8');
  vm.runInContext(source.slice(source.indexOf('function renderPublicDisplay()'),source.indexOf('function renderOfficeStatus()')),context);
  context.renderPublicDisplay();return {el,calls,db};
}
test('closed board retains queue numbers and pauses calls, estimates and voice',()=>{
  const {el,calls,db}=display(false);
  for(const text of ['Lunch break','Back at','1:00 PM','Service paused','Voice announcements: Paused','A-001','A-002']) assert.ok(el.innerHTML.includes(text),text);
  assert.ok(!el.innerHTML.includes('Please proceed to'));
  assert.ok(!el.innerHTML.includes('qd-call active'));
  assert.ok(!calls.includes('speak'));assert.ok(calls.includes('cancel'));
  assert.equal(db.queues[0].status,'Called');assert.equal(db.queues[1].status,'Waiting');
});
test('open board keeps live calls and estimated waiting times',()=>{
  const {el,calls}=display(true);
  assert.ok(el.innerHTML.includes('Please proceed to'));assert.ok(el.innerHTML.includes('Estimated wait'));
  assert.ok(el.innerHTML.includes('qd-call active'));assert.ok(calls.includes('speak'));assert.ok(!calls.includes('cancel'));
});

test('early cutoff closes intake while retaining calls, voice and existing visits',()=>{
  const {el,calls,db}=display(true,{accepting:false,cutoff:'4:30 PM'});
  for(const text of ['Office open','Walk-in intake closed','Existing visits are still being served','4:30 PM','book an appointment','Please proceed to','qd-call active','Estimated wait'])assert.ok(el.innerHTML.includes(text),text);
  assert.ok(calls.includes('speak'));assert.ok(!calls.includes('cancel'));
  assert.equal(db.queues[0].status,'Called');assert.equal(db.queues[1].status,'Waiting');
});
test('an empty queue after cutoff does not invite new walk-ins',()=>{
  const {el}=display(true,{accepting:false},true);
  assert.ok(el.innerHTML.includes('Walk-in intake is closed for today.'));
  assert.ok(!el.innerHTML.includes('You may proceed to the counter.'));
});
test('manual cutoff hides legacy reasons',()=>{
  const {el,calls}=display(true,{accepting:false,manualCutoff:true,reason:'Staff meeting this afternoon'});
  assert.ok(!el.innerHTML.includes('Reason: Staff meeting this afternoon'));assert.ok(calls.includes('speak'));
});
test('board displays scheduled time before cutoff and effective closure time afterward',()=>{
  const pending=display(true,{accepting:true,scheduledCutoff:true,manualCutoffTime:'11:00 AM',reason:'Staff meeting'});
  assert.ok(pending.el.innerHTML.includes('Scheduled walk-in cutoff: 11:00 AM'));assert.ok(!pending.el.innerHTML.includes('Reason: Staff meeting'));
  const closed=display(true,{accepting:false,manualCutoff:true,closedTime:'11:00 AM',reason:'Staff meeting'});
  assert.ok(closed.el.innerHTML.includes('Intake closed at 11:00 AM'));assert.ok(closed.calls.includes('speak'));
});
test('head admin override displays available intake',()=>{
  const {el}=display(true,{accepting:true,override:true,cutoff:'4:30 PM'});
  assert.ok(el.innerHTML.includes('Walk-ins available'));assert.ok(el.innerHTML.includes('allowed today by the Head Admin'));
});
test('unavailable intake never claims walk-ins are available or stops existing calls',()=>{
  const {el,calls}=display(true);
  assert.ok(el.innerHTML.includes('Walk-in intake status unavailable'));assert.ok(calls.includes('speak'));
  assert.ok(!el.innerHTML.includes('Walk-ins available'));
});
test('lunch closure takes precedence over intake status',()=>{
  const {el}=display(false,{accepting:false});assert.ok(el.innerHTML.includes('Lunch break'));assert.ok(!el.innerHTML.includes('Walk-in intake closed'));
});
test('clock-based refresh runs even with a connected realtime socket',()=>{
  let now=0,timer,refreshes=0;
  const c={Date:{now:()=>now},window:{UniServeRealtime:{connected:true}},stopPdPolling(){},renderPublicDisplay(){refreshes++;},setInterval(fn){timer=fn;return 1;}};
  vm.createContext(c);const source=fs.readFileSync(path.resolve(__dirname,'../../../Landing/landing.js'),'utf8');
  vm.runInContext(source.slice(source.indexOf('function startPdPolling()'),source.indexOf('function stopPdPolling()')),c);
  c.startPdPolling();assert.equal(refreshes,1);now=3000;timer();assert.equal(refreshes,1);now=15000;timer();assert.equal(refreshes,2);
  c.window.UniServeRealtime.connected=false;now=18000;timer();assert.equal(refreshes,3);
});
test('board fetches backend intake and clears stale status when its request fails',async()=>{
  const source=fs.readFileSync(path.resolve(__dirname,'../../../shared/portal-api.js'),'utf8');
  const start=source.indexOf('renderPublicDisplay=async function(){if(loading)');const end=source.indexOf("    Promise.all([request('/public-queue')",start);
  let fail=false,rendered=0;const paths=[];
  const c={loading:false,window:{},cache(){},renderLandingLive(){},original(){rendered++;},document:{getElementById:()=>null},request:async path=>{paths.push(path);if(path==='/walk-in-capacity'){if(fail)throw Error('offline');return {accepting:false};}return {};}};
  vm.createContext(c);vm.runInContext(source.slice(start,end),c);
  await c.renderPublicDisplay();assert.equal(c.window.UniServeWalkInCapacity.accepting,false);assert.ok(paths.includes('/walk-in-capacity'));
  fail=true;await c.renderPublicDisplay();assert.equal(c.window.UniServeWalkInCapacity,null);assert.equal(rendered,2);
});

test('voice calls announce the number and counter and pause outside office hours',()=>{
 const utterances=[],c={pdVoice:true,isOfficeHours:()=>true,loadDB:()=>({systemSettings:{maintenanceMode:false}}),window:{speechSynthesis:{}},speechSynthesis:{speak:u=>utterances.push(u)},SpeechSynthesisUtterance:function(text){this.text=text;}};vm.createContext(c);const source=fs.readFileSync(path.resolve(__dirname,'../../../Landing/landing.js'),'utf8');vm.runInContext(source.slice(source.indexOf('function spokenRef('),source.indexOf('function pdSourceTag(')),c);c.speakCall({number:'A-001',assignedAdminName:'OSS counter'});assert.equal(utterances.length,1);assert.ok(utterances[0].text.includes('please proceed to OSS counter'));c.isOfficeHours=()=>false;c.speakCall({number:'A-002'});assert.equal(utterances.length,1);
});
