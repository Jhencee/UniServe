const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../Admin/admin.js'),'utf8');

test('an in-flight queue refresh cannot restore Serving after completion is confirmed',async()=>{
 let resolveRead;
 const serving={id:'q',shared:true,status:'Serving'},completed={...serving,status:'Completed',completedAt:'2026-11-10T08:00:00Z'};
 let db={queues:[serving]};
 const c={DB_KEY:'fixture',AbortSignal,window:{},loadDB:()=>structuredClone(db),loadSession:()=>({token:'fixture'}),
  localStorage:{setItem:(key,value)=>{db=JSON.parse(value);}},
  fetch:()=>new Promise(resolve=>{resolveRead=resolve;})};
 vm.createContext(c);
 vm.runInContext('const sharedQueueSnapshot=new Map();'+source.slice(source.indexOf('async function loadSharedQueue()'),source.indexOf('function loadSession()')),c);
 c.serving=serving;c.completed=completed;
 vm.runInContext("sharedQueueSnapshot.set('q',JSON.stringify(serving))",c);
 const pending=c.loadSharedQueue();
 db={queues:[completed]};
 vm.runInContext("sharedQueueSnapshot.set('q',JSON.stringify(completed))",c);
 resolveRead({ok:true,json:async()=>({queues:[serving]})});await pending;
 assert.equal(db.queues[0].status,'Completed');
 assert.equal(db.queues[0].completedAt,completed.completedAt);
 // A fresh read still accepts subsequent server updates.
 const next=c.loadSharedQueue();
 resolveRead({ok:true,json:async()=>({queues:[{...completed,feedback:{rating:5}}]})});await next;
 assert.equal(db.queues[0].feedback.rating,5);
});
test('redacting a cached completed confidential queue does not send a PATCH or display an alert',async()=>{
 const calls=[],alerts=[],c={DB_KEY:'fixture',localStorage:{setItem(){}},fetch:async(url,options)=>{calls.push({url,options});return {ok:false,json:async()=>({message:'Confidential case access and an active unlock are required.'})};},loadSession:()=>({token:'fixture'}),toast:message=>alerts.push(message),escapeHtml:String};vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('const sharedQueueSnapshot ='),source.indexOf('let sharedQueueLoading =')),c);
 vm.runInContext(`sharedQueueSnapshot.set('q',JSON.stringify({id:'q',shared:true,status:'Completed',serviceKey:'incident_report',name:'Private name',contact:'09123456789',feedback:{rating:5}}));`,c);
 c.saveDB({queues:[{id:'q',shared:true,status:'Completed',serviceKey:'incident_report',name:'Restricted record',restricted:true,privateCached:true}]});
 await vm.runInContext('sharedQueueWrites',c);assert.equal(calls.length,0);assert.deepEqual(alerts,[]);
});
test('an intentional queue transition sends only writable fields',async()=>{
 const calls=[],c={DB_KEY:'fixture',localStorage:{setItem(){}},fetch:async(url,options)=>{calls.push(JSON.parse(options.body));return {ok:true,json:async()=>({})};},loadSession:()=>({token:'fixture'}),toast(){},escapeHtml:String};vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('const sharedQueueSnapshot ='),source.indexOf('let sharedQueueLoading =')),c);
 vm.runInContext(`sharedQueueSnapshot.set('q',JSON.stringify({id:'q',shared:true,status:'Waiting'}));`,c);
 c.saveDB({queues:[{id:'q',shared:true,status:'Called',name:'Private name',email:'private@gmail.com',permissions:{editCase:false}}]});await vm.runInContext('sharedQueueWrites',c);
 assert.deepEqual(calls,[{status:'Called'}]);
});
