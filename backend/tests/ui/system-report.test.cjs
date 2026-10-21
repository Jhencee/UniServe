const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../Super Admin/super-admin.js'),'utf8');
function setup(){
 const configEvents=Array.from({length:176},(_,i)=>({id:i+1,user:'Staff',role:'Staff',category:'Settings',action:'Updated settings',target:'SET-'+i,ts:'2026-10-20T08:00:00Z',changes:[{field:'Maintenance mode',from:false,to:i===175?'LAST-EVENT':true}]}));
 const other={id:177,user:'Staff',role:'Staff',category:'Queue',action:'Called visitor',target:'VIS-OTHER',ts:'2026-10-20T08:00:00Z',changes:[]};
 const entries=[...configEvents,other],data={start:new Date(),entries,logins:[],failed:[],accountEvents:[],confEvents:[],settingsEvents:configEvents,dataEvents:[],configEvents,sessions:[],byCat:[{label:'Settings',count:176},{label:'Queue',count:1}],integrity:{total:177,unsealed:177,bad:[]}};
 const elements={},db={users:[],systemSettings:{orgName:'OSS',supportEmail:'office@example.com',supportPhone:'09171234567',queuePrefixStudent:'A',queuePrefixGuest:'G'}};
 let csv;
 const c={document:{getElementById:id=>elements[id]||(elements[id]={})},loadDB:()=>db,systemReportData:()=>data,reportPeriod:'Daily',currentUser:{fullName:'Super Admin'},ROLES:{},escapeHtml:value=>String(value).replaceAll('<','&lt;'),fmtDate:()=> '2026-10-20',fmtTime:()=> '4:00 PM',fmtDateTime:()=> '2026-10-20 4:00 PM',today:()=> '2026-10-20',actionText:String,auditActionLabel:String,categoryOf:e=>e.category,buildTrendBuckets:()=>({unit:'day',labels:['Oct 20'],values:[177]}),svgLineChart:()=>'',svgBarChart:()=>'',graceMinutes:()=>15,noShowMinutes:()=>60,reportSignatureBlock:()=>'',SpreadsheetExport:{download:(name,rows)=>csv=rows},logActivity(){},saveDB(){},toast(){}};
 vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('function reportChangesHtml('),source.indexOf('const changesText')),c);
 vm.runInContext(source.slice(source.indexOf('function buildReport()'),source.indexOf('const RANGES')),c);
 return {c,elements,csv:()=>csv};
}
test('printed report includes events beyond 150 and activity outside settings and accounts',()=>{
 const s=setup();s.c.buildReport();const html=s.elements.repBody.innerHTML;
 assert.ok(html.includes('LAST-EVENT'));assert.ok(html.includes('VIS-OTHER'));assert.ok(!html.includes('more events.'));
 assert.equal((html.match(/class="report-event"/g)||[]).length,177);
});
test('system Excel contains every event, field differences, trend, sessions, configuration and integrity',()=>{
 const s=setup();s.c.downloadReportExcel();const rows=s.csv();
 for(const title of ['Detailed Audit Events','Audit Activity Trend','Sign-in Activity by Account','Audit Trail Integrity'])assert.ok(rows.some(row=>row[0]===title));
 assert.equal(rows.filter(row=>typeof row[0]==='number').length,177);
 assert.ok(rows.some(row=>row.includes('LAST-EVENT')));assert.ok(rows.some(row=>row.includes('VIS-OTHER')));
 assert.ok(rows.some(row=>row[0]==='Support email'&&row[1]==='office@example.com'));
});

test('system Excel export preserves all rows and formats section headings',()=>{
 const s=setup();let exported;
 s.c.SpreadsheetExport={download:(filename,rows,widths,options)=>exported={filename,rows,widths,options}};
 s.c.downloadReportExcel('xlsx');
 assert.ok(exported.filename.endsWith('.xlsx'));assert.equal(exported.options.sheetName,'System Report');
 assert.equal(exported.rows.filter(row=>typeof row[0]==='number').length,177);
 const eventHeader=exported.rows.findIndex(row=>row[0]==='Event ID');
 assert.ok(exported.options.headingRows.includes(eventHeader));assert.ok(exported.widths[9]>=30);
});
