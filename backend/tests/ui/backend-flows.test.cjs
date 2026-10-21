const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const root=path.resolve(__dirname,'../../..');
function storage(initial={}){const values=new Map(Object.entries(initial));return {getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
test('shared chat loads from API, carries staff authorization and stays out of persistent storage',async()=>{
 const db={users:[],chats:[],queues:[],appointments:[],transactions:[],visitorLog:[],systemSettings:{}},calls=[];
 const chat={id:'chat1',visitorName:'Visitor',email:'visitor@gmail.com',messages:[{text:'Private message'}],shared:true,status:'Open'};
 const c={DB_KEY:'test-db',state_view:'messages',currentUser:{id:'admin'},sessionStorage:storage({ossuniserve_session:JSON.stringify({token:'staff-token'})}),localStorage:storage(),Headers,AbortSignal,AbortController,DOMException,Event,addEventListener:()=>{},document:{visibilityState:'visible',getElementById:()=>null,querySelector:()=>null},setInterval:()=>0,loadDB:()=>JSON.parse(c.localStorage.getItem('test-db')||JSON.stringify(db)),saveDB:value=>c.localStorage.setItem('test-db',JSON.stringify(value)),renderMessages:()=>{},openStaffChat:()=>{},renderChatThreadList:()=>{},openModal:()=>{},escapeHtml:x=>x,toast:()=>{},renderBubbles:()=>'',closeModal:()=>{},endSession:()=>{},renderQueueDashboard:()=>{},pendingStaffAttachments:[],UniServeUX:{confirm:async()=>true}};
 c.fetch=async(url,options={})=>{calls.push({url,options});const data=url.endsWith('/settings')?{settings:{maintenanceMode:false},revision:0}:url.endsWith('/chats')?{chats:[chat]}:{chat};return {ok:true,json:async()=>data};};c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'shared/portal-api.js'),'utf8'),c);
 await c.renderMessages();assert.equal(c.loadDB().chats[0].messages[0].text,'Private message');assert.equal(JSON.parse(c.localStorage.getItem('test-db')).chats.length,0);assert.equal(calls.find(r=>r.url.endsWith('/chats')).options.headers.get('Authorization'),'Bearer staff-token');
});
test('private snapshots preserve data in memory while excluding names, Gmail and file bodies from disk',()=>{
 const c={DB_KEY:'test-db',localStorage:storage(),loadDB:()=>JSON.parse(c.localStorage.getItem('test-db')||'{}'),saveDB:value=>c.localStorage.setItem('test-db',JSON.stringify(value))};c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'shared/private-record-cache.js'),'utf8'),c);
 c.SecureState.persist({appointments:[{id:'a1',visitId:'VIS-TEST',name:'Private Name',email:'private@gmail.com',contact:'09123456789',shared:true,attachments:[{dataUrl:'data:secret'}]}],queues:[],visitorLog:[]});
 const disk=c.localStorage.getItem('test-db');assert(!disk.includes('Private Name'));assert(!disk.includes('private@gmail.com'));assert(!disk.includes('data:secret'));assert.equal(c.loadDB().appointments[0].name,'Private Name');c.SecureState.clear();assert.equal(c.loadDB().appointments[0].name,'Restricted record');
});

test('queue snapshots collapse local and server copies by Visit ID across reload and logout',()=>{
 const c={DB_KEY:'test-db',localStorage:storage(),loadDB:()=>JSON.parse(c.localStorage.getItem('test-db')||'{}'),saveDB:value=>c.localStorage.setItem('test-db',JSON.stringify(value))};c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'shared/private-record-cache.js'),'utf8'),c);
 c.SecureState.persist({queues:[{id:'local',visitId:'VIS-A',status:'Waiting'},{id:'server',visitId:'VIS-A',status:'Called',shared:true},{id:'server',visitId:'VIS-A',status:'Called',shared:true},{id:'other',visitId:'VIS-B',number:'A-001',status:'Waiting',shared:true}],appointments:[],visitorLog:[]});
 assert.equal(c.loadDB().queues.length,2);assert.equal(c.loadDB().queues[0].id,'server');assert.equal(c.loadDB().queues[0].status,'Called');c.SecureState.clear();assert.equal(c.loadDB().queues.length,2);
});

test('Super Admin refresh replaces deleted report rows and loads current services and accounts',async()=>{
 const db={users:[],chats:[],queues:[{id:'deleted',status:'Waiting'}],appointments:[],transactions:[],visitorLog:[],activityLog:[],services:[{key:'old'}],systemSettings:{}},calls=[];
 let dashboard=0,admins=0;
 const c={DB_KEY:'test-db',state_view:'dashboard',currentUser:{id:'super'},sessionStorage:storage({ossuniserve_session:JSON.stringify({token:'staff-token'})}),localStorage:storage(),Headers,AbortSignal,AbortController,DOMException,Event,addEventListener:()=>{},document:{visibilityState:'visible',getElementById:()=>null,querySelector:()=>null},setInterval:()=>0,loadDB:()=>JSON.parse(c.localStorage.getItem('test-db')||JSON.stringify(db)),saveDB:value=>c.localStorage.setItem('test-db',JSON.stringify(value)),saveSettings:()=>{},renderDashboard:()=>dashboard++,renderReports:()=>{},renderSettings:()=>{},renderActivityLog:()=>{},refreshAdmins:async()=>admins++,openModal:()=>{},escapeHtml:x=>x,toast:message=>{throw Error(message);},closeModal:()=>{},endSession:()=>{}};
 c.fetch=async(url,options={})=>{calls.push({url,options});const data=url.endsWith('/settings')?{settings:{},revision:0}:url.endsWith('/services')?{services:[{key:'current',label:'Current service'}]}:{activityLog:[],queues:[],transactions:[],appointments:[]};return {ok:true,json:async()=>data};};
 c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'shared/portal-api.js'),'utf8'),c);
 await c.renderDashboard();assert.equal(c.loadDB().queues.length,0);assert.equal(c.loadDB().services[0].key,'current');assert.equal(admins,1);assert.equal(dashboard,1);
 c.state_view='profile';await c.renderDashboard();assert.equal(dashboard,1,'late dashboard response must not replace another screen');
 assert.ok(calls.every(call=>(call.options.method||'GET')==='GET'));
});

test('ending a staff session aborts pending reads and suppresses late alerts',async()=>{
 const db={chats:[],queues:[],appointments:[],transactions:[],visitorLog:[],systemSettings:{}},alerts=[],ends=[];let finish;
 const c={state_view:'profile',currentUser:null,Headers,AbortSignal,AbortController,DOMException,Event,sessionStorage:storage(),localStorage:storage(),DB_KEY:'db',loadDB:()=>db,saveDB:()=>{},document:{visibilityState:'visible'},addEventListener:()=>{},dispatchEvent:()=>{},endSession:reason=>ends.push(reason),toast:m=>alerts.push(m),fetch:async url=>url.endsWith('/settings')?{ok:true,json:async()=>({settings:{}})}:new Promise(resolve=>finish=resolve)};
 c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'shared/portal-api.js'),'utf8'),c);
 const pending=c.fetch('http://127.0.0.1:8000/api/reports').catch(e=>{c.toast(e.message);return e.name;});
 c.endSession();c.endSession();finish({ok:false,status:401,json:async()=>({message:'Please sign in again.'})});
 assert.equal(await pending,'AbortError');assert.equal(ends.length,1);assert.deepEqual(alerts,[]);
 await assert.rejects(c.fetch('http://127.0.0.1:8000/api/reports'),{name:'AbortError'});
});
