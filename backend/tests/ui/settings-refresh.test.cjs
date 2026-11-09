const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../shared/portal-api.js'),'utf8');
function setup(){
 const handlers={},documentHandlers={},calls={cached:[],requests:0,hub:0};let revision=1;
 const c={document:{visibilityState:'visible',addEventListener:(name,fn)=>documentHandlers[name]=fn},window:{addEventListener:(name,fn)=>handlers[name]=fn,dispatchEvent:event=>handlers[event.type]?.(event)},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},sessionEnding:false,staff:false,visitor:true,visitorHubOpen:true,visitorView:'visit',myActiveQueueId:null,sessionStorage:{getItem:()=>null},request:async()=>{calls.requests++;return {revision,settings:{maintenanceMode:revision===2}};},cache:data=>calls.cached.push(data),renderHubOfficeNotice:()=>calls.hub++};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('  let settingsRevision='),source.indexOf('  if(staff)doLogout=')),c);
 return {c,calls,handlers,documentHandlers,revision:value=>revision=value};
}
test('settings invalidation refreshes cached rules before updating the visitor hub',async()=>{
 const {handlers,calls,revision}=setup();revision(2);await handlers['uniserve:changed']({detail:{resource:'settings'}});
 assert.equal(calls.cached[0].settings.maintenanceMode,true);assert.equal(calls.hub,1);
});
test('resuming a visible tab refreshes settings and unchanged revisions do not redraw',async()=>{
 const {c,calls,documentHandlers,revision}=setup();await c.refreshPortalSettings();revision(2);await documentHandlers.visibilitychange();
 assert.equal(calls.cached.at(-1).settings.maintenanceMode,true);assert.equal(calls.hub,1);
 await documentHandlers.visibilitychange();assert.equal(calls.hub,1);
 c.document.visibilityState='hidden';const count=calls.requests;await documentHandlers.visibilitychange();assert.equal(calls.requests,count);
});
