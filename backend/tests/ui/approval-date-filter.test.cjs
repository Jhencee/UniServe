const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../Admin/admin.js'),'utf8');
test('choosing an approval date opens Requested and clears conflicting filters',()=>{
 let renders=0;const input={value:'old search'},c={apptFilter:'all',RANGES:{appt:{from:'2026-10-01',to:'2026-10-31'}},document:{getElementById:()=>input},renderAppointments:()=>renders++,renderApptTable:()=>{}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function setApprovalDate('),source.indexOf('function renderApptTable()')),c);c.setApprovalDate('2026-11-27');assert.equal(c.apptFilter,'Requested');assert.equal(c.RANGES.appt.from,'');assert.equal(c.RANGES.appt.to,'');assert.equal(input.value,'');assert.equal(renders,1);
});
test('Requested list shows only the selected date',()=>{
 const body={innerHTML:''},date={value:'2026-11-27'},search={value:''};const rows=['2026-11-27','2026-11-28'].map((day,i)=>({id:'a'+i,code:'APT-'+i,name:'Visitor '+i,date:day,status:'Requested',shared:true,service:'Test',revision:0}));
 const c={apptFilter:'Requested',RANGES:{appt:{}},document:{getElementById:id=>({apptBody:body,approvalDate:date,apptSearch:search})[id]},loadDB:()=>({appointments:rows,queues:[]}),UniServeUX:{conflict:()=>false,timeLabel:String},inRange:()=>true,appointmentReadiness:()=>({status:'READY'}),escapeHtml:String,readinessPillHtml:()=>'',statusPill:()=>'',arrivalStatusPill:()=>'',appointmentActionsHtml:()=>'',syncAppointmentSelection(){}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function renderApptTable()'),source.indexOf('function syncAppointmentSelection()')),c);c.renderApptTable();assert.match(body.innerHTML,/Visitor 0/);assert.doesNotMatch(body.innerHTML,/Visitor 1/);
});
