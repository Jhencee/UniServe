const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../User/user.js'),'utf8');
async function lateTicket(change){let finish,resets=0,rendered=0;const queue={id:'q',visitId:'VIS-Q',shared:true};const db={queues:[queue]};const context={myActiveQueueId:'q',visitorView:'checkvisit',visitorHubOpen:false,visitorNavigationVersion:0,window:{},loadDB:()=>db,saveDB:()=>{},fetch:url=>url.includes('walk-in-capacity')?Promise.resolve({ok:true,json:async()=>({})}):new Promise(resolve=>finish=()=>resolve({ok:true,json:async()=>({queue})})),resetVisit:()=>resets++,encodeURIComponent,Promise,AbortSignal};vm.createContext(context);const a=source.indexOf('let sharedTicketLoading =');const b=source.indexOf('  const isAppt =',a);vm.runInContext(source.slice(a,b)+'rendered();}',Object.assign(context,{rendered:()=>rendered++}));const pending=context.renderQueueTicket();change(context);finish();await pending;return {resets,rendered};}
test('a queue refresh cannot reset a newly selected appointment',async()=>{const result=await lateTicket(c=>{c.myActiveQueueId=null;});assert.equal(result.resets,0);assert.equal(result.rendered,0);});
test('a queue refresh cannot replace the services screen after Back',async()=>{const result=await lateTicket(c=>{c.visitorHubOpen=true;c.visitorNavigationVersion++;});assert.equal(result.resets,0);assert.equal(result.rendered,0);});

test('visitor progress checks the server despite a connected socket and resumes after phone sleep',()=>{
 let tick,refreshes=0;const listeners={};
 const c={ticketPollTimer:null,visitorView:'checkvisit',myActiveQueueId:'q',visitorHubOpen:false,
  document:{visibilityState:'visible',addEventListener:(name,fn)=>listeners[name]=fn},
  window:{UniServeRealtime:{connected:true},addEventListener:(name,fn)=>listeners[name]=fn},
  setInterval:fn=>{tick=fn;return 1;},clearInterval(){},renderQueueTicket:()=>refreshes++};
 vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('function startTicketPolling()'),source.indexOf('function renderCheckVisitScreen()')),c);
 c.startTicketPolling();tick();assert.equal(refreshes,1);
 c.document.visibilityState='hidden';tick();assert.equal(refreshes,1);
 c.document.visibilityState='visible';listeners.visibilitychange();assert.equal(refreshes,2);
 listeners.pageshow();assert.equal(refreshes,3);
 c.visitorHubOpen=true;tick();assert.equal(refreshes,3);
});
