const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../Admin/admin.js'),'utf8');
function render(){
 const content={innerHTML:''};
 const db={queues:[{id:'waiting',status:'Waiting'},{id:'called',status:'Called'},{id:'serving',status:'Serving'},{id:'private',status:'Waiting',restricted:true},{id:'done',status:'Completed',createdAt:'2026-11-17',completedAt:'2026-11-18T02:00:00Z'},{id:'old',status:'Completed',completedAt:'2026-11-17T02:00:00Z'}],appointments:[{status:'Requested'},{status:'Requested',restricted:true},{status:'Booked',rescheduleRequested:true}],transactions:[{status:'Pending',createdAt:'2026-11-18T01:00:00Z'}]};
 const c={loadDB:()=>db,OfficeCalendar:{parts:(date)=>({date:date?new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(date):'2026-11-18'})},isDue:()=>true,document:{getElementById:()=>content},window:{},dashboardScheduledVisitors:()=>'<section>Scheduled arrivals</section>',svgLineChart:()=>'<svg></svg>',adminOfficeInsightsHtml:()=>'<section>Office performance</section>',emptyChart:t=>t,Date,appointmentView:'calendar',apptFilter:'all',RANGES:{appt:{}},staffViewMemory:{appointments:{apptFilter:'all'}},navigate:page=>{c.destination=page}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function renderDashboard() {'),source.indexOf('let adminQueuePollTimer')),c);c.renderDashboard();return{html:content.innerHTML,c};
}
test('daily dashboard separates queue states, counts completions by completion date and excludes restricted data',()=>{
 const {html}=render();for(const label of ['Waiting','Called','Serving','Completed today'])assert.match(html,new RegExp('class="lbl">'+label+'</div><div class="val">1</div>'));
 assert.match(html,/Appointment requests<\/span><strong>1/);assert.match(html,/Schedule changes<\/span><strong>1/);
 assert.ok(html.indexOf('Scheduled arrivals')<html.indexOf('Transaction activity'));assert.doesNotMatch(html,/Serving \/ called|Visitor satisfaction|Service request trends/);
});
test('dashboard review link opens the requested list without old date filters',()=>{const {c}=render();c.openDashboardAppointments('Requested');assert.equal(c.destination,'appointments');assert.equal(c.appointmentView,'list');assert.equal(c.staffViewMemory.appointments.apptFilter,'Requested');assert.equal(c.RANGES.appt.from,'');});
