const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../shared/appointment-api.js'),'utf8');
test('new document review metadata replaces cached pending state while retaining file bytes',()=>{
 let db={appointments:[],transactions:[]};
 const c={loadDB:()=>structuredClone(db),saveDB:value=>{db=value;},localStorage:{setItem:(_,value)=>{db=JSON.parse(value);}},DB_KEY:'test',window:{}};
 vm.createContext(c);
 vm.runInContext(source.slice(0,source.indexOf('  function verify('))+'globalThis.testCache=cache;})();',c);
 c.testCache({appointment:{id:'a',shared:true,attachments:[{name:'ID.pdf',dataUrl:'data:application/pdf;base64,AA',review:{status:'Pending review'}}]}});
 c.testCache({appointment:{id:'a',shared:true,attachments:[{name:'ID.pdf',review:{status:'Accepted',reviewedAt:'2026-10-26'}}]}});
 const file=c.loadDB().appointments[0].attachments[0];assert.equal(file.review.status,'Accepted');assert.equal(file.dataUrl,'data:application/pdf;base64,AA');assert.equal(db.appointments[0].attachments[0].dataUrl,undefined);
 c.testCache({appointment:{id:'a',shared:true,attachments:[],documentVersions:{0:[{name:'previous.pdf',dataUrl:'PRIVATE OLD FILE'}]}}});
 assert.equal(db.appointments[0].documentVersions,undefined);assert.ok(!JSON.stringify(db).includes('PRIVATE OLD FILE'));
});
test('appointment fallback refreshes visible tickets only when live updates are unavailable',async()=>{
 let callback,calls=0;const c={setInterval:fn=>callback=fn,window:{},document:{visibilityState:'visible',getElementById:()=>null},visitorView:'checkvisit',visitorHubOpen:false,sessionStorage:{getItem:()=> 'a'},refreshAppointmentPass:async()=>calls++};vm.createContext(c);
 const start=source.indexOf('    let appointmentRefreshBusy=false;');vm.runInContext(source.slice(start,source.indexOf('    refreshAppointmentPass=async',start)),c);
 await callback();assert.equal(calls,1);c.document.visibilityState='hidden';await callback();assert.equal(calls,1);c.document.visibilityState='visible';c.window.UniServeRealtime={connected:true};await callback();assert.equal(calls,1);c.window.UniServeRealtime.connected=false;c.visitorHubOpen=true;await callback();assert.equal(calls,1);
});
