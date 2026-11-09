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
 return {send,run,events,mock:async handler=>{intercept=async params=>{try{const data=handler(params.request);await send('Fetch.fulfillRequest',{requestId:params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'},{name:'Access-Control-Allow-Headers',value:'*'},{name:'Access-Control-Allow-Methods',value:'*'}],body:Buffer.from(JSON.stringify(data)).toString('base64')});}catch(e){await send('Fetch.failRequest',{requestId:params.requestId,errorReason:'Failed'});}};await send('Fetch.enable',{patterns:[{urlPattern:'*127.0.0.1:8000/api/*'}]});},
  goto:async url=>{await send('Page.navigate',{url});for(let i=0;i<100;i++){if(await run("document.readyState==='complete'"))break;await pause(100);}await pause(600);},
  screenshot:async name=>{const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.data,'base64'));},
  close:async()=>{await send('Page.close');ws.close();}
 };
}
(async()=>{
 const checks=[];const base='http://127.0.0.1:8765';
 const visitor=await page();
 await visitor.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
 await visitor.goto(base+'/User/user.html');
 await visitor.run("setTheme('light')");
 assert.equal(await visitor.run("!!document.getElementById('closedScreen')"),false);
 assert.equal(await visitor.run("document.getElementById('visitorContent').hidden"),true);
 assert.equal(await visitor.run("document.getElementById('visitorContent').textContent"),'');
 assert.equal(await visitor.run("document.querySelector('.flow-entry-options')"),null);
 assert.equal(await visitor.run("document.querySelectorAll('.visitor-hub-nav button').length"),4);
 assert.equal(await visitor.run("document.getElementById('visitorSidebar')"),null);
 await visitor.run("document.querySelector('#visitorActions summary').click()");
 assert.equal(await visitor.run("document.getElementById('visitorActions').open"),true);
 assert.equal(await visitor.run("!!document.querySelector('.visitor-actions-panel .browser-alert-toggle')"),false);
 await visitor.run("document.getElementById('visitorThemeToggle').click()");
 assert.equal(await visitor.run("document.documentElement.dataset.theme"),'dark');
 assert.equal(await visitor.run("document.getElementById('visitorThemeToggle').getAttribute('aria-checked')"),'true');
 await visitor.run("document.getElementById('visitorThemeToggle').click()");
 assert.equal(await visitor.run("document.documentElement.dataset.theme"),'light');
 assert.equal(await visitor.run("!!document.querySelector('#visitorActions .visitor-home-link')"),false);
 assert.equal(await visitor.run("document.querySelector('.visitor-home-bar a').getAttribute('href')"),'../Landing/landing.html');
 await visitor.run("setTheme('light');document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))");
 assert.equal(await visitor.run("document.getElementById('visitorActions').open"),false);
 await pause(400);
 await visitor.screenshot('visitor-hub-desktop');
 await visitor.run("UniServeUX.visitorCalendar()");
 assert.equal(await visitor.run("!!document.querySelector('.office-calendar-modal .ux-calendar-grid')"),true);
 await visitor.screenshot('visitor-calendar-desktop');
 await visitor.run("closeModal()");
 await visitor.goto(base+'/User/user.html?flow=checkvisit');
 assert.equal(await visitor.run("!!document.getElementById('cvInput')"),true);
 assert.equal(await visitor.run("document.getElementById('visitorHub').hidden"),true);
 await visitor.goto(base+'/User/user.html?flow=visit&entry=walkin');
 assert.equal(await visitor.run("document.getElementById('visitorHub').hidden"),true);
 assert.equal(await visitor.run("visitEntryMethod"),'walkin');
 await visitor.goto(base+'/User/user.html?flow=visit&entry=appointment');
 assert.equal(await visitor.run("document.getElementById('visitorContent').hidden"),false);
 assert.equal(await visitor.run("document.getElementById('visitorHub').hidden"),true);
 await visitor.run("pickVisitService('good_moral')");
 assert.equal(await visitor.run("document.getElementById('bkSubmitBtn').disabled"),false);
 assert.equal(await visitor.run("document.getElementById('bkSubmitBtn').textContent.trim()"),'Review details');
 await visitor.screenshot('visitor-appointment-desktop');checks.push('Appointment form is reachable with live services/calendar/settings APIs');
 await visitor.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await pause(400);
 await visitor.run("showVisitorHub()");await visitor.screenshot('visitor-mobile');
 assert.ok(await visitor.run('document.documentElement.scrollWidth<=window.innerWidth+1'));
 assert.equal(await visitor.run("document.querySelector('.sidebar')"),null);
 await visitor.run("document.querySelectorAll('.visitor-hub-nav button')[1].click()");
 assert.equal(await visitor.run("!!document.getElementById('cvInput')"),true);
 await visitor.run("document.querySelector('#visitorSectionBar button').click()");
 assert.equal(await visitor.run("document.getElementById('visitorContent').textContent"),'');
 await visitor.run("document.querySelectorAll('.visitor-hub-nav button')[2].click()");
 await pause(250);assert.ok(await visitor.run("!!document.getElementById('appointmentEmail')"));await visitor.run('closeModal()');
 await visitor.run("showVisitorHub()");
 await visitor.run("document.querySelectorAll('.visitor-hub-nav button')[3].click()");
 await pause(250);assert.ok(await visitor.run("!!document.getElementById('appointmentEmail')"));await visitor.run("closeModal()");
 await visitor.run("showVisitorHub()");
 await visitor.run("document.querySelectorAll('.visitor-hub-nav button')[0].click()");
 checks.push('Welcome shows only separate service cards; all four open on click and Back to services returns to an empty home view');
 await visitor.run("showVisitorHub()");
 await visitor.run("setTheme('dark')");await visitor.screenshot('visitor-mobile-dark');
 if(process.argv.includes('--visual')){
  for(const screen of ['visit','checkvisit','history','chat']){
   await visitor.run(`setTheme('light');navigateVisitor('${screen}')`);await pause(250);
   assert.ok(await visitor.run('document.documentElement.scrollWidth<=window.innerWidth+1'),'Visitor '+screen+' overflows');
   await visitor.screenshot('visitor-'+screen+'-mobile');
   await visitor.run("setTheme('dark')");await pause(220);await visitor.screenshot('visitor-'+screen+'-dark');
   await visitor.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
   await visitor.run("setTheme('light')");await pause(250);await visitor.screenshot('visitor-'+screen+'-desktop');
   await visitor.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  }
 }
 await visitor.goto(base+'/Landing/landing.html');
 assert.equal(await visitor.run("document.querySelectorAll('.hero-actions a').length"),2);
 assert.deepEqual(await visitor.run("Array.from(document.querySelectorAll('#navActions a[href^=\"#\"]')).map(a=>a.getAttribute('href'))"),['#services','#how','#feedback','#faq','#contact']);
 assert.equal(await visitor.run("document.querySelector('.hero-actions .btn-ghost').getAttribute('href')"),'../User/user.html?flow=checkvisit');
 assert.ok(await visitor.run("document.getElementById('services').compareDocumentPosition(document.getElementById('how')) & Node.DOCUMENT_POSITION_FOLLOWING"));
 assert.ok(await visitor.run("getComputedStyle(document.querySelector('.hero-actions .btn-primary')).backgroundColor!==getComputedStyle(document.querySelector('.hero-actions .btn-ghost')).backgroundColor"));
 assert.ok(await visitor.run('document.documentElement.scrollWidth<=window.innerWidth+1'));

 assert.equal(await visitor.run("document.querySelectorAll('.nav-link-primary').length"),1);
 assert.equal(await visitor.run("document.querySelector('.nav-link-primary').textContent"),'Start a Visit');
 assert.equal(await visitor.run("document.querySelector('.nav-link-primary').getAttribute('href')"),'../User/user.html');
 assert.ok(await visitor.run("Array.from(document.querySelectorAll('a[href*=\"user.html\"]')).every(a=>a.getAttribute('aria-disabled')!=='true')"));
 await visitor.screenshot('landing-mobile');checks.push('Landing links remain available outside office hours');
 if(process.argv.includes('--visual')){
  await visitor.run("showScreen('loginScreen');setTheme('light')");await pause(250);await visitor.screenshot('landing-login-mobile');
  assert.ok(await visitor.run('document.documentElement.scrollWidth<=window.innerWidth+1'),'Login overflows');
  await visitor.run("setTheme('dark')");await pause(220);await visitor.screenshot('landing-login-dark');
  await visitor.run("showScreen('landing');setTheme('light')");
 }
 for(let attempt=0;attempt<30;attempt++){if(await visitor.run("window.UniServeRealtime?.connected===true"))break;await pause(200);}
 assert.equal(await visitor.run("window.UniServeRealtime?.connected"),true,'Live public WebSocket subscription failed');
 checks.push('Live landing frontend connects to the configured public realtime channel');
 const errors=visitor.events.filter(e=>e.method==='Runtime.exceptionThrown');assert.deepEqual(errors.map(e=>e.params.exceptionDetails.text),[]);
 for(const width of [320,390,1280]){
  await visitor.send('Emulation.setDeviceMetricsOverride',{width,height:width===320?640:844,deviceScaleFactor:1,mobile:width<600});
  await visitor.goto(base+'/Landing/landing.html');
  await visitor.run(`window.turnstile={render:(selector,options)=>{window.loginWidgetSize=options.size;const node=document.querySelector(selector);node.style.width=options.size==='compact'?'150px':'100%';node.style.minWidth=options.size==='compact'?'150px':'300px';node.style.height=options.size==='compact'?'140px':'65px';options.callback('fixture-token');return 'fixture-widget';},reset:()=>{}};showScreen('loginScreen');setTheme('light');LoginTurnstile.init()`);
  assert.ok(await visitor.run('document.documentElement.scrollWidth<=window.innerWidth+1'),'Login overflows at '+width);
  assert.equal(await visitor.run('window.loginWidgetSize'),width===320?'compact':'flexible');
  assert.ok(await visitor.run('document.querySelector("#loginScreen .auth-card").getBoundingClientRect().width<=380'));
  if(width<600)assert.ok(await visitor.run('document.getElementById("loginUser").getBoundingClientRect().height>=44'));
  await pause(350);await visitor.screenshot('login-compact-'+width);
 }
 checks.push('Compact login fits 320px, 390px and desktop with mobile touch targets and correctly sized verification');
 await visitor.close();
 for(const role of ['ADMIN','HEAD_ADMIN','SUPER_ADMIN']){
  const p=await page();const user={id:'flow-fixture',username:'fixture',fullName:'Flow Test Admin',role:role==='HEAD_ADMIN'?'ADMIN':role,active:true,confidentialAccess:role==='HEAD_ADMIN',confidentialApprover:role==='HEAD_ADMIN'};
  const settings={orgName:'Office of Student Services',supportEmail:'office@example.test',supportPhone:'09123456789',sessionTimeout:30,maintenanceMode:false,gracePeriodMinutes:15,noShowThresholdMinutes:60,appointmentSlotCapacity:1,allowParallelService:false};
  const services=[{key:'good_moral',label:'Good Moral Character',desc:'Certification request',icon:'cap',requirements:[]}];
  const appointments=[{id:'fixture-a',visitId:'VIS-FLOWTEST',code:'APT-TEST',name:'Fixture Visitor',email:'fixture@gmail.com',type:'Student',service:'Good Moral Character',serviceKey:'good_moral',status:'No-show',date:'2026-10-14',time:'10:00',createdAt:new Date().toISOString(),revision:0,shared:true,attachments:[]}];
  const db={users:[user],services,transactions:[],appointments,chats:[],activityLog:[],queues:[],queueCounters:{},visitorLog:[],visitCounter:0,systemSettings:settings,sampleDataRemovedV2:true};
  await p.send('Page.addScriptToEvaluateOnNewDocument',{source:`sessionStorage.setItem('ossuniserve_session',${JSON.stringify(JSON.stringify({currentUser:user,token:'browser-fixture'}))});localStorage.setItem('ossuniserve_db_v1',${JSON.stringify(JSON.stringify(db))});`});
  const requests=[];
  await p.mock(req=>{requests.push(req.url);const pathname=new URL(req.url).pathname;
   if(pathname.endsWith('/settings'))return {settings,revision:0};if(pathname.endsWith('/appointments'))return {appointments};if(pathname.endsWith('/services'))return {services};
   if(pathname.endsWith('/service-records'))return {transactions:[],visitorLog:[]};if(pathname.endsWith('/queue'))return {queues:[]};if(pathname.endsWith('/realtime/config'))return {enabled:false};
   if(pathname.endsWith('/reports'))return {activityLog:[],transactions:[],appointments,queues:[]};if(pathname.endsWith('/admins'))return {users:[]};if(pathname.endsWith('/chats'))return {chats:[]};
   if(pathname.endsWith('/calendar'))return {calendar:{revision:0,weekly:Array.from({length:7},(_,i)=>({open:i>0&&i<6,start:'08:00',end:'17:00'})),lunch:{enabled:true,start:'12:00',end:'13:00'},days:{}}};
   if(pathname.endsWith('/audit'))return {data:[],current_page:1,last_page:1,total:0};return {};
  });
  await p.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await p.goto(base+(role!=='SUPER_ADMIN'?'/Admin/admin.html':'/Super%20Admin/superadmin.html'));
  await p.run("setTheme('light')");
  for(const screen of (role==='SUPER_ADMIN'?['dashboard','users','reports','settings','activitylog','profile']:['dashboard','transactions','logbook','messages','services','reports','feedback','profile'])){
   await p.run(`navigate('${screen}')`);await pause(180);
   assert.ok(await p.run("document.getElementById('content').textContent.trim().length>0"),role+' '+screen+' is empty');
   if(process.argv.includes('--visual')){
    await p.screenshot(role.toLowerCase()+'-'+screen+'-desktop');
    await p.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await pause(300);
    assert.ok(await p.run('document.documentElement.scrollWidth<=window.innerWidth+1'),role+' '+screen+' overflows on mobile');
    await p.screenshot(role.toLowerCase()+'-'+screen+'-mobile');
    await p.run("setTheme('dark')");await pause(220);await p.screenshot(role.toLowerCase()+'-'+screen+'-dark');
    await p.run("setTheme('light')");await p.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
   }
  }
  if(role!=='SUPER_ADMIN'){
   for(const endpoint of ['/queue','/service-records','/appointments'])assert.ok(requests.some(url=>new URL(url).pathname==='/api'+endpoint),role+' did not load '+endpoint);
   if(role==='HEAD_ADMIN'){
    await p.run("manageWalkInIntake()");
    assert.equal(await p.run("document.getElementById('intakeTimeField').hidden"),true);
    await p.run("document.getElementById('intakeMode').value='scheduled';toggleIntakeTime()");
    assert.equal(await p.run("document.getElementById('intakeTimeField').hidden"),false);
    await p.run("document.getElementById('intakeMode').value='automatic';toggleIntakeTime();closeModal()");
   }
   await p.run("navigate('calendar')");await pause(300);
   assert.equal(await p.run("!!document.querySelector('.calendar-grid .calendar-day')"),true);
   await p.screenshot('admin-calendar-desktop');
   await p.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
   await pause(200);
   assert.ok(await p.run('document.documentElement.scrollWidth<=window.innerWidth+1'));
   await p.screenshot('admin-calendar-mobile');
   await p.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
   assert.equal(await p.run("!!document.querySelector('.theme-toggle')"),true);
   await p.run("setTheme('light');document.querySelector('.theme-toggle [data-theme-btn=dark]').click()");
   assert.equal(await p.run("document.documentElement.dataset.theme"),'dark');
   await p.run("document.querySelector('.theme-toggle [data-theme-btn=light]').click()");
   assert.equal(await p.run("document.documentElement.dataset.theme"),'light');
   await p.run("navigate('appointments')");await pause(300);
   assert.ok(await p.run("document.getElementById('content').textContent.includes('Reschedule')"));
   await p.run("openApptDetail('fixture-a',true)");assert.ok(await p.run("!!document.getElementById('mApptDate')"));
   await p.screenshot('admin-reschedule');await p.run("closeModal();navigate('queue')");await pause(200);
   assert.ok(await p.run("document.getElementById('content').textContent.includes('Review remaining visits')"));await p.screenshot('admin-queue');
  }else{
   for(const endpoint of ['/reports','/services','/admins'])assert.ok(requests.some(url=>new URL(url).pathname==='/api'+endpoint),'Super Admin did not load '+endpoint);
   await p.run("setTheme('light');document.querySelector('.theme-toggle [data-theme-btn=dark]').click()");
   assert.equal(await p.run("document.documentElement.dataset.theme"),'dark');
   await p.run("document.querySelector('.theme-toggle [data-theme-btn=light]').click()");
   await p.run("navigate('settings')");await pause(300);
   assert.equal(await p.run("document.getElementById('stSlotCapacity').value"),'1');assert.equal(await p.run("document.getElementById('stParallel').checked"),false);
   await p.screenshot('super-admin-settings');
  }
  await p.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await pause(400);assert.ok(await p.run('document.documentElement.scrollWidth<=window.innerWidth+1'));
  await p.screenshot(role.toLowerCase()+'-mobile');
  const errors=p.events.filter(e=>e.method==='Runtime.exceptionThrown');assert.deepEqual(errors.map(e=>e.params.exceptionDetails.exception?.description||e.params.exceptionDetails.text),[]);
  checks.push(role+' renders the new actions/settings on desktop and mobile without JavaScript exceptions');await p.close();
 }
 fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({passed:true,checks},null,2));console.log(JSON.stringify({passed:true,checks},null,2));
 if(process.argv.includes('--close-browser')){
  const info=await(await fetch('http://127.0.0.1:9224/json/version')).json();const socket=new WebSocket(info.webSocketDebuggerUrl);
  await new Promise((r,j)=>{socket.onopen=r;socket.onerror=j;});socket.send(JSON.stringify({id:1,method:'Browser.close'}));await pause(200);socket.close();
 }
})().catch(e=>{console.error(e);process.exit(1);});
