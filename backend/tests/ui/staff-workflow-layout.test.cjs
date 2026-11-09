const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../Admin/admin.js'),'utf8');
function setup(){
 const fields={apptSearch:{id:'apptSearch',value:'Visitor',type:'search'}};
 const c={state_view:'appointments',apptFilter:'Requested',txnFilter:'Pending',txnServiceFilter:'guidance',currentUser:{confidentialApprover:true},window:{headAccessRequestNotifications:[{id:1}]},OfficeCalendar:{parts:()=>({date:'2026-11-06'})},document:{querySelectorAll:()=>Object.values(fields),getElementById:id=>fields[id]},renderApptTable:()=>{},renderTodayArrivals:()=>{},renderLogbookTable:()=>{},renderTxnTable:()=>{}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('const staffViewMemory='),source.indexOf('function navigate(key)')),c);return {c,fields};
}
test('returning to a staff view restores its search without persisting credentials',()=>{
 const {c,fields}=setup();fields.password={id:'password',value:'secret',type:'password'};
 c.rememberStaffView();fields.apptSearch.value='';c.restoreStaffView('appointments');
 assert.equal(fields.apptSearch.value,'Visitor');assert.equal(vm.runInContext('staffViewMemory.appointments.apptFilter',c),'Requested');
 assert.equal(vm.runInContext('staffViewMemory.appointments.fields.password',c),undefined);
});
