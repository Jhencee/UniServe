const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../Admin/admin.js'),'utf8');
test('My Queue renders every active visitor and blocks another call by default',async()=>{
 const el={innerHTML:''};const mine=[{id:'first',status:'Called'},{id:'second',status:'Serving'}];
 const c={sharedQueueLoading:false,loadSharedQueue:async()=>{},state_view:'queue',document:{querySelector:()=>null,getElementById:()=>el},loadDB:()=>({queues:mine}),queueStats:()=>({next:{id:'next'},waiting:1,serving:2}),myQueueEntries:()=>mine,waitingQueueSorted:()=>[],currentUser:{id:'one',fullName:'Admin One'},UniServeUX:{previousDay:()=>false},escapeHtml:String,fmtMinutes:()=>'',icon:()=>'',renderMyQueueCard:(db,q)=>`CARD:${q.id}`,queueRef:q=>q.id,serviceQueueLabel:()=>'',entryMethodLabel:()=>'',startAdminQueuePolling(){}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('async function renderQueueDashboard()'),source.indexOf('function renderMyQueueCard(')),c);
 await c.renderQueueDashboard();assert.ok(el.innerHTML.includes('CARD:first'));assert.ok(el.innerHTML.includes('CARD:second'));
 const callButton=el.innerHTML.match(/<button[^>]*onclick="handleCallNext\(\)"[^>]*>/)[0];assert.ok(callButton.includes('disabled'));
});
test('active visitors have independent begin and complete actions',()=>{
 const c={visitRequirements:()=>[],isServiceDelayed:()=>false,escapeHtml:String,queueRef:q=>q.id,serviceQueueLabel:()=>'',entryMethodLabel:()=>'',icon:()=>''};vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('function renderMyQueueCard('),source.indexOf('async function handleCallNext(')),c);
 const called=c.renderMyQueueCard({}, {id:'first',status:'Called'}),serving=c.renderMyQueueCard({}, {id:'second',status:'Serving'});
 assert.ok(called.includes("handleBeginServing('first')"));assert.ok(serving.includes("handleCompleteQueue('second')"));assert.ok(!serving.includes("handleCompleteQueue('first')"));
});
