const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../User/user.js'),'utf8');
test('hours change refreshes an open appointment instead of navigating back to history',()=>{
 let refresh=0,navigate=0;const c={isOfficeHours:()=>false,renderHubOfficeNotice(){},portalWasOpen:true,closeModal(){},visitorHubOpen:false,sessionStorage:{getItem:()=> 'APT-TEST'},refreshAppointmentPass(){refresh++;},navigateVisitor(){navigate++;},visitorView:'history'};
 vm.createContext(c);const start=source.indexOf('function checkPortalHours()');vm.runInContext(source.slice(start,source.indexOf('setInterval(checkPortalHours',start)),c);c.checkPortalHours();assert.equal(refresh,1);assert.equal(navigate,0);
});
test('opening an appointment leaves the history page state',()=>{
 const start=source.indexOf('  if (embedded) {',source.indexOf('function showPassModalReadonly('));const end=source.indexOf('    closeModal(); sessionStorage.setItem',start);const c={embedded:true,visitorView:'history',visitStep:'pick',myActiveQueueId:null,setVisitorHubState(){},renderVisitorSidebar(){},stopTicketPolling(){},persistSession(){}};vm.createContext(c);vm.runInContext(source.slice(start,end)+'\n}',c);assert.equal(c.visitorView,'checkvisit');assert.equal(c.visitStep,'pass');
});

