const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').resolve(__dirname,'../../../Super Admin/super-admin.js'),'utf8');
function preview(){
 const content={innerHTML:''};let trend;const charts=[];
 const layoutNode={querySelectorAll:()=>[],append(){},setAttribute(){}};
 const c={superGroupedColumns:(labels,series,label)=>(charts.push({type:'grouped',label,series}),'<svg aria-label="'+label+'"></svg>'),superPieChart:(rows,label)=>(charts.push({type:'pie',label,rows}),'<div>'+label+'</div>'),superActivityHeatmap:()=>'<div class="super-heatmap"></div>',dashboardChart:(rows,type,label)=>(charts.push({rows,type,label}),'<svg role="img" aria-label="'+label+'"></svg>'),dashboardBarChart:(rows,label)=>'<div class="dashboard-bars" aria-label="'+label+'"></div>',Date,loadDB:()=>({users:[{role:'SUPER_ADMIN',active:true},{role:'ADMIN',active:true,confidentialAccess:true}],activityLog:[{action:'Access denied',category:'System',ts:new Date().toISOString()},{action:'Signed in',category:'Authentication',ts:new Date().toISOString()}]}),document:{getElementById:()=>content},escapeHtml:String,auditActionLabel:String,inferCategory:()=> 'System',icon:()=>'',svgLineChart:(value,label)=>{if(label==='System audit activity')trend=value;return '<div>Activity chart</div>';},emptyChart:String};
 c.superComparisonChart=(labels,series,type,label)=>(charts.push({type,label,series}),'<svg aria-label="'+label+'"></svg>');
 c.superBubbleChart=(rows,label)=>'<div class="super-bubble-chart">'+label+'</div>';
 c.superOpposingBars=()=>'<div>Account changes</div>';
 c.dashboardBarChart=(rows,label)=>(charts.push({rows,type:'bars',label}),'<div class="dashboard-bars"></div>');
 c.document.addEventListener=()=>{};
 c.document.querySelector=()=>layoutNode;
 c.document.querySelectorAll=()=>[];
 c.document.createElement=()=>layoutNode;
 vm.createContext(c);vm.runInContext(fs.readFileSync(require('node:path').resolve(__dirname,'../../../shared/dashboard-analytics.js'),'utf8').split('function dashboardOperationalData(')[0],c);
 vm.runInContext(source.slice(source.indexOf('function reportDateKey('),source.indexOf('function setSystemReportDate(')),c);
 vm.runInContext(source.slice(source.indexOf('function renderDashboard() {'),source.indexOf('let reportPeriod =')),c);
 c.renderDashboard();return {html:content.innerHTML,trend,charts};
}
test('dashboard uses charts for account breakdowns without repeating account status',()=>{
 const {html}=preview();
 assert.ok(html.indexOf('id="securityChartHeading"')<html.indexOf('id="activityChartHeading"'));
 assert.ok(!html.includes('dashboard-account-facts'));assert.ok(html.includes('Staff accounts by role'));assert.ok(html.includes('dashboard-bars'));assert.ok(!html.includes('Account status'));
 assert.ok(!html.includes('dashboard-donut'));assert.ok(html.includes('View reports'));
});
test('dashboard counts denied events and keeps a fourteen-day activity series',()=>{
 const {html,trend}=preview();
 assert.match(html,/Failed or denied events<\/div><div class="val">1<\/div>/);
 assert.equal(trend.values.length,14);assert.equal(trend.values.reduce((sum,value)=>sum+value,0),2);
 assert.ok(html.includes('Last 14 days'));
});

test('dashboard includes security outcomes, category analysis and configuration trends',()=>{
 const {html,charts}=preview();
 for(const heading of ['Security','Sign-ins and blocked access','Actions by category','Changes to settings'])assert.ok(html.includes(heading));
 const outcomes=charts.find(chart=>chart.label==='Successful sign-ins, failed sign-ins and denied access');
 assert.equal(outcomes.rows.find(row=>row.label==='Signed in').count,1);
 assert.equal(outcomes.rows.find(row=>row.label==='Access denied').count,1);
 assert.equal(outcomes.rows.find(row=>row.label==='Sign-in failed').count,0);
});

test('dashboard uses distinct charts for distributions, comparisons and permissions',()=>{const {charts}=preview();assert.equal(charts.find(c=>c.label==='Staff accounts by role').type,'stacked');assert.equal(charts.find(c=>c.label==='Successful sign-ins, failed sign-ins and denied access').type,'bars');assert.equal(charts.find(c=>c.label==='Active service administrators by confidential access').type,'donut');});

test('security line graph omits the fill while overall activity keeps its area',()=>{const c={escapeHtml:String,document:{addEventListener(){}}};vm.createContext(c);vm.runInContext(fs.readFileSync(require('node:path').resolve(__dirname,'../../../shared/dashboard-analytics.js'),'utf8'),c);vm.runInContext(source.slice(source.indexOf('function svgLineChart('),source.indexOf('function svgBarChart(')),c);const trend={labels:['Day 1','Day 2'],values:[1,2]};assert.ok(c.svgLineChart(trend,'Activity','events').includes('class="cl-area"'));assert.ok(!c.svgLineChart(trend,'Security','events',{area:false}).includes('class="cl-area"'));});
