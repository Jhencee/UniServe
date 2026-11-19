const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../Admin/admin.js'),'utf8');
test('report periods start at Philippine calendar boundaries',()=>{
 const c={today:()=> '2026-11-19',Date};vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('function periodStart(p)'),source.indexOf('function buildReport()')),c);
 for(const [period,date] of [['Daily','2026-11-18T16:00:00.000Z'],['Weekly','2026-11-15T16:00:00.000Z'],['Monthly','2026-10-31T16:00:00.000Z'],['Quarterly','2026-09-30T16:00:00.000Z']])assert.equal(c.periodStart(period).toISOString(),date);
});
test('report durations preserve seconds and distinguish missing samples from zero',()=>{
 const c={};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function reportDuration('),source.indexOf('function renderReportOverview(')),c);
 assert.equal(c.reportDuration(1.1),'1 min 06 sec');assert.equal(c.reportDuration(0),'0 min 00 sec');assert.equal(c.reportDuration(null),'No timed records');
});
test('full report document is hidden while overview and export actions remain available',()=>{
 const render=source.slice(source.indexOf('async function renderReports()'),source.indexOf('function reportDuration('));
 assert.match(render,/id="reportSheet" hidden aria-hidden="true"/);assert.match(render,/id="reportOverview"/);assert.match(render,/renderReportOverview\(\)/);assert.ok(!render.includes('UniServeUX.reportHtml'));
});
test('appointment summary uses scheduled dates and separates unscheduled requests',()=>{
 const c={};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function reportAppointmentSummary('),source.indexOf('function renderReportOverview(')),c);
 const html=c.reportAppointmentSummary({appointments:[{date:'2026-11-19',status:'Completed'},{date:'2026-11-18',status:'Completed'},{date:'2026-11-20',status:'Booked'},{status:'Requested'},{date:'2026-11-19',status:'Requested'}]},'2026-11-19','2026-11-19');
 assert.match(html,/<dt>Completed<\/dt><dd>1<\/dd>/);assert.match(html,/<dt>Confirmed<\/dt><dd>0<\/dd>/);assert.match(html,/<dt>Awaiting approval<\/dt><dd>1<\/dd>/);assert.match(html,/Unscheduled requests: <strong>1<\/strong>/);
});
test('print report uses compact tables, protects confidential identities, and excludes future records',()=>{
 const elements={repTitle:{},repPeriodLbl:{},repGenLbl:{},repBody:{}};
 const db={services:[{key:'general',label:'General'}],appointments:[],transactions:[{code:'PUBLIC',name:'Visitor',service:'general',status:'Completed',createdAt:new Date('2020-01-02'),servedBy:'Staff'},{code:'PRIVATE',name:'Secret visitor',service:'private',status:'Completed',createdAt:new Date('2020-01-02')},{code:'FUTURE',name:'Future visitor',service:'general',status:'Pending',createdAt:new Date('2099-01-01')}]};
 const c={loadDB:()=>db,periodStart:()=>new Date('2020-01-01'),reportIncludeConf:false,reportPeriod:'Weekly',currentUser:{fullName:'Admin'},document:{getElementById:id=>elements[id]},escapeHtml:String,serviceLabel:()=> 'General',isConfidentialTxn:t=>t.service==='private',fmtDate:()=> '2020-01-01',today:()=> '2020-01-03',fmtDateTime:()=> 'Recorded date',reportDuration:()=> '1 min',averageReportMetric:()=>1,reportSignatureBlock:()=>'<div>Signatures</div>'};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function buildReport()'),source.indexOf('function downloadReportExcel()')),c);c.buildReport();
 const html=elements.repBody.innerHTML;assert.ok(html.includes('PUBLIC'));assert.ok(html.includes('Staff'));assert.ok(html.includes('1 confidential record'));assert.ok(!html.includes('Secret visitor'));assert.ok(!html.includes('FUTURE'));assert.ok(!html.includes('<svg'));assert.ok(!html.includes('rpt-stat-grid'));assert.ok(html.includes('Signatures'));
});
