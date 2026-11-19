const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../Super Admin/super-admin.js'),'utf8');
function setup(){
 const entries=Array.from({length:176},(_,i)=>({category:'Settings',action:'Updated settings',user:'Staff',ts:new Date(Date.UTC(2026,9,20,0,i)).toISOString(),changes:[{field:'Maintenance mode',from:false,to:i===175?'LAST-EVENT':true}]}));
 entries.push({category:'Queue',action:'Called visitor',user:'Staff',ts:'2026-10-20T08:00:00Z'});
 const db={activityLog:entries,users:[],systemSettings:{}};let exported;
 const elements={},c={loadDB:()=>db,AUDIT_CATEGORIES:['Settings','Queue'],categoryOf:e=>e.category,auditActionLabel:String,escapeHtml:String,currentUser:{fullName:'Super Admin'},reportLetterhead:()=>'',reportSignatureBlock:()=>'',fmtDateTime:()=> '2026-10-20',today:()=> '2026-10-20',actionText:String,SpreadsheetExport:{download:(filename,rows,widths,options)=>exported={filename,rows,widths,options}},logActivity(){},saveDB(){},toast(){},document:{getElementById:id=>elements[id]||(elements[id]={})}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('const SYSTEM_REPORT_TYPES'),source.indexOf('const RANGES =')),c);
 return {c,db,elements,run:code=>vm.runInContext(code,c),exported:()=>exported};
}
test('overview counts every event beyond 150 without reproducing event history',()=>{const s=setup();s.c.buildReport();const html=s.elements.reportSheet.innerHTML;assert.ok(html.includes('177'));assert.ok(html.includes('176'));assert.ok(!html.includes('report-event'));});
test('configuration summary includes the latest change beyond 150 events',()=>{const s=setup();s.run("systemReportType='configuration'");s.c.buildReport();assert.ok(s.elements.reportSheet.innerHTML.includes('LAST-EVENT'));});
test('Excel retains summary totals and formats section headings',()=>{const s=setup();s.c.downloadReportExcel();const e=s.exported();assert.ok(e.filename.endsWith('.xlsx'));assert.equal(e.options.sheetName,'System Report');assert.ok(e.rows.some(row=>row[0]==='Audit events'&&row[1]===177));assert.ok(e.options.headingRows.includes(e.rows.findIndex(row=>row[0]==='Activity by category')));});

test('reports interface keeps the full document hidden and displays complete summary totals',()=>{
 const s=setup();s.c.icon=()=>'';s.c.renderReports();
 assert.match(s.elements.content.innerHTML,/id="reportSheet" hidden aria-hidden="true"/);
 assert.ok(s.elements.systemReportOverview.innerHTML.includes('177'));
 assert.ok(s.elements.systemReportOverview.innerHTML.includes('Activity by category'));
 assert.ok(!s.elements.systemReportOverview.innerHTML.includes('report-title-block'));
 assert.equal(s.elements.reportSheet,undefined);
});
test('printed report keeps section titles inside their tables',()=>{
 const s=setup();s.c.buildReport();assert.match(s.elements.reportSheet.innerHTML,/<table class="rpt-table system-print-table"><caption><strong>Period summary/);
});
