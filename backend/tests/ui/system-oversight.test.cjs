const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function setup(request=async()=>({})) {
  const elements=new Map();
  const element=()=>({innerHTML:'',isConnected:true,querySelectorAll:()=>[],addEventListener(){}});
  const context={state_view:'systemhealth',currentUser:{id:'super'},
    escapeHtml:value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),
    document:{getElementById(id){if(!elements.has(id))elements.set(id,element());return elements.get(id);}},
    window:{UniServeRealtime:{connected:false}},UniServeUX:{request},AbortSignal,Date,URL,
    toast(){},setTimeout,clearTimeout};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../../Super Admin/system-oversight.js'),'utf8'),context);
  return {context,elements};
}
function fixture() {
  return {checkedAt:new Date().toISOString(),security:{failedOrDenied24h:2,structuralIssues:0,auditCheck:'Structural check only'},
    accounts:[{id:'admin',name:'<script>bad()</script>',role:'ADMIN',active:true,confidentialAccess:true,headAdmin:false,lastSignIn:null,reviewInactive:false}],changes:[],
    configuration:{maintenance:false,sessionMinutes:30},
    health:{api:{state:'responding',detail:'API responds'},database:{state:'responding',detail:'Queries completed'},scheduler:{state:'unverified',detail:'No heartbeat'},worker:{state:'unverified',detail:'No heartbeat'},mail:{state:'configured',detail:'Not delivery proof',failed:0,lastSent:null},queue:{pending:0,failed:0},realtime:{state:'configured',detail:'Configured only'}},
    backups:{latest:null,scheduled:false}};
}
test('health view distinguishes configuration from a verified live connection',async()=>{
  const s=setup(async()=>fixture());await s.context.renderSystemHealth();
  const html=s.elements.get('oversightPageBody').innerHTML;
  assert.ok(html.includes('unverified'));assert.ok(html.includes('Needs checking'));
  assert.ok(html.includes('Delivery not confirmed'));assert.ok(html.includes('Send test email'));
});
test('access review escapes staff names and does not invent inactivity for missing signins',async()=>{
  const s=setup(async()=>fixture());s.context.state_view='accessreview';await s.context.renderAccessReview();
  const html=s.elements.get('oversightPageBody').innerHTML;
  assert.ok(html.includes('&lt;script>'));assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('View details'));assert.ok(!html.includes('Needs review</td>'));
});
test('older deployed APIs show an upgrade message rather than cached health data',async()=>{
  const s=setup(async()=>{throw Object.assign(Error('Not found'),{status:404});});
  await s.context.renderSystemHealth();
  assert.ok(s.elements.get('oversightPageBody').innerHTML.includes('confirm the frontend and backend use matching releases'));
});
test('server alerts preserve security and recovery priorities',()=>{
  const s=setup();const alerts=s.context.oversightAlerts(fixture());
  assert.equal(alerts[0].page,'activitylog');assert.equal(alerts.at(-1).page,'backup');
  assert.ok(!alerts.some(a=>a.page==='accessreview'));
});
test('late health response does not overwrite an access-review page',async()=>{
  let resolve;const s=setup(()=>new Promise(r=>resolve=r));
  const first=s.context.renderSystemHealth();
  const second=s.context.renderAccessReview();
  resolve(fixture());await Promise.all([first,second]);
  assert.ok(s.elements.get('oversightPageBody').innerHTML.includes('Staff member'));
  assert.ok(!s.elements.get('oversightPageBody').innerHTML.includes('Audit verification scope'));
});
