const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../Admin/admin.js'),'utf8');
test('My Queue renders every active visitor and blocks another call by default',async()=>{
 const el={innerHTML:''};const mine=[{id:'first',status:'Called'},{id:'second',status:'Serving'}];
 const c={sharedQueueLoading:false,loadSharedQueue:async()=>{},state_view:'queue',document:{querySelector:()=>null,getElementById:()=>el},loadDB:()=>({queues:mine}),queueStats:()=>({next:{id:'next'},waiting:1,serving:2}),myQueueEntries:()=>mine,waitingQueueSorted:()=>[],currentUser:{id:'one',fullName:'Admin One'},UniServeUX:{previousDay:()=>false},escapeHtml:String,fmtMinutes:()=>'',icon:()=>'',renderMyQueueCard:(db,q)=>`CARD:${q.id}`,queueRef:q=>q.id,serviceQueueLabel:()=>'',entryMethodLabel:()=>'',startAdminQueuePolling(){}};
 c.fmtCompactMinutes=()=>'';
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('async function renderQueueDashboard()'),source.indexOf('function renderMyQueueCard(')),c);
 await c.renderQueueDashboard();assert.ok(el.innerHTML.includes('CARD:first'));assert.ok(el.innerHTML.includes('CARD:second'));
 const callButton=el.innerHTML.match(/<button[^>]*onclick="handleCallNext\(\)"[^>]*>/)[0];assert.ok(callButton.includes('disabled'));
});
test('active visitors have independent begin and complete actions',()=>{
 const c={queueRequirementState:()=>({ready:true}),queueRequirementSaving:new Set(),queueRequirementsHtml:()=>'',visitRequirements:()=>[],isServiceDelayed:()=>false,escapeHtml:String,queueRef:q=>q.id,serviceQueueLabel:()=>'',entryMethodLabel:()=>'',icon:()=>''};vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('function renderMyQueueCard('),source.indexOf('async function handleCallNext(')),c);
 const called=c.renderMyQueueCard({}, {id:'first',status:'Called'}),serving=c.renderMyQueueCard({}, {id:'second',status:'Serving'});
 assert.ok(called.includes("handleBeginServing('first')"));assert.ok(serving.includes("handleCompleteQueue('second')"));assert.ok(!serving.includes("handleCompleteQueue('first')"));
});

test('requirements use the service catalogue and checks remain scoped to the visit and service',()=>{
 const c={Set,currentUser:{id:'one'},findService:(db,key)=>db.services.find(s=>s.key===key),escapeHtml:s=>String(s).replaceAll('<','&lt;').replaceAll('"','&quot;')};vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('const queueRequirementSaving'),source.indexOf('function renderMyQueueCard(')),c);
 const db={services:[{key:'a',requirements:['Clearance','Student ID','Clearance']},{key:'b',requirements:['Clearance']}]};
 const first={id:'first',serviceKey:'a',status:'Serving',assignedAdminId:'one',requirementChecks:[{serviceKey:'a',requirement:'Clearance',checked:true}]};
 assert.ok(c.queueRequirementsHtml(db,first).includes('1 of 2 checked'));
 assert.ok(c.queueRequirementsHtml(db,{...first,id:'second',requirementChecks:[]}).includes('0 of 2 checked'));
 assert.ok(c.queueRequirementsHtml(db,{...first,serviceKey:'b'}).includes('0 of 1 checked'));
 assert.ok(c.queueRequirementsHtml(db,{...first,status:'Completed'}).includes('disabled'));
 assert.ok(c.queueRequirementsHtml(db,{...first,assignedAdminId:'another'}).includes('disabled'));
 assert.equal(c.queueRequirementsHtml(db,{...first,restricted:true}),'');
 assert.ok(c.queueRequirementsHtml({services:[{key:'a',requirements:['<script>']}]},first).includes('&lt;script>'));
});

test('accepted matched appointment uploads satisfy checklist items without assuming every upload is complete',()=>{
 const c={Set};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('const queueRequirementSaving'),source.indexOf('function renderMyQueueCard(')),c);
 c.findService=(db,key)=>db.services.find(s=>s.key===key);
 const db={services:[{key:'a',requirements:['A','B']}],appointments:[{id:'appt',serviceKey:'a',attachments:[{review:{status:'Accepted',requirement:'A',serviceKey:'a'}},{review:{status:'Accepted',requirement:'A',serviceKey:'a'}},{review:{status:'Pending review',requirement:'B'}},{review:{status:'Accepted'}}]}]};
 const q={id:'q',serviceKey:'a',appointmentId:'appt',requirementChecks:[]};
 assert.equal(c.queueRequirementState(db,q).checked,1);assert.equal(c.queueRequirementState(db,q).ready,false);
 q.requirementChecks=[{serviceKey:'a',requirement:'B',checked:true}];assert.equal(c.queueRequirementState(db,q).ready,true);
 db.appointments[0].serviceKey='old-service';assert.equal(c.queueRequirementState(db,q).checked,1);
});
