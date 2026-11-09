const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../Admin/confidential-access.js'),'utf8');
test('Head Admin gets an explicit Visitor Log print choice and unlocks before printing details',async()=>{
 const record={id:'case-1'},calls={prints:[],unlocks:[],refresh:0};let modal;
 const c={printTransaction(){},printVisitorLog:include=>calls.prints.push(include),loadDB:()=>({transactions:[record]}),logbookRows:()=>[{restricted:true,confidentialCaseId:'case-1'}],currentUser:{confidentialApprover:true},closeModal(){},openModal:(title,body,buttons)=>modal={title,body,buttons},state_view:'logbook',renderVisitorLogbook:async()=>{},SharedAppointments:{reloadRecords:async()=>calls.refresh++},requireConfUnlock:async(r,callback,scope)=>{calls.unlocks.push(scope);await callback();},toast(){},escapeHtml:String};vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('  const originalPrint = printTransaction;'),source.indexOf('  printTransaction = function')),c);
 c.printVisitorLog();assert.equal(calls.prints.length,0);assert.match(modal.body,/unlock access with your password/);
 await modal.buttons.find(b=>b.label==='Unlock and print').action();await new Promise(r=>setImmediate(r));
 assert.deepEqual(calls.unlocks,['print']);assert.deepEqual(calls.prints,[true]);assert.equal(calls.refresh,1);
});
test('ordinary Admin can print a masked log without a combined unlock option',()=>{
 let modal;const prints=[];const c={printTransaction(){},printVisitorLog:include=>prints.push(include),loadDB:()=>({}),logbookRows:()=>[{restricted:true,confidentialCaseId:'case-1'}],currentUser:{confidentialApprover:false},openModal:(title,body,buttons)=>modal={buttons},closeModal(){}};vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('  const originalPrint = printTransaction;'),source.indexOf('  printTransaction = function')),c);c.printVisitorLog();assert.ok(!modal.buttons.some(b=>b.label==='Unlock and print'));modal.buttons.find(b=>b.label==='Print redacted copy').action();assert.deepEqual(prints,[false]);
});
