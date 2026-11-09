const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../Super Admin/super-admin.js'),'utf8');
function setup(){
 const c={svgBarChart:rows=>JSON.stringify(rows),emptyChart:text=>text};vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('function feedbackStats(db)'),source.indexOf('function inferCategory(')),c);
 vm.runInContext(source.slice(source.indexOf('function queueRef(q)'),source.indexOf('function queueRef(q)')+source.slice(source.indexOf('function queueRef(q)')).indexOf('\n')),c);
 return c;
}
test('Super Admin feedback renders server aggregates without visitor comments',()=>{
 const c=setup(),db={feedbackSummary:{responses:2,completed:4,average:3.5,satisfactionPercent:50,responseRate:50,withComment:1,distribution:[{rating:5,count:1},{rating:2,count:1}]},queues:[{name:'PRIVATE NAME',feedback:{rating:1,comment:'PRIVATE COMMENT'}}]};
 const html=c.feedbackDashboardHtml(db);
 assert.equal(c.feedbackStats(db).n,2);assert.equal(c.feedbackStats(db).rate,50);
 assert.match(html,/3\.5/);assert.match(html,/50%/);assert.match(html,/Comments received/);
 assert.ok(!html.includes('PRIVATE NAME'));assert.ok(!html.includes('PRIVATE COMMENT'));assert.ok(!html.includes('Recent Comments'));
});
test('empty feedback and absent queue references display safe fallbacks',()=>{
 const c=setup();assert.match(c.feedbackDashboardHtml({}),/No feedback received yet/);
 assert.equal(c.queueRef({number:'A-001',visitId:'VIS-TEST'}),'A-001');
 assert.equal(c.queueRef({visitId:'VIS-TEST'}),'VIS-TEST');assert.equal(c.queueRef({}),'—');
});
