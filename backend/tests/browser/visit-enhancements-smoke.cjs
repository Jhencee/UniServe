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
 const checks=[],pages=[];const base='http://127.0.0.1:8765';
 const settings={sessionTimeout:30,maintenanceMode:false,gracePeriodMinutes:15,noShowThresholdMinutes:60,appointmentSlotCapacity:1,allowParallelService:false};
 const services=[{key:'good_moral',label:'Good Moral Character',desc:'Certification',icon:'cap',requirements:['Clearance'],announcement:'Bring an updated clearance.'}];
 let appointment={id:'audit-a',visitId:'VIS-AUDIT123',code:'APT-AUDIT',name:'Audit Visitor',email:'audit@gmail.com',contact:'09123456789',type:'Student',service:'Good Moral Character',serviceKey:'good_moral',status:'Requested',date:null,time:null,createdAt:new Date().toISOString(),revision:0,shared:true,attachments:[{name:'Clearance.pdf',type:'application/pdf',size:4,dataUrl:'data:application/pdf;base64,JVBERg=='}]};
 const requests=[];
 const calendar={revision:0,weekly:Array.from({length:7},()=>({open:true,start:'08:00',end:'17:00'})),lunch:{enabled:true,start:'12:00',end:'13:00'},days:{}};
 async function mock(p){await p.mock(req=>{
  const pathname=new URL(req.url).pathname;requests.push({path:pathname,method:req.method});const body=req.postData?JSON.parse(req.postData):{};if(req.method==='OPTIONS')return {};
  if(pathname.endsWith('/settings'))return {settings,revision:0};
  if(pathname.endsWith('/services'))return {services};
  if(pathname.endsWith('/calendar'))return {calendar};
  if(pathname.endsWith('/realtime/config'))return {enabled:false};
  if(pathname.endsWith('/service-records'))return {transactions:[],visitorLog:[]};
  if(pathname.endsWith('/queue'))return {queues:[]};
  if(pathname.endsWith('/chats'))return {chats:[]};
  if(pathname.endsWith('/walk-in-capacity'))return {accepting:true,peopleAhead:{},waitEstimates:{}};
  if(pathname.endsWith('/history/session'))return {verified:true};
  if(pathname.endsWith('/documents/0')){appointment.attachments[0].review={status:body.status,reason:body.reason,reviewedAt:new Date().toISOString()};appointment.revision++;return {appointment};}
  if(pathname.endsWith('/follow-up-task')){appointment.followUpTask={text:body.text,dueDate:body.dueDate,completed:body.completed};appointment.revision++;return {appointment};}
  if(pathname.endsWith('/waitlist')){appointment.earlierSlotOptIn=body.enabled;appointment.waitlistJoinedAt=new Date().toISOString();appointment.revision++;return {appointment};}
  if(pathname.endsWith('/appointments'))return {appointments:[appointment]};
  if(pathname.includes('/appointments/visit/'))return {appointment};
  return {};
 });}
 try{
  const staff=await page();pages.push(staff);await mock(staff);
  const user={id:'audit-admin',username:'audit',fullName:'Audit Admin',role:'ADMIN',active:true,confidentialAccess:true,confidentialApprover:true};
  const db={users:[user],services,transactions:[],appointments:[appointment],chats:[],activityLog:[],queues:[],queueCounters:{},visitorLog:[],visitCounter:0,systemSettings:settings,sampleDataRemovedV2:true};
  await staff.send('Page.addScriptToEvaluateOnNewDocument',{source:'sessionStorage.setItem("ossuniserve_session",'+JSON.stringify(JSON.stringify({currentUser:user,token:'fixture'}))+');localStorage.setItem("ossuniserve_db_v1",'+JSON.stringify(JSON.stringify(db))+');'});
  await staff.goto(base+'/Admin/admin.html');
  assert.ok(await staff.run('document.getElementById("content").textContent.includes("Staff workload")'));
  await staff.run('openApptDetail("audit-a")');
  assert.equal(await staff.run('document.getElementById("documentStatus0").value'),'Pending review');
  await staff.run('document.getElementById("documentStatus0").value="Needs correction";document.getElementById("documentReason0").value="Bring a readable signed copy.";saveDocumentReview(document.querySelector("[data-review-id]"))');
  assert.equal(appointment.attachments[0].review.status,'Needs correction');
  assert.equal(await staff.run('loadDB().appointments.find(a=>a.id==="audit-a").revision'),1);
  await staff.run('editVisitTask("audit-a")');
  await staff.run('document.getElementById("visitTaskAction").value="Other";toggleVisitTaskOther();document.getElementById("visitTaskText").value="Bring the signed original.";document.getElementById("visitTaskDue").value="2099-01-05";document.getElementById("modalBtn1").click()');await pause(250);
  assert.equal(appointment.followUpTask.text,'Bring the signed original.');
  assert.ok(await staff.run('document.querySelector(".modal-body").textContent.includes("Bring the signed original.")'));
  checks.push('Actual staff modal saves document review and follow-up through the API/cache layers');
  const visitor=await page();pages.push(visitor);await mock(visitor);await visitor.goto(base+'/User/user.html?flow=checkvisit');
  await visitor.run('sessionStorage.setItem("ossuniserve_visitor_token","fixture");SharedAppointments.request("/appointments/visit/VIS-AUDIT123").then(SharedAppointments.cache).then(r=>showPassModalReadonly(r.appointment,true))');
  assert.ok(await visitor.run('document.getElementById("visitorContent").textContent.includes("Bring a readable signed copy.")'));
  assert.ok(await visitor.run('document.getElementById("visitorContent").textContent.includes("Bring the signed original.")'));
  assert.ok(await visitor.run('document.getElementById("visitorContent").textContent.includes("Request received")'));
  await visitor.run('toggleEarlierSlot(document.querySelector("[data-enabled]"))');
  assert.equal(appointment.earlierSlotOptIn,true);
  assert.ok(await visitor.run('document.getElementById("visitorContent").textContent.includes("Leave waitlist")'));
  await staff.run('closeModal();navigate("dashboard")');await pause(350);
  assert.ok(await staff.run('document.querySelector(".waitlist-action .dashboard-attention-count").textContent === "1"'));
  checks.push('Separate visitor screen receives staff edits; visitor opt-in reaches the staff dashboard');
  for(const p of [staff,visitor]){
   const persisted=await p.run('localStorage.getItem("ossuniserve_db_v1")||""');
   assert.ok(!persisted.includes('Bring the signed original.')&&!persisted.includes('Bring a readable signed copy.')&&!persisted.includes('JVBERg=='),'Private feature data leaked into local storage');
   await p.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await pause(150);
   assert.ok(await p.run('document.documentElement.scrollWidth<=window.innerWidth+1'),'Page overflows on mobile');
   const errors=p.events.filter(e=>e.method==='Runtime.exceptionThrown');assert.deepEqual(errors.map(e=>e.params.exceptionDetails.exception?.description||e.params.exceptionDetails.text),[]);
  }
  await visitor.screenshot('audit-visitor-enhancements-mobile');await staff.screenshot('audit-staff-workload-mobile');
  checks.push('No uncaught browser exceptions, no mobile page overflow, and private feature content stays out of local storage');
  console.log(JSON.stringify({passed:true,checks,apiRequests:requests.length},null,2));
 }finally{for(const p of pages)await p.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
