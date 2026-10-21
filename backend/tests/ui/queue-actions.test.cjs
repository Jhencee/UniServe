const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../Admin/admin.js'),'utf8');
function context(){const messages=[];let resolve,reject;const pending=new Promise((yes,no)=>{resolve=yes;reject=no;});const requests=[];const c={loadDB:()=>({queues:[{id:'q',status:'Called',recallCount:1}],services:[]}),UniServeUX:{request:(...args)=>{requests.push(args);return pending;}},renderQueueDashboard:async()=>{},toast:(text,type)=>messages.push({text,type}),escapeHtml:String,queueRef:q=>q.id,closeModal(){},document:{getElementById:()=>({value:'other'})},Date};vm.createContext(c);return {c,messages,requests,resolve,reject};}
test('recall reports success only after backend confirmation',async()=>{
 const s=context();vm.runInContext(source.slice(source.indexOf('async function handleRecall('),source.indexOf('async function adminCancelQueue(')),s.c);
 const pending=s.c.handleRecall('q');assert.equal(s.messages.length,0);assert.equal(s.requests[0][2].recallCount,2);
 s.resolve({});await pending;assert.equal(s.messages[0].type,'ok');
});
test('transfer failure never reports success',async()=>{
 const s=context();let controls;s.c.openModal=(title,body,buttons)=>controls=buttons;
 vm.runInContext(source.slice(source.indexOf('function openTransferModal('),source.indexOf('function openQueueVisitDetail(')),s.c);
 s.c.openTransferModal('q');const pending=controls[1].action();assert.equal(s.messages.length,0);
 s.reject(Error('Server rejected transfer'));await pending;assert.equal(s.messages.length,1);assert.equal(s.messages[0].type,'err');
});
test('Call Now awaits the backend and reports its rejection',async()=>{
 const s=context();s.c.q={id:'q'};
 const start=source.indexOf("buttons.push({ label: 'Call Now'");const action=source.indexOf('action: async () => {',start);const end=source.indexOf('    } });',action);
 vm.runInContext('callNow=async()=>{'+source.slice(action+'action: async () => {'.length,end)+'}',s.c);
 const pending=s.c.callNow();assert.equal(s.messages.length,0);assert.equal(s.requests[0][2].status,'Called');
 s.reject(Error('Already assigned'));await pending;assert.equal(s.messages[0].type,'err');
});
test('queue counts distinguish Called from Serving',()=>{
 const list=[{status:'Called'},{status:'Serving'},{status:'Serving'},{status:'Waiting'}];const c={todaysQueue:()=>list,callableQueue:()=>[]};vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('function queueStats('),source.indexOf('function isServiceDelayed(')),c);
 const counts=c.queueStats({});assert.equal(counts.called,1);assert.equal(counts.serving,2);assert.equal(counts.waiting,1);
});
