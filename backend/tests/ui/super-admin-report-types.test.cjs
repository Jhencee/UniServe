const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../Super Admin/super-admin.js'),'utf8');
function setup(){
 let exported;const db={activityLog:[{ts:'2026-10-25T16:30:00Z',category:'Accounts',action:'Created account',user:'Head'},{ts:'2026-10-25T15:30:00Z',category:'Authentication',action:'Logged in',user:'Head'},{ts:'2026-10-26T02:00:00Z',category:'Settings',action:'Updated settings',user:'Head',changes:[{field:'Timeout',from:20,to:30}]}],users:[{fullName:'Admin',role:'ADMIN',active:true}],systemSettings:{sessionTimeout:30}};
 const c={loadDB:()=>db,categoryOf:e=>e.category,auditActionLabel:String,AUDIT_CATEGORIES:['Accounts','Authentication','Settings','Confidential','Data'],ROLES:{ADMIN:{label:'Admin'}},auditIntegrity:()=>({total:3,unsealed:1,bad:[]}),today:()=> '2026-10-26',SpreadsheetExport:{download:(...args)=>exported=args},fmtDateTime:()=> '2026-10-26',actionText:String,currentUser:{fullName:'Head'},logActivity(){},saveDB(){},toast(){}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('const SYSTEM_REPORT_TYPES'),source.indexOf('const RANGES =')),c);
 return {c,db,run:code=>vm.runInContext(code,c),exported:()=>exported};
}
test('report dates use Manila boundaries and normalize inverted ranges',()=>{const s=setup();s.run("systemReportRange={from:'2026-10-26',to:'2026-10-26'}");assert.equal(s.c.systemReportModel(s.db).sections[0].rows[0][1],2);s.c.renderReports=()=>{};s.c.setSystemReportDate('from','2026-10-27');assert.equal(s.run('systemReportRange.to'),'2026-10-27');});
test('four focused reports exclude individual audit-event history',()=>{const s=setup();for(const type of ['overview','accounts','security','configuration']){s.run(`systemReportType='${type}'`);const m=s.c.systemReportModel(s.db);assert.ok(m.sections.length>=3);assert.ok(!JSON.stringify(m).includes('Detailed Audit Events'));}s.run("systemReportType='configuration'");assert.equal(s.c.systemReportModel(s.db).sections[1].rows[0][0],'Timeout');});
test('Excel uses the same sections and rows as the screen model',()=>{const s=setup();for(const type of ['overview','accounts','security','configuration']){s.run(`systemReportType='${type}'`);const m=s.c.systemReportModel(s.db);s.c.downloadReportExcel();const [filename,rows]=s.exported();assert.ok(filename.includes(type));assert.equal(rows[1][0],m.title);for(const section of m.sections){assert.ok(rows.some(row=>row[0]===section.title));for(const row of section.rows)assert.ok(rows.some(actual=>JSON.stringify(actual)===JSON.stringify(row)));}}});

test('server sign-ins and denied events are counted without claiming audit verification',()=>{
 const s=setup();s.db.activityLog.push({ts:'2026-10-26T03:00:00Z',category:'Authentication',action:'Signed in'},{ts:'2026-10-26T04:00:00Z',category:'System',action:'Access denied'});
 assert.equal(s.c.systemReportModel(s.db).sections[0].rows.find(r=>r[0]==='Sign-ins')[1],2);
 s.run("systemReportType='security'");const m=s.c.systemReportModel(s.db);
 assert.equal(m.sections[0].rows[0][1],1);assert.ok(JSON.stringify(m).includes('Not performed'));assert.ok(!JSON.stringify(m).includes('Sealed entries checked'));
});
test('configuration formats schedules and excludes audit metadata',()=>{
 const s=setup();assert.equal(s.c.systemReportValue('[{"open":false},{"open":true,"start":"08:00","end":"17:00"}]'),'Sun: Closed; Mon: 08:00 to 17:00');
 s.db.activityLog[2].changes.push({field:'Area',from:'',to:'Settings'},{field:'Same',from:true,to:true});s.run("systemReportType='configuration'");
 assert.equal(s.c.systemReportModel(s.db).sections[1].rows.length,1);
});
test('recovery distinguishes unavailable history, date filtering and restore proof',()=>{
 const s=setup();s.run("systemReportType='recovery'");assert.ok(JSON.stringify(s.c.systemReportModel(s.db)).includes('unavailable'));
 s.run("systemReportRange={from:'2026-10-26',to:'2026-10-26'};systemReportRecovery={backups:[{savedAt:'2026-10-26T02:00:00Z',kind:'manual',tables:19,rows:8,fileAvailable:true,restoreTested:false},{savedAt:'2026-10-24T02:00:00Z',kind:'old',tables:19,rows:4,fileAvailable:true}],restores:[]}");
 const m=s.c.systemReportModel(s.db);assert.equal(m.sections[0].rows.length,1);assert.equal(m.sections[0].rows[0][4],'Not recorded');s.c.downloadReportExcel();assert.ok(s.exported()[0].includes('recovery'));
});
