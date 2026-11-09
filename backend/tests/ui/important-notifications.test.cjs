const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../shared/important-notifications.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup(token=true,admin=false,superAdmin=false){
 const handlers={},storage=new Map(token?[['ossuniserve_visitor_token','fixture-token']]:[]),button={setAttribute(){},closest:()=>null},badge={textContent:'2',dataset:{}};let response={ok:true,status:200,json:async()=>({notifications:[{id:'doc-1',title:'Document needs correction',detail:'<PRIVATE>',kind:'system',target:''},{id:'doc-1',title:'Document needs correction',detail:'<PRIVATE>',kind:'system',target:''}]})},poll,modal,requests=0,attached=0;
 const c={visitorView:'visit',document:{visibilityState:'visible',querySelector:selector=>selector.includes('notification-bell-count')?null:({prepend(){attached++;}}),createElement:()=>button,addEventListener:(name,fn)=>handlers[name]=fn},sessionStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)},loadDB:()=>({systemSettings:{maintenanceMode:false}}),setInterval:fn=>poll=fn,UniServeConfig:{apiBase:'http://fixture/api'},AbortSignal,fetch:async()=>{requests++;return response;},openModal:(title,body)=>modal={title,body},closeModal(){},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},addEventListener:(name,fn)=>handlers[name]=fn,dispatchEvent(){}};if(admin||superAdmin){c.state_view='profile';c.currentUser={id:'admin',role:superAdmin?'SUPER_ADMIN':'ADMIN'};if(token)storage.set('ossuniserve_session',JSON.stringify({token:'staff-fixture'}));}c.window=c;vm.createContext(c);vm.runInContext(source,c);
 c.document.querySelector=selector=>selector.includes('notification-bell-count')?badge:({prepend(){attached++;}});
 return {c,button,badge,attached:()=>attached,requests:()=>requests,modal:()=>modal,poll:()=>poll(),response:r=>response=r};
}
test('Super Admin updates deduplicate, escape details and remember read IDs',async()=>{
 const s=setup(true,false,true);await tick();assert.equal(s.c.importantNotifications.length,1);assert.equal(Number(s.badge.textContent),3);await s.c.openImportantNotification('doc-1');assert.ok(s.modal().body.includes('&lt;PRIVATE&gt;'));assert.deepEqual(JSON.parse(s.c.sessionStorage.getItem('important-seen:admin')),['doc-1']);await s.poll();assert.equal(Number(s.badge.textContent),3);
});
test('staff updates require authorization and clear on expired sessions',async()=>{
 const anonymous=setup(false,false,true);await tick();assert.equal(anonymous.requests(),0);assert.equal(anonymous.c.importantNotifications.length,0);
 const s=setup(true,false,true);await tick();s.response({ok:false,status:401});await s.poll();assert.equal(s.c.importantNotifications.length,0);assert.equal(Number(s.badge.textContent),2);
});

test('Admins retain the update feed and actions without a redundant menu button',async()=>{const s=setup(true,true);await tick();assert.equal(s.attached(),0);assert.equal(s.c.importantNotifications.length,1);assert.equal(typeof s.c.openImportantNotification,'function');});

test('visitor portal does not initialize update buttons or requests',async()=>{const s=setup();await tick();assert.equal(s.attached(),0);assert.equal(s.requests(),0);assert.equal(s.c.openImportantNotification,undefined);});
