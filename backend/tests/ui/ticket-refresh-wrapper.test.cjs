const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../shared/private-record-cache.js'),'utf8');
test('background ticket refresh preserves the background flag for shared and local visits',async()=>{
 for(const shared of [true,false]){
  const calls=[],queue={id:'q1',visitId:'VIS-1',shared};
  const c={renderQueueTicket:async(...args)=>calls.push(args),myActiveQueueId:'q1',visitorNavigationVersion:0,visitorHubOpen:false,loadDB:()=>({queues:[queue]}),SharedAppointments:{visitorRequest:async()=>({queue})},toast(){},escapeHtml:String};
  vm.createContext(c);const start=source.indexOf('    const originalTicket=renderQueueTicket;'),end=source.indexOf("    document.querySelector('.sidebar-foot')",start);
  vm.runInContext(source.slice(start,end),c);await c.renderQueueTicket(false,true);
  assert.deepEqual(calls,[[shared,true]]);
 }
});
