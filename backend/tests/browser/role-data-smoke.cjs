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
 return {send,run,events,mock:async handler=>{intercept=async params=>{try{const data=handler(params.request);await send('Fetch.fulfillRequest',{requestId:params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'application/json'},{name:'Access-Control-Allow-Origin',value:'*'},{name:'Access-Control-Allow-Headers',value:'*'},{name:'Access-Control-Allow-Methods',value:'*'}],body:Buffer.from(JSON.stringify(data)).toString('base64')});}catch(e){await send('Fetch.failRequest',{requestId:params.requestId,errorReason:'Failed'});}};await send('Fetch.enable',{patterns:[{urlPattern:'*127.0.0.1:8000/api/*'},{urlPattern:'*127.0.0.1:8765/api/*'}]});},
  goto:async url=>{await send('Page.navigate',{url});for(let i=0;i<100;i++){if(await run("document.readyState==='complete'"))break;await pause(100);}await pause(600);},
  screenshot:async name=>{const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.data,'base64'));},
  close:async()=>{await send('Page.close');ws.close();}
 };
}

// Fixture-only UI contract check. All API requests are intercepted.
(async()=>{
 const checks=[];
 for(const role of ['ADMIN','HEAD_ADMIN','SUPER_ADMIN']){
  const p=await page();
  try{
   const user={id:'fixture',username:'fixture',fullName:'Fixture Admin',role:role==='HEAD_ADMIN'?'ADMIN':role,active:true,confidentialAccess:role==='HEAD_ADMIN',confidentialApprover:role==='HEAD_ADMIN'};
   const settings={sessionTimeout:30,maintenanceMode:false,gracePeriodMinutes:15,noShowThresholdMinutes:60,appointmentOffices:['Office of Student Services'],appointmentSlotCapacity:1,allowParallelService:false};
   const services=[{key:'good_moral',label:'Good Moral Character',icon:'cap',requirements:[]}];
   const now=new Date().toISOString(),queues=[{id:'q',number:'A-001',visitId:'VIS-FIXTURE',status:'Waiting',source:'Walk-in',serviceKey:'good_moral',serviceLabel:'Good Moral Character',createdAt:now,shared:true}];
   const feedbackSummary={responses:2,completed:4,average:3.5,satisfactionPercent:50,responseRate:50,withComment:1,distribution:[{rating:5,count:1},{rating:2,count:1}]};
   const appointments=[{id:'private-appt',visitId:'VIS-PRIVATE',status:'Completed',serviceKey:'incident_report',service:'Incident report',name:'Restricted record',type:'',attachments:[],restricted:true,shared:true,createdAt:now,date:now.slice(0,10),time:'10:00',revision:0}];
   const db={users:[user],services,transactions:[],appointments,queues:[],chats:[],activityLog:[],visitorLog:[],queueCounters:{},visitCounter:0,systemSettings:settings,sampleDataRemovedV2:true};
   await p.send('Page.addScriptToEvaluateOnNewDocument',{source:'sessionStorage.setItem("ossuniserve_session",'+JSON.stringify(JSON.stringify({currentUser:user,token:'fixture'}))+');localStorage.setItem("ossuniserve_db_v1",'+JSON.stringify(JSON.stringify(db))+');'});
   const outputRequests=[];
   await p.mock(req=>{
    if(req.method==='OPTIONS')return {};
    const pathname=new URL(req.url).pathname;
    if(pathname.endsWith('/report-data')){const options=JSON.parse(req.postData||'{}');outputRequests.push(options);return {transactions:[],visitorLog:[],appointments:[],queues,confidentialIncluded:options.includeConf};}
    if(pathname.endsWith('/unlock'))return {expiresAt:new Date(Date.now()+300000).toISOString()};
    if(pathname.endsWith('/settings'))return {settings,revision:0};if(pathname.endsWith('/services'))return {services};
    if(pathname.endsWith('/reports'))return {feedbackSummary,activityLog:[],transactions:[],appointments:[],queues};
    if(pathname.endsWith('/queue'))return {queues};if(pathname.endsWith('/appointments'))return {appointments};
    if(pathname.endsWith('/service-records'))return {transactions:[],visitorLog:[]};if(pathname.endsWith('/admins'))return {users:[user]};if(pathname.endsWith('/chats'))return {chats:[]};
    if(pathname.endsWith('/realtime/config'))return {enabled:false};
    if(pathname.endsWith('/calendar'))return {calendar:{revision:0,weekly:Array.from({length:7},()=>({open:true,start:'08:00',end:'17:00'})),lunch:{enabled:true,start:'12:00',end:'13:00'},days:{}}};
    if(pathname.endsWith('/confidential'))return {approver:role==='HEAD_ADMIN',requests:[],cases:[],admins:[]};
    if(pathname.endsWith('/audit'))return {data:[],current_page:1,last_page:1,total:0};return {};
   });
   await p.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
   await p.goto('http://127.0.0.1:8765/'+(role==='SUPER_ADMIN'?'Super%20Admin/superadmin.html':'Admin/admin.html'));
   await p.run("navigate('dashboard')");await pause(600);
   if(role==='SUPER_ADMIN'){
    assert.equal(await p.run('loadDB().feedbackSummary.responses'),2);
    assert.ok(await p.run("document.getElementById('content').textContent.includes('System overview')"));
    assert.ok(await p.run("document.getElementById('content').textContent.includes('Active staff accounts')"));
    assert.ok(await p.run("document.getElementById('content').textContent.includes('Security and system activity')"));
    assert.equal(await p.run("document.getElementById('content').textContent.includes('Recent Comments')"),false);
   }else{
    await p.run("navigate('appointments')");await pause(400);
    assert.ok(await p.run("loadDB().appointments.some(a=>a.restricted)"));
   }
   await p.run("navigate('reports')");await pause(450);
   await p.run("window.fixturePrinted=[]; printInjected=html=>window.fixturePrinted.push(html)");
   await p.run('printReport()');await pause(150);
   if(role==='SUPER_ADMIN'){
    assert.equal(await p.run('window.fixturePrinted.length'),1);
    assert.equal(outputRequests.length,0);
   }else{
    assert.ok(await p.run("document.getElementById('activeModal').textContent.includes('Print redacted copy')"));
    assert.equal(await p.run("document.getElementById('activeModal').textContent.includes('Unlock and print')"),role==='HEAD_ADMIN');
    await p.run("[...document.querySelectorAll('#activeModal button')].find(b=>b.textContent.trim()==='Print redacted copy').click()");await pause(250);
    assert.equal(outputRequests[0].includeConf,false);
    assert.equal(await p.run('window.fixturePrinted.length'),1);
    if(role==='HEAD_ADMIN'){
     await p.run('printReport()');await pause(100);
     await p.run("[...document.querySelectorAll('#activeModal button')].find(b=>b.textContent.trim()==='Unlock and print').click()");await pause(150);
     assert.equal(await p.run('window.fixturePrinted.length'),1);
     await p.run("document.getElementById('confPassword').value='fixture-password'; [...document.querySelectorAll('#activeModal button')].find(b=>b.textContent.trim()==='Unlock').click()");await pause(300);
     assert.equal(outputRequests[1].includeConf,true);
     assert.equal(await p.run('window.fixturePrinted.length'),2);
    }
   }
   checks.push(role+' Reports print flow respects role and redacted/unlocked choices');
   await p.screenshot('role-data-'+role.toLowerCase()+'-desktop');
   await p.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await pause(300);
   assert.ok(await p.run('document.documentElement.scrollWidth<=innerWidth+1'),role+' mobile overflow');
   await p.screenshot('role-data-'+role.toLowerCase()+'-mobile');
   assert.deepEqual(p.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails.exception?.description||e.params.exceptionDetails.text),[]);
   checks.push(role+' desktop/mobile renders authorized fixture data without exceptions');
  }finally{await p.close();}
 }

 const visitor=await page();
 try{
  const now=new Date().toISOString(),q={id:'visitor-q',visitId:'VIS-FIXTURE',number:'A-001',name:'Fixture Visitor',email:'fixture@gmail.com',visitorType:'Student',serviceKey:'good_moral',serviceLabel:'Good Moral Character',source:'Walk-in',status:'Serving',createdAt:now,checkedInAt:now,servingAt:now,shared:true};
  const settings={maintenanceMode:false,sessionTimeout:30};
  const services=[{key:'good_moral',label:'Good Moral Character',icon:'cap',requirements:[]}];
  const db={users:[],services,transactions:[],appointments:[],queues:[q],chats:[],activityLog:[],visitorLog:[],queueCounters:{},visitCounter:0,systemSettings:settings,sampleDataRemovedV2:true};
  await visitor.send('Page.addScriptToEvaluateOnNewDocument',{source:'sessionStorage.clear();sessionStorage.setItem("oss_myActiveQueueId","visitor-q");sessionStorage.setItem("oss_visitStep","ticket");localStorage.setItem("ossuniserve_db_v1",'+JSON.stringify(JSON.stringify(db))+');'});
  await visitor.mock(req=>{
   const pathname=new URL(req.url).pathname;
   if(pathname.endsWith('/settings'))return {settings,revision:0};if(pathname.endsWith('/services'))return {services};if(pathname.endsWith('/realtime/config'))return {enabled:false};
   if(pathname.endsWith('/calendar'))return {calendar:{revision:0,weekly:Array.from({length:7},()=>({open:true,start:'00:00',end:'23:59'})),lunch:{enabled:false},days:{}}};
   if(pathname.includes('/visits/'))return {queue:q};if(pathname.endsWith('/walk-in-capacity'))return {accepting:true};
   if(pathname.endsWith('/feedback')){q.feedback={rating:5,comment:'Fixture feedback'};return {queue:q};}return {};
  });
  await visitor.goto('http://127.0.0.1:8765/User/user.html?flow=visit');
  for(const width of [1280,390,320]){
   await visitor.send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<600});await pause(250);
   assert.ok(await visitor.run(`(()=>{const card=document.querySelector('.ticket-v2-card'),stub=card.querySelector('.ticket-v2-stub'),main=card.querySelector('.ticket-v2-main'),grid=card.querySelector('.ticket-v2-grid');return getComputedStyle(card).flexDirection==='row'&&getComputedStyle(grid).gridTemplateColumns.split(' ').length===2&&stub.getBoundingClientRect().left>=main.getBoundingClientRect().right-1&&document.documentElement.scrollWidth<=innerWidth+1;})()`),'Ticket must retain desktop arrangement at '+width);
   await visitor.screenshot('visitor-ticket-'+width);
  }
  checks.push('Visitor ticket retains its desktop side stub and two-column details at 320px and 390px');
  q.status='Completed';q.completedAt=now;
  await visitor.run('renderQueueTicket()');await pause(200);
  assert.ok(await visitor.run("!!document.querySelector('.ticket-v2-bottom .ticket-v2-stamp')"));
  assert.ok(await visitor.run("document.getElementById('visitorContent').textContent.includes('Rate Your Visit')"));
  await visitor.run('showVisitorHub();navigateVisitor("visit")');await pause(250);
  assert.ok(await visitor.run("!!document.querySelector('.ticket-v2-stamp')"),'Start Visit must retain completed ticket');
  await visitor.run('setFeedbackStars(5);submitVisitFeedback("visitor-q")');await pause(250);
  assert.ok(await visitor.run("document.getElementById('visitorContent').textContent.includes('Feedback Received')"));
  await visitor.screenshot('role-data-visitor-completed');
  await visitor.run('resetVisit()');await pause(200);
  assert.equal(await visitor.run("!!document.querySelector('.ticket-v2-stamp')"),false);
  assert.ok(await visitor.run("!!document.querySelector('.visit-start-page')"));
  assert.deepEqual(visitor.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails.exception?.description||e.params.exceptionDetails.text),[]);
  checks.push('Visitor completion retains ticket/stamp, feedback submits, and explicit Start another visit resets the form');
 }finally{await visitor.close();}
 fs.writeFileSync(path.join(out,'role-data-results.json'),JSON.stringify({passed:true,checks},null,2));console.log(JSON.stringify({passed:true,checks}));
})().catch(e=>{console.error(e);process.exitCode=1;});
