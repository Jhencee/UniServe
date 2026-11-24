const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function setup(){const c={Date,Intl};vm.createContext(c);vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../../Super Admin/dashboard-charts.js'),'utf8'),c);return c;}
test('grouped columns expose role and account status values and escape labels',()=>{
 const c=setup();const html=c.superGroupedColumns(['<Admin>'],[{label:'Active',color:'#2563eb',values:[3]},{label:'Disabled',color:'#999999',values:[1]}],'Staff roles');
 assert.ok(html.includes('&lt;Admin&gt;'));assert.ok(!html.includes('<Admin>'));
 assert.ok(html.includes('Active: 3'));assert.ok(html.includes('Disabled: 1'));assert.equal((html.match(/<rect /g)||[]).length,2);
});
test('pie renders a full circle for a single nonzero permission group and preserves zero counts',()=>{
 const c=setup();const html=c.superPieChart([{label:'Approver',count:0},{label:'Confidential',count:2},{label:'Standard',count:0}],'Permissions');
 assert.equal((html.match(/<circle /g)||[]).length,1);assert.ok(!html.includes('NaN'));assert.ok(html.includes('Confidential: 2'));assert.ok(html.includes('<strong>0</strong>'));
});
test('activity heatmap groups by Philippine weekday and hour and excludes invalid dates',()=>{
 const c=setup();const html=c.superActivityHeatmap([{ts:'2026-11-14T23:15:00Z'},{ts:'2026-11-15T00:20:00Z'},{ts:'invalid'}]);
 assert.equal((html.match(/<rect /g)||[]).length,168);
 assert.ok(html.includes('Sun 07:00 · 1 events'));assert.ok(html.includes('Sun 08:00 · 1 events'));
 assert.ok(!html.includes('NaN'));assert.ok(html.includes('Philippine time'));
});

test('reference comparison charts retain stacked totals and each trend series',()=>{
 const c=setup(),series=[{label:'Active',values:[3,2]},{label:'Disabled',values:[1,0]}];
 for(const type of ['stacked','line','area']){
  const html=c.superComparisonChart(['<Admin>','Head Admin'],series,type,'Account comparison');
  assert.ok(html.includes('&lt;Admin&gt;'));assert.ok(html.includes('Active: 3'));assert.ok(html.includes('Disabled: 1'));assert.ok(!html.includes('NaN'));
  if(type==='area')assert.equal((html.match(/fill-opacity=".22"/g)||[]).length,2);
 }
});
test('comparison charts use each supplied series color in the chart and legend',()=>{
 const c=setup(),series=[{label:'Active',color:'#a12345',values:[3]},{label:'Disabled',color:'#687987',values:[1]}];
 for(const type of ['stacked','grouped','line']){
  const html=c.superComparisonChart(['Staff'],series,type,'Account status');
  for(const color of ['#a12345','#687987'])assert.ok((html.match(new RegExp(color,'g'))||[]).length>=2);
 }
});
test('bubble and opposing charts expose original counts without negative geometry',()=>{
 const c=setup();
 const bubbles=c.superBubbleChart([{label:'<Accounts>',count:6,days:3}],'Category activity');
 assert.ok(bubbles.includes('&lt;Accounts&gt;: 6 events across 3 active days'));assert.ok(!bubbles.includes('NaN'));
 const bars=c.superOpposingBars([{label:'11-15',accounts:3,access:2}],'Changes');
 assert.ok(bars.includes('3 account changes; 2 access events'));assert.ok(!/width="-/.test(bars));
});
