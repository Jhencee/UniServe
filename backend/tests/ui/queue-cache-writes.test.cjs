const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../Admin/admin.js'),'utf8');
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
