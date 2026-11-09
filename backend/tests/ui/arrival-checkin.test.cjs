const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../Admin/admin.js'),'utf8');
function setup(records){
 const elements={todayArrivalsList:{innerHTML:'',isConnected:true},arrivalVisitId:{value:'  vis-test  '}};
 const context={document:{getElementById:id=>elements[id]},loadDB:()=>({appointments:records}),today:()=> '2026-10-23',OfficeCalendar:{status:()=>({open:true})},UniServeUX:{conflict:r=>r.conflict||'',timeLabel:String},escapeHtml:value=>String(value).replaceAll('<','&lt;').replaceAll('"','&quot;'),statusPill:status=>'<span>'+status+'</span>',SharedAppointments:{request:async()=>({appointments:records}),cache:()=>{}},renderApptTable:()=>{}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function arrivalVisitorHtml('),source.indexOf('function setApptFilter(')),context);return {context,elements};
}
const booking=(extra={})=>({id:'a',visitId:'VIS-TEST',name:'Visitor Name',date:'2026-10-23',time:'10:00',service:'Service',status:'Booked',shared:true,...extra});
test('quick check-in is offered only for eligible appointments today',()=>{
 const {context:c}=setup([]);assert.match(c.arrivalVisitorHtml(booking()),/>Check in<\/button>/);
 for(const extra of [{date:'2026-10-24'},{status:'Requested'},{status:'Checked-in'},{conflict:'Closed'},{shared:false}])assert.doesNotMatch(c.arrivalVisitorHtml(booking(extra)),/>Check in<\/button>/);
 c.OfficeCalendar.status=()=>({open:false});assert.doesNotMatch(c.arrivalVisitorHtml(booking()),/>Check in<\/button>/);
});
test('today arrivals exclude private and other-day records and prioritize visitors awaiting check-in',()=>{
 const {context:c,elements:e}=setup([booking({name:'Already arrived',status:'Checked-in',time:'08:00'}),booking({name:'Expected visitor'}),booking({name:'Private visitor',restricted:true}),booking({name:'Tomorrow visitor',date:'2026-10-24'}),booking({name:'Pending visitor',status:'Requested'})]);e.arrivalVisitId.value='';c.renderTodayArrivals();
 const html=e.todayArrivalsList.innerHTML;assert.ok(html.includes('Expected visitor'));assert.ok(!html.includes('Already arrived'));for(const name of ['Private visitor','Tomorrow visitor','Pending visitor'])assert.ok(!html.includes(name));
});
test('lookup refreshes records and matches Visit IDs regardless of casing or surrounding spaces',async()=>{
 const {context:c,elements:e}=setup([booking(),booking({name:'Private visitor',restricted:true})]);const button={isConnected:true};await c.findArrivalVisitor({querySelector:()=>button});assert.match(e.todayArrivalsList.innerHTML,/Visitor Name/);assert.doesNotMatch(e.todayArrivalsList.innerHTML,/Private visitor/);assert.equal(button.disabled,false);
});
test('lookup explains missing records and supports visitor name searches',async()=>{
 const {context:c,elements:e}=setup([booking()]);const form={querySelector:()=>({isConnected:true})};e.arrivalVisitId.value='unknown';await c.findArrivalVisitor(form);assert.match(e.todayArrivalsList.innerHTML,/No matching visitor/);e.arrivalVisitId.value='visitor name';await c.findArrivalVisitor(form);assert.match(e.todayArrivalsList.innerHTML,/VIS-TEST/);
});

test('clearing the search restores todays waiting list without duplicate result panels',()=>{
 const {context:c,elements:e}=setup([booking(),booking({name:'Already checked in visitor',status:'Checked-in'})]);
 e.arrivalVisitId.value='visitor';c.renderTodayArrivals();assert.match(e.todayArrivalsList.innerHTML,/Already checked in/);
 e.arrivalVisitId.value='';c.renderTodayArrivals();assert.doesNotMatch(e.todayArrivalsList.innerHTML,/Already checked in/);assert.match(e.todayArrivalsList.innerHTML,/Visitor Name/);
 assert.ok(!source.includes('id="arrivalLookupResults"'));assert.ok(!source.includes('id="todayArrivalsTitle"'));
});
