// Requires a local static server on 8765, API on 8000 and headless Chrome CDP on 9224.
// Staff screens use API fixtures; this test never writes live application records.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../../storage/app/private/flow-checks');fs.mkdirSync(out,{recursive:true});
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function page(){
 const target=await(await fetch('http://127.0.0.1:9224/json/new?about:blank',{method:'PUT'})).json();
 const ws=new WebSocket(target.webSocketDebuggerUrl),pending=new Map(),events=[];let serial=0;
 await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
 ws.onmessage=event=>{const message=JSON.parse(event.data);if(message.id){const p=pending.get(message.id);pending.delete(message.id);message.error?p?.reject(Error(JSON.stringify(message.error))):p?.resolve(message.result);}else{events.push(message);if(message.method==='Fetch.requestPaused')intercept?.(message.params);}};
 let intercept;
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 await send('Page.enable');await send('Runtime.enable');
 const run=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
 return {send,run,events,mock:async handler=>{intercept=async params=>{try{const data=handler(params.request);await send('Fetch.fulfillRequest',{requestId:params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'},{name:'Access-Control-Allow-Headers',value:'*'},{name:'Access-Control-Allow-Methods',value:'*'}],body:Buffer.from(JSON.stringify(data)).toString('base64')});}catch(e){await send('Fetch.failRequest',{requestId:params.requestId,errorReason:'Failed'}).catch(()=>{});}};await send('Fetch.enable',{patterns:[{urlPattern:'*127.0.0.1:8000/api/*'},{urlPattern:'*127.0.0.1:8765/api/*'}]});},
  goto:async url=>{await send('Page.navigate',{url});for(let i=0;i<100;i++){if(await run("document.readyState==='complete'"))break;await pause(100);}await pause(600);},
  screenshot:async name=>{const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.data,'base64'));},
  close:async()=>{await send('Page.close');ws.close();}
 };
}

// All API requests use fixtures; no live records or network services are modified.
(async()=>{
 const p=await page();
 try {
  const now=new Date().toISOString();
  const user={id:'super-fixture',username:'Fixture',fullName:'System Reviewer',role:'SUPER_ADMIN',active:true};
  const settings={sessionTimeout:30,maintenanceMode:false,gracePeriodMinutes:15,noShowThresholdMinutes:60};
  const db={users:[user],services:[],transactions:[],appointments:[],queues:[],chats:[],activityLog:[],visitorLog:[],queueCounters:{},systemSettings:settings,sampleDataRemovedV2:true};
  const health={api:{state:'responding',detail:'API responds'},database:{state:'responding',detail:'Queries succeeded'},scheduler:{state:'unverified',detail:'No heartbeat'},worker:{state:'unverified',detail:'No heartbeat'},mail:{state:'configured',detail:'Configuration is not delivery proof.',failed:0,lastSent:null},queue:{pending:0,failed:0},realtime:{state:'disabled',detail:'No connection'}};
  const oversight={checkedAt:now,accounts:[{id:user.id,name:user.fullName,role:'SUPER_ADMIN',active:true,lastSignIn:null},{id:'staff-fixture',name:'Service Staff',role:'ADMIN',active:true,confidentialAccess:true,lastSignIn:null}],security:{failedOrDenied24h:2,structuralIssues:0,auditCheck:'Structural checks only.'},configuration:{maintenance:false,sessionMinutes:30},changes:[],health,backups:{latest:null,scheduled:false}};
  await p.send('Page.addScriptToEvaluateOnNewDocument',{source:'sessionStorage.setItem("ossuniserve_session",'+JSON.stringify(JSON.stringify({currentUser:user,token:'fixture'}))+');localStorage.setItem("ossuniserve_db_v1",'+JSON.stringify(JSON.stringify(db))+');'});
  await p.mock(req=>{
   const pathname=new URL(req.url).pathname;
   if(req.method==='OPTIONS')return {};
   if(pathname.endsWith('/system/oversight'))return oversight;
   if(pathname.endsWith('/backup/history'))return {backups:[]};
   if(pathname.endsWith('/settings'))return {settings,revision:0};
   if(pathname.endsWith('/reports'))return {feedbackSummary:{responses:0,distribution:[]},activityLog:[{action:'Signed in',category:'Authentication',ts:now},{action:'Sign-in failed',category:'Authentication',ts:now},{action:'Access denied',category:'System',ts:now},{action:'Updated system settings',category:'Settings',ts:now}],transactions:[],appointments:[],queues:[]};
   if(pathname.endsWith('/admins'))return {users:[user,{id:'staff-fixture',username:'Staff',fullName:'Service Staff',role:'ADMIN',active:true,confidentialAccess:true}]};
   if(pathname.endsWith('/security/mfa'))return req.method==='GET'?{enabled:false}:{secret:'JBSWY3DPEHPK3PXP',enabled:true,recoveryCodes:['fixture-recovery-code'],token:'fixture-mfa-token'};
   if(pathname.endsWith('/password/confirm'))return {confirmed:true};
   if(pathname.endsWith('/security/sessions'))return {sessions:[{id:'fixture-session',started:now,current:true}]};
   if(pathname.endsWith('/services'))return {services:[]};
   if(pathname.endsWith('/queue'))return {queues:[]};
   if(pathname.endsWith('/appointments'))return {appointments:[]};
   if(pathname.endsWith('/chats'))return {chats:[]};
   if(pathname.endsWith('/service-records'))return {transactions:[],visitorLog:[]};
   if(pathname.endsWith('/realtime/config'))return {enabled:false};
   if(pathname.endsWith('/calendar'))return {calendar:{revision:0,weekly:Array.from({length:7},()=>({open:true,start:'08:00',end:'17:00'})),lunch:{enabled:true,start:'12:00',end:'13:00'},days:{}}};
   return {};
  });
  await p.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await p.goto('http://127.0.0.1:8765/Super%20Admin/superadmin.html');
  await p.run("navigate('dashboard')");await pause(350);
  assert.ok(await p.run("document.getElementById('content').textContent.includes('System checks')"));
  assert.ok(await p.run("document.getElementById('content').textContent.includes('Check backup readiness')"));
  assert.ok(await p.run("document.querySelector('[aria-label=\"System metrics\"]').compareDocumentPosition(document.getElementById('systemOversightAttention')) & Node.DOCUMENT_POSITION_FOLLOWING"));
  assert.ok(await p.run("document.getElementById('content').textContent.includes('Sign-ins and blocked access')"));
  assert.ok(await p.run("document.getElementById('content').textContent.includes('Actions by category')"));
  assert.ok(await p.run("document.querySelectorAll('.dashboard-donut').length>=1"));
  assert.ok(await p.run("document.querySelectorAll('.dashboard-status-list').length>=1"));
  assert.ok(await p.run("document.querySelector('.super-grouped-chart')!==null"));
  assert.ok(await p.run("document.querySelector('.dashboard-bars')!==null"));
  assert.ok(await p.run("document.querySelector('.super-heatmap')!==null"));
  assert.equal(await p.run("document.querySelectorAll('.cl-area').length"),1);
  assert.ok(await p.run("Array.from(document.querySelectorAll('.trend-chart-scroll')).every(chart=>chart.scrollWidth<=chart.clientWidth+1)"));
  await p.screenshot('super-oversight-dashboard');
  assert.ok(await p.run("(()=>{const hero=document.querySelector('[data-chart=overview]').getBoundingClientRect(),status=document.querySelector('[data-chart=services]').getBoundingClientRect();return Math.abs(hero.top-status.top)<2&&hero.width>status.width*1.8})()"));
  await p.run("document.getElementById('securityChartHeading').scrollIntoView({behavior:'instant',block:'start'})");await p.screenshot('super-dashboard-security');
  await p.run("document.getElementById('activityChartHeading').scrollIntoView({block:'start'})");await p.screenshot('super-dashboard-activity');
  await p.run("window.scrollTo(0,0)");
  assert.equal(await p.run("document.querySelectorAll('.staff-notification-button').length"),1);
  assert.ok(await p.run("document.querySelector('#sidebarNotifications .nav-item')!==null"));
  await p.run("document.querySelector('.staff-notification-button').click()");await pause(200);
  assert.equal(await p.run("state_view"),'notifications');
  assert.ok(await p.run("document.getElementById('superNotificationFeed').textContent.includes('Check backup readiness')"));
  assert.equal(await p.run("document.querySelector('#sidebarNotifications .notification-bell-count').textContent"),'2');
  await p.run("document.querySelector('[data-state-action=archive]').click()");
  assert.equal(await p.run("document.querySelector('.staff-notification-count').textContent"),'1');
  await p.run("document.getElementById('superNotificationStatus').value='archived';document.getElementById('superNotificationStatus').dispatchEvent(new Event('change'))");
  assert.equal(await p.run("document.querySelectorAll('.notification-entry').length"),1);
  await p.run("document.querySelector('[data-state-action=archive]').click();document.getElementById('superNotificationStatus').value='all';document.getElementById('superNotificationStatus').dispatchEvent(new Event('change'))");
  assert.equal(await p.run("document.querySelectorAll('.notification-entry').length"),2);
  await p.screenshot('super-notifications');
  await p.run("Array.from(document.querySelectorAll('[data-super-notification]')).find(b=>b.textContent==='Review backups').click()");await pause(200);
  assert.equal(await p.run("state_view"),'backup');
  assert.equal(await p.run("document.querySelector('.staff-notification-count').textContent"),'1');
  assert.equal(await p.run("document.querySelector('#sidebarNotifications .notification-bell-count').textContent"),'1');
  await p.run("navigate('systemhealth')");await pause(300);
  assert.ok(await p.run("document.querySelectorAll('.health-status[data-state=unverified]').length > 0"));
  assert.ok(await p.run("document.getElementById('content').textContent.includes('What to do')"));
  await p.screenshot('super-oversight-health');
  await p.run("navigate('accessreview')");await pause(300);
  assert.equal(await p.run("state_view"),'users');
  assert.equal(await p.run("document.querySelectorAll('#userBody tr').length"),2);
  assert.equal(await p.run("document.querySelectorAll('.nav-item[title=\"Access Review\"]').length"),0);
  await p.run("openEditUserModal('staff-fixture')");
  for(let attempt=0;attempt<50;attempt++){if(await p.run("document.getElementById('accountLastSignIn')?.textContent==='No sign-in recorded'"))break;await pause(100);}
  assert.equal(await p.run("document.getElementById('accountLastSignIn').textContent"),'No sign-in recorded');
  await p.run("closeModal();navigate('profile');openSecuritySessions()");await pause(200);
  assert.ok(await p.run("document.getElementById('activeModal').textContent.includes('This session')"));
  await p.run("closeModal();openSecurityMfa()");await pause(200);
  assert.ok(await p.run("document.getElementById('securityConfirmPassword')!==null"));
  await p.run("document.getElementById('securityConfirmPassword').value='fixture-password';document.getElementById('modalBtn1').click()");await pause(200);
  assert.ok(await p.run("document.getElementById('activeModal').textContent.includes('JBSWY3DPEHPK3PXP')"));
  await p.run("document.getElementById('enableMfaCode').value='123456';document.getElementById('modalBtn1').click()");await pause(200);
  assert.ok(await p.run("document.getElementById('activeModal').textContent.includes('fixture-recovery-code')"));
  assert.equal(await p.run("JSON.parse(sessionStorage.getItem('ossuniserve_session')).token"),'fixture-mfa-token');
  await p.run("closeModal()");
  await p.run("navigate('backup')");await pause(300);
  assert.ok(await p.run("document.getElementById('content').textContent.includes('No verified server exports')"));
  assert.ok(await p.run("document.getElementById('restoreBackupChoose')!==null"));
  assert.equal(await p.run("document.getElementById('content').textContent.includes('Storage Summary')"),false);
  await p.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await p.run("navigate('systemhealth')");await pause(250);
  assert.ok(await p.run("document.documentElement.scrollWidth <= innerWidth+1"));
  await p.screenshot('super-oversight-health-mobile');
  await p.run("navigate('dashboard')");await pause(350);
  assert.ok(await p.run("document.documentElement.scrollWidth<=innerWidth+1"));
  await p.screenshot('super-dashboard-mobile');
  const errors=p.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails.exception?.description||e.params.exceptionDetails.text);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:'passed',checks:['dashboard alerts','system health','access review','server backup view','mobile overflow','no runtime errors'],screenshots:out}));
 }finally{await p.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
