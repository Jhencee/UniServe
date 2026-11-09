const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../shared/portal-api.js'),'utf8');
function setup(request){
 const calls=[],c={staff:true,state_view:'notifications',sessionEnding:false,currentUser:{role:'ADMIN'},document:{visibilityState:'visible'},renderNotifications:()=>calls.push('render'),refreshHeadAccessRequests:async()=>calls.push('access'),SharedAppointments:{request:async path=>{calls.push(path);return request?request():{appointments:[{id:'changed',earlierSlotOptIn:true}]};},cache:data=>calls.push(data.appointments[0].earlierSlotOptIn?'fresh-waitlist':'stale'),reloadRecords:async()=>calls.push('records')},setInterval:()=>{},toast:()=>{},escapeHtml:String};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf("  if(staff&&typeof renderNotifications==='function')"),source.indexOf('  let realtimeRefreshBusy=')),c);return {c,calls};
}
test('notifications refresh appointment and record data before rendering',async()=>{
 const {c,calls}=setup();await c.renderNotifications();assert.ok(calls.includes('/appointments'));assert.ok(calls.includes('records'));assert.ok(calls.indexOf('fresh-waitlist')<calls.indexOf('render'));
});
test('a late notification response cannot redraw another staff screen',async()=>{
 let resolve;const {c,calls}=setup(()=>new Promise(r=>resolve=r));const pending=c.renderNotifications();c.state_view='messages';resolve({appointments:[{earlierSlotOptIn:true}]});await pending;assert.ok(!calls.includes('render'));
});
