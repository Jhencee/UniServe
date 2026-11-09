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

(async()=>{
 const checks=[],pages=[];const base='http://127.0.0.1:8765';
 const settings={sessionTimeout:30,maintenanceMode:false,gracePeriodMinutes:15,noShowThresholdMinutes:60,appointmentSlotCapacity:1,allowParallelService:false};
 const services=[{key:'good_moral',label:'Good Moral Character',desc:'Certification',icon:'cap',requirements:['Clearance'],announcement:'Bring an updated clearance.'}];
 let appointment={permissions:{editFollowUp:true},id:'audit-a',visitId:'VIS-AUDIT123',code:'APT-AUDIT',name:'Audit Visitor',email:'audit@gmail.com',contact:'09123456789',type:'Student',service:'Good Moral Character',serviceKey:'good_moral',status:'Requested',date:null,time:null,createdAt:new Date().toISOString(),revision:0,shared:true,attachments:[{name:'Clearance.pdf',type:'application/pdf',size:4,dataUrl:'data:application/pdf;base64,JVBERg=='}]};
 const requests=[];let caseRecord=null,queueFixtures=[],rejectChecklist=false;
 const calendar={revision:0,weekly:Array.from({length:7},()=>({open:true,start:'08:00',end:'17:00'})),lunch:{enabled:true,start:'12:00',end:'13:00'},days:{}};
 async function mock(p){await p.mock(req=>{
  const pathname=new URL(req.url).pathname;requests.push({path:pathname,method:req.method});const body=req.postData?JSON.parse(req.postData):{};if(req.method==='OPTIONS')return {};
  if(pathname.endsWith('/task-owners'))return {owners:[{id:'audit-admin',full_name:'Audit Admin'}]};
  if(pathname.endsWith('/confidential/cases/process-case/unlock'))return {assignedAdmin:'Audit Admin',expiresAt:new Date(Date.now()+300000).toISOString()};
  if(pathname.endsWith('/settings'))return {settings,revision:0};
  if(pathname.endsWith('/services'))return {services};
  if(pathname.endsWith('/calendar'))return {calendar};
  if(pathname.endsWith('/realtime/config'))return {enabled:false};
  if(pathname.endsWith('/service-records'))return {transactions:caseRecord?[caseRecord]:[],visitorLog:[]};
  if(pathname.endsWith('/service-records/process-case')&&req.method==='PATCH'){caseRecord={...caseRecord,escalation:body.escalation,caseStatus:body.escalation==='Resolved'?'Resolved':'Open',caseOwnerId:body.ownerId,caseDueDate:body.dueDate,caseNextAction:body.nextAction,caseNotes:body.notes,caseRevision:(caseRecord.caseRevision||0)+1};return {saved:true};}
  if(pathname.endsWith('/visits')&&req.method==='POST')return {queue:{...body,id:'assisted-q',visitId:'VIS-ASSISTED',number:'G-001',source:'Walk-in',status:'Waiting',createdAt:new Date().toISOString(),shared:true}};
  if(pathname.endsWith('/check-in'))return {appointment:{...appointment,status:'Checked-in'}};
  if(pathname.includes('/queue/')&&pathname.endsWith('/requirements')){
   if(rejectChecklist)throw Error('Simulated checklist failure');
   const queue=queueFixtures.find(q=>q.id===pathname.split('/').at(-2));
   queue.requirementChecks=(queue.requirementChecks||[]).filter(c=>c.serviceKey!==body.serviceKey||c.requirement!==body.requirement).concat({...body,checkedAt:new Date().toISOString()});return {queue};
  }
  if(pathname.endsWith('/queue'))return {queues:queueFixtures};
  if(pathname.endsWith('/chats'))return {chats:[]};
  if(pathname.endsWith('/walk-in-capacity'))return {accepting:true,peopleAhead:{},waitEstimates:{}};
  if(pathname.endsWith('/history/session'))return {verified:true};
  if(pathname.endsWith('/documents/0')){if(req.method==='PUT')appointment.attachments[0]={name:body.name,dataUrl:body.dataUrl,size:20,type:'application/pdf',review:{status:'Pending review'}};else appointment.attachments[0].review={status:body.status,reason:body.reason,requirement:body.requirement||'',serviceKey:appointment.serviceKey,reviewedAt:new Date().toISOString()};appointment.revision++;return {appointment};}
  if(pathname.endsWith('/follow-up-task')){const task={id:body.taskId||'task-'+appointment.revision,text:body.text,dueDate:body.dueDate,completed:body.completed,ownerId:body.ownerId,ownerName:'Audit Admin',completionNotes:body.completionNotes};appointment.followUpTasks=(appointment.followUpTasks||[]).filter(t=>t.id!==task.id).concat(task);appointment.followUpTask=task;appointment.revision++;return {appointment};}
  if(pathname.endsWith('/waitlist')){appointment.earlierSlotOptIn=body.enabled;appointment.waitlistJoinedAt=new Date().toISOString();appointment.revision++;return {appointment};}
  if(pathname.endsWith('/appointments'))return {appointments:[appointment]};
  if(pathname.endsWith('/appointment-slots'))return {slots:['09:00'],availability:[{time:'09:00',available:true,remaining:1,capacity:1,occupied:0,pending:0,confirmed:0}]};
  if(pathname.includes('/appointments/visit/'))return {appointment};
  return {};
 });}
 try{
  const staff=await page();pages.push(staff);await mock(staff);
  const user={id:'audit-admin',username:'audit',fullName:'Audit Admin',role:'ADMIN',active:true,confidentialAccess:true,confidentialApprover:true};
  const db={users:[user],services,transactions:[],appointments:[appointment],chats:[],activityLog:[],queues:[],queueCounters:{},visitorLog:[],visitCounter:0,systemSettings:settings,sampleDataRemovedV2:true};
  await staff.send('Page.addScriptToEvaluateOnNewDocument',{source:'sessionStorage.setItem("ossuniserve_session",'+JSON.stringify(JSON.stringify({currentUser:user,token:'fixture'}))+');localStorage.setItem("ossuniserve_db_v1",'+JSON.stringify(JSON.stringify(db))+');'});
  await staff.goto(base+'/Admin/admin.html');
  assert.ok(await staff.run('document.getElementById("content").textContent.includes("Service overview")'));
  await staff.screenshot('dashboard-welcome');
  const notificationCount=await staff.run('document.querySelector("#sidebarNotifications .notification-bell-count").textContent');
  for(const view of ['calendar','appointments','dashboard']){
    await staff.run('navigate('+JSON.stringify(view)+')');await pause(200);
    assert.equal(await staff.run('document.querySelector("#sidebarNotifications .notification-bell-count").textContent'),notificationCount,'Sidebar navigation must not change the notification total');
  }
  checks.push('Notification count stays consistent across sidebar navigation');
  assert.equal(await staff.run('document.querySelector(".staff-notification-count").textContent'),notificationCount);
  assert.equal(await staff.run('getComputedStyle(document.querySelector(".staff-notification-button")).borderTopWidth'),'0px');
  await staff.run('document.querySelector("#sidebarNotifications .notification-bell-count").textContent="2"');await pause(30);
  assert.equal(await staff.run('document.querySelector(".staff-notification-count").textContent'),'2');
  assert.equal(await staff.run('document.querySelector(".staff-notification-count").hidden'),false);
  await staff.run('refreshSidebarNotificationCount()');

  await staff.run('document.querySelector(".staff-notification-button").click()');await pause(200);
  assert.equal(await staff.run('state_view'),'notifications');
  assert.equal(await staff.run('!!document.querySelector(".browser-alert-toggle")'),false);
  assert.equal(await staff.run('document.querySelector(".staff-notification-count").textContent'),await staff.run('document.querySelector("#sidebarNotifications .notification-bell-count").textContent'));
  checks.push('Header bell opens the sidebar inbox, shares its unread count, without browser-alert settings');

  await staff.run('reviewAppointmentRequirements("audit-a")');
  assert.equal(await staff.run('document.getElementById("documentStatus0").value'),'Pending review');
  await staff.run('document.getElementById("documentStatus0").value="Needs correction";document.getElementById("documentReason0").value="Other";toggleDocumentCorrection(document.getElementById("documentReason0"));document.getElementById("documentReason0Other").value="Bring a readable signed copy.";saveDocumentReview(document.querySelector("[data-review-id]"))');
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
  await staff.run('closeModal();navigate("notifications")');await pause(350);
  for(let i=0;i<20&&!await staff.run('document.querySelectorAll(".notification-entry[data-category=waitlist]").length === 1');i++)await pause(100);
  assert.ok(await staff.run('document.querySelectorAll(".notification-entry[data-category=waitlist]").length === 1'));
  checks.push('Separate visitor screen receives staff edits; visitor opt-in reaches staff notifications');
  for(const p of [staff,visitor]){
   const persisted=await p.run('localStorage.getItem("ossuniserve_db_v1")||""');
   assert.ok(!persisted.includes('Bring the signed original.')&&!persisted.includes('Bring a readable signed copy.')&&!persisted.includes('JVBERg=='),'Private feature data leaked into local storage');
   await p.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await pause(150);
   assert.ok(await p.run('document.documentElement.scrollWidth<=window.innerWidth+1'),'Page overflows on mobile');
   const errors=p.events.filter(e=>e.method==='Runtime.exceptionThrown');assert.deepEqual(errors.map(e=>e.params.exceptionDetails.exception?.description||e.params.exceptionDetails.text),[]);
  }
  await visitor.screenshot('audit-visitor-enhancements-mobile');await staff.screenshot('audit-staff-workload-mobile');
  checks.push('No uncaught browser exceptions, no mobile page overflow, and private feature content stays out of local storage');
  await visitor.run(`(()=>{const input=document.getElementById('replacement0'),transfer=new DataTransfer();transfer.items.add(new File(['%PDF-1.4 corrected'],'corrected.pdf',{type:'application/pdf'}));input.files=transfer.files;return replaceVisitDocument(document.querySelector('[onclick="replaceVisitDocument(this)"]'));})()`);
  assert.equal(appointment.attachments[0].review.status,'Pending review');
  assert.ok(await visitor.run('document.getElementById("visitorContent").textContent.includes("corrected.pdf")'));
  checks.push('Visitor submits a replacement from the existing requirement card and sees pending review');
  appointment={...appointment,needsRescheduling:true,reviewExpiredAt:new Date().toISOString(),rescheduleRequested:true,date:null,time:null,reviewDueAt:new Date().toISOString()};
  await visitor.run('SharedAppointments.request("/appointments/visit/audit-a").then(SharedAppointments.cache).then(r=>showPassModalReadonly(r.appointment,true))');
  assert.ok(await visitor.run('document.getElementById("visitorContent").textContent.includes("Needs rescheduling")'));
  assert.ok(await visitor.run('document.getElementById("visitorContent").textContent.includes("not a no-show")'));
  checks.push('Expired unconfirmed requests show rescheduling instructions without blaming the visitor');
  await staff.run('SharedAppointments.request("/appointments").then(SharedAppointments.cache).then(()=>editVisitTask("audit-a",null))');await pause(100);
  await staff.run('document.getElementById("visitTaskAction").value="Contact OSS for an update";document.getElementById("visitTaskDue").value="2099-01-06";document.getElementById("modalBtn1").click()');await pause(200);
  assert.equal(appointment.followUpTasks.length,2);
  assert.ok(await staff.run('document.querySelector(".modal-body").textContent.includes("Bring the signed original.")&&document.querySelector(".modal-body").textContent.includes("Contact OSS for an update")'));
  await staff.screenshot('process-follow-up-tasks-mobile');
  checks.push('Staff add a second assigned follow-up without overwriting the first task');
  appointment={...appointment,status:'Booked',date:'2099-01-01',time:'15:00'};
  await staff.run('SharedAppointments.request("/appointments").then(SharedAppointments.cache).then(()=>adminCheckInAppointment("audit-a"))');
  assert.ok(await staff.run('document.getElementById("arrivalOverrideReason")!==null'));
  await staff.run('document.getElementById("arrivalOverrideReason").value="Assisted arrival reviewed at counter";document.getElementById("modalBtn1").click()');await pause(200);
  assert.ok(requests.some(r=>r.path.endsWith('/check-in')&&r.method==='POST'));
  checks.push('Staff see the arrival-window override modal before submitting an early check-in');
  await staff.run('openAssistedIntake()');
  assert.ok(await staff.run(`(()=>{const input=document.getElementById('assistedContact'),wrapper=input.closest('.ph-phone-input'),prefix=wrapper.querySelector('.ph-phone-prefix');return wrapper.getBoundingClientRect().height===42&&prefix.getBoundingClientRect().width===54&&getComputedStyle(input).borderTopWidth==='0px'&&!wrapper.textContent.includes('country code');})()`),'Phone control must have a compact flag prefix and a single outer border');
  await staff.screenshot('process-assisted-form-mobile');
  await staff.run('document.getElementById("assistedFirst").value="Assisted";document.getElementById("assistedLast").value="Visitor";document.getElementById("assistedContact").value="09123456789";document.getElementById("assistedIdentity").value="Government ID checked at the counter";document.getElementById("modalBtn1").click()');await pause(200);
  for(let i=0;i<30;i++){if(await staff.run('!!document.querySelector(".modal-body")?.textContent.includes("VIS-ASSISTED")'))break;await pause(100);}
  assert.ok(await staff.run('document.querySelector(".modal-body").textContent.includes("VIS-ASSISTED")'));
  assert.ok(await staff.run('document.getElementById("modalBtn1").textContent.includes("Print ticket")'));
  await staff.screenshot('process-assisted-ticket-mobile');
  checks.push('Assisted intake without email issues a printable ticket through the existing modal');
  caseRecord={id:'process-case',code:'OSS-PROCESS',name:'Case Visitor',type:'Student',service:'concern',status:'Completed',caseStatus:'Open',caseOwnerId:'audit-admin',caseOwnerName:'Audit Admin',caseRevision:0,createdAt:new Date().toISOString(),permissions:{editCase:true},shared:true};
  await staff.run('confUnlocked.set("process-case",Date.now()+300000);SharedAppointments.reloadRecords().then(()=>openTxnDetail("process-case"))');await pause(150);
  await staff.run('document.getElementById("confPassword").value="FixturePassword123";document.getElementById("modalBtn1").click()');
  for(let i=0;i<30;i++){if(await staff.run('!!document.getElementById("caseDue")'))break;await pause(100);}
  assert.ok(await staff.run('document.getElementById("caseDue")!==null'),await staff.run('JSON.stringify({record:loadDB().transactions.find(t=>t.id==="process-case"),modal:document.querySelector(".modal-body")?.textContent,errors:[...document.querySelectorAll(".toast")].map(t=>t.textContent)})'));
  await staff.run('document.getElementById("caseDue").value="2099-01-07";document.getElementById("caseAction").value="Confirm outcome with visitor";document.getElementById("caseNotes").value="Resolved after reviewing the concern";document.getElementById("mTxEscalation").value="Resolved";document.getElementById("modalBtn1").click()');await pause(200);
  assert.equal(caseRecord.caseStatus,'Resolved');assert.equal(caseRecord.caseNextAction,'Confirm outcome with visitor');
  checks.push('Case resolution saves its owner, next action, due date and resolution notes');
  services[0].requirements=['Clearance','Student ID'];
  queueFixtures=[{id:'check-q',visitId:'VIS-CHECKLIST',number:'A-101',visitorType:'Student',name:'Checklist Visitor',serviceKey:'good_moral',serviceLabel:'Good Moral Character',status:'Serving',assignedAdminId:'audit-admin',assignedAdminName:'Audit Admin',createdAt:new Date().toISOString(),servingAt:new Date().toISOString(),source:'Walk-in',shared:true},{id:'other-q',visitId:'VIS-OTHER',number:'A-102',visitorType:'Student',name:'Another Visitor',serviceKey:'good_moral',status:'Waiting',createdAt:new Date().toISOString(),shared:true}];
  await staff.run('closeModal();const checklistDB=loadDB();checklistDB.services[0].requirements=["Clearance","Student ID"];saveDB(checklistDB);navigate("queue")');
  for(let i=0;i<40;i++){if(await staff.run('!!document.querySelector(".qd-serving-card .queue-requirements input")'))break;await pause(100);}
  assert.equal(await staff.run('document.querySelector(".qd-serving-card .queue-complete-action").disabled'),true);
  assert.ok(await staff.run('document.querySelector(".queue-requirements-table").textContent.includes("Incomplete")'));
  await staff.run('document.querySelector(".qd-serving-card .queue-requirements input").click()');
  for(let i=0;i<40;i++){if(queueFixtures[0].requirementChecks?.length===1&&await staff.run('!queueRequirementSaving.size'))break;await pause(100);}
  assert.equal(queueFixtures[0].requirementChecks[0].checked,true);assert.equal(queueFixtures[1].requirementChecks,undefined);
  await staff.run('renderQueueDashboard()');
  assert.equal(await staff.run('document.querySelector(".qd-serving-card .queue-requirements input").checked'),true);
  await staff.run('openQueueVisitDetail("check-q");document.querySelectorAll("#activeModal .queue-requirements input")[1].click()');
  for(let i=0;i<40;i++){if(queueFixtures[0].requirementChecks?.length===2&&await staff.run('!queueRequirementSaving.size'))break;await pause(100);}
  assert.equal(await staff.run('document.querySelector("#activeModal .queue-complete-action").disabled'),false);
  assert.ok(await staff.run('[...document.querySelectorAll(".queue-requirements-head")].filter(el=>el.closest(".queue-requirements").dataset.queueId==="check-q").every(el=>el.textContent.includes("2 of 2 checked"))'));
  rejectChecklist=true;await staff.run('document.querySelector("#activeModal .queue-requirements input").click()');
  for(let i=0;i<40;i++){if(await staff.run('!queueRequirementSaving.size'))break;await pause(100);}
  assert.equal(await staff.run('document.querySelector("#activeModal .queue-requirements input").checked'),true);
  assert.equal(queueFixtures[0].requirementChecks.filter(c=>c.checked).length,2);rejectChecklist=false;
  await staff.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await pause(200);
  assert.ok(await staff.run('document.documentElement.scrollWidth<=innerWidth+1'));await staff.screenshot('queue-requirements-mobile');
  await staff.run('closeModal()');queueFixtures[0].status='Completed';await staff.run('renderQueueDashboard().then(()=>openQueueVisitDetail("check-q"))');
  assert.ok(await staff.run('[...document.querySelectorAll("#activeModal .queue-requirements input")].every(input=>input.disabled&&input.checked)'));
  await staff.run('closeModal()');checks.push('Queue requirements save per visit, survive refresh, sync card and modal, revert failed saves and become read only after completion');
  await staff.run('reviewAppointmentRequirements("audit-a")');
  for(let i=0;i<30;i++){if(await staff.run('!!document.getElementById("documentRequirement0")'))break;await pause(100);}
  await staff.run('document.getElementById("documentStatus0").value="Accepted";document.getElementById("documentRequirement0").value="Clearance";saveDocumentReview(document.querySelector("[data-review-id]"))');
  for(let i=0;i<30;i++){if(appointment.attachments[0].review?.status==='Accepted')break;await pause(100);}
  assert.equal(appointment.attachments[0].review.requirement,'Clearance');
  queueFixtures[0]={...queueFixtures[0],status:'Serving',source:'Appointment',appointmentId:'audit-a',requirementChecks:[]};
  await staff.run('closeModal();renderQueueDashboard()');
  assert.ok(await staff.run('(()=>{const inputs=document.querySelectorAll(".qd-serving-card .queue-requirements input");return inputs[0].checked&&inputs[0].disabled&&!inputs[1].checked&&document.querySelector(".qd-serving-card").textContent.includes("Accepted upload")&&document.querySelector(".qd-serving-card .queue-complete-action").disabled;})()'));
  await staff.screenshot('queue-accepted-upload-mobile');
  checks.push('Accepted uploads matched during appointment review count automatically; incomplete Queue badges and completion controls update with checklist progress');
  assert.ok(await visitor.run(`(()=>{sessionStorage.setItem('ossuniserve_visitor_token','previous-identity');sessionStorage.setItem('visit-token:OLD','private');sessionStorage.setItem('oss_visitor_draft_v1','private draft');const before=loadDB().services.length;clearVisitorIdentity();const db=loadDB();return !sessionStorage.getItem('ossuniserve_visitor_token')&&!sessionStorage.getItem('visit-token:OLD')&&!sessionStorage.getItem('oss_visitor_draft_v1')&&db.services.length===before&&['appointments','queues','transactions','chats','visitorLog'].every(k=>!db[k]?.length)&&myActiveQueueId===null&&currentPublicChatId===null;})()`));
  checks.push('Changing visitor identity clears tokens, drafts, private records and active tracking');
  for(const p of [staff,visitor]){
    assert.ok(await p.run('document.documentElement.scrollWidth<=window.innerWidth+1'));
    assert.deepEqual(p.events.filter(e=>e.method==='Runtime.exceptionThrown').map(e=>e.params.exceptionDetails.text),[]);
  }
  console.log(JSON.stringify({passed:true,checks,apiRequests:requests.length},null,2));
 }finally{for(const p of pages)await p.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
