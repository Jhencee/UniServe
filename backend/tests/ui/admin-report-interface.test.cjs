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
