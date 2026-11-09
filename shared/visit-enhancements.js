/* Visit planning and follow-up, using the shared portal controls. */
(function(){
  const esc=value=>escapeHtml(String(value??''));
  window.serviceNoticeHtml=svc=>svc?.announcement?'<div class="info-banner service-notice" role="note"><div><b>Service notice</b><p>'+esc(svc.announcement)+'</p></div></div>':'';
  window.appointmentJourneyHtml=a=>{
    const events=[['Request received',a.createdAt],...((a.scheduleHistory||[]).map(h=>['Previous schedule updated',h.changedAt])),['Schedule confirmed',a.scheduledConfirmedAt],['Checked in',a.checkedInAt],['Service started',a.servingAt],['Completed',a.completedAt]];
    const entries=events.filter(e=>e[1]).sort((a,b)=>new Date(a[1])-new Date(b[1]));
    return '<details class="visit-journey" open><summary><span class="visit-journey-title">Visit progress</span><span class="visit-journey-status">'+esc(a.status)+'</span><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m6 9 6 6 6-6"/></svg></summary><ol class="visit-journey-list">'+entries.map(([label,ts])=>'<li><span class="visit-journey-dot" aria-hidden="true"></span><div><span class="visit-journey-label">'+esc(label)+'</span><time class="visit-journey-time" datetime="'+esc(ts)+'">'+esc(String(fmtDateTime(ts)).replace(/&middot;/g,'\u00b7'))+'</time></div></li>').join('')+'</ol>'+(!a.scheduledConfirmedAt&&a.status==='Requested'?'<p class="visit-journey-note">Awaiting schedule confirmation.</p>':'')+'</details>';
  };
  window.visitExtrasHtml=(a,staff=false)=>{
    if(!a||a.restricted)return '';
    const tasks=a.followUpTasks||(a.followUpTask?[{id:'legacy',...a.followUpTask}]:[]),task=tasks[tasks.length-1],active=['Requested','Booked'].includes(a.status),canEdit=staff&&a.shared&&a.permissions?.editFollowUp===true&&a.status!=='Cancelled';
    let html='';
    if(a.status==='Requested')html+='<div class="info-banner" role="status"><div><b>'+ (a.needsRescheduling?'Needs rescheduling':'Awaiting staff review')+'</b><p>'+ (a.needsRescheduling?'The requested time passed before confirmation. OSS must arrange a new time; this is not a no-show.':a.reviewDueAt?'Staff review due by '+esc(String(fmtDateTime(a.reviewDueAt)).replace(/&middot;/g,' · '))+'. Wait for confirmation before travelling.':'Wait for staff confirmation before travelling.')+'</p></div></div>';
    if(a.status==='Booked')html+='<p class="field-hint">Check in at the counter from 30 minutes before your appointment. Late arrivals need staff review. Bring your Visit ID and original requirements.</p>';
    if(active&&!staff)html+='<div class="visit-extra earlier-opening-card"><div class="earlier-opening-heading"><span class="earlier-opening-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18M8 15h8"/></svg></span><h4>Earlier appointment openings</h4></div><p class="field-hint">'+(a.earlierSlotOptIn?'You are on the waitlist. OSS will confirm if an earlier time is available.':'Want an earlier appointment? Join the waitlist and OSS will review available openings.')+' Your current booking remains until OSS confirms a change.</p><button class="btn btn-ghost btn-sm earlier-opening-action" type="button" data-visit-id="'+esc(a.id)+'" data-enabled="'+(!a.earlierSlotOptIn)+'" onclick="toggleEarlierSlot(this)">'+(a.earlierSlotOptIn?'Leave waitlist':'Join earlier-slot waitlist')+'</button></div>';
    if(tasks.length||canEdit)html+='<section class="follow-up-card follow-up-tasks" aria-label="Follow-up tasks"><div class="follow-up-heading"><h4>Follow-up tasks</h4>'+(canEdit?'<button type="button" class="btn btn-ghost btn-sm follow-up-action follow-up-add" data-visit-id="'+esc(a.id)+'" onclick="editVisitTask(this.dataset.visitId,null)"><span aria-hidden="true">+</span> Add task</button>':'')+'</div>'+(!tasks.length?'<p class="follow-up-empty">No follow-up tasks yet.</p>':'')+tasks.map(t=>'<div class="follow-up-content"><p class="visit-task-text">'+esc(t.text)+'</p><p class="follow-up-due">Due '+esc(t.dueDate)+(t.ownerName?' &middot; '+esc(t.ownerName):'')+'</p><span class="pill '+(t.completed?'pill-ok':'pill-warn')+'">'+(t.completed?'Completed':t.dueDate<OfficeCalendar.parts().date?'Overdue':'Action needed')+'</span>'+(t.completionNotes?'<p class="field-hint">'+esc(t.completionNotes)+'</p>':'')+(canEdit?'<button type="button" class="btn btn-ghost btn-sm follow-up-action" data-visit-id="'+esc(a.id)+'" data-task-id="'+esc(t.id||'legacy')+'" onclick="editVisitTask(this.dataset.visitId,this.dataset.taskId)">Edit task</button>':'')+(staff&&t.history?.length?'<details><summary>Task history</summary>'+t.history.map(h=>'<article class="task-history-entry"><div class="task-history-meta"><span>'+esc(h.by||'Staff')+'</span><span>'+esc(h.at)+'</span></div><p>'+esc(h.text)+'</p><dl><div><dt>Assigned to</dt><dd>'+esc(h.ownerName||'Unassigned')+'</dd></div><div><dt>Due date</dt><dd>'+esc(h.dueDate||'Not set')+'</dd></div><div><dt>Status</dt><dd>'+(h.completed?'Completed':'Pending')+'</dd></div></dl>'+(h.notes?'<p class="field-hint">'+esc(h.notes)+'</p>':'')+'</article>').join('')+'</details>':'')+'</div>').join('')+'</section>';
    return html;
  };
  window.toggleEarlierSlot=async button=>{
    const id=button.dataset.visitId,a=loadDB().appointments.find(a=>a.id===id);if(!a)return;button.disabled=true;
    try{const result=await SharedAppointments.visitorRequest('/appointments/'+encodeURIComponent(id)+'/waitlist','PATCH',{enabled:button.dataset.enabled==='true',revision:a.revision});if(result){SharedAppointments.cache(result);showPassModalReadonly(result.appointment,true);toast(result.appointment.earlierSlotOptIn?'Added to the earlier-slot waitlist.':'Removed from the waitlist.','ok');}}
    catch(e){toast(esc(e.message),'err');}finally{button.disabled=false;}
  };
  window.toggleVisitTaskOther=()=>{
    const other=document.getElementById('visitTaskAction').value==='Other';
    document.getElementById('visitTaskOther').hidden=!other;
    if(other)document.getElementById('visitTaskText').focus();
  };
  window.editVisitTask=(id,taskId)=>{
    const a=loadDB().appointments.find(a=>a.id===id);if(!a||a.restricted||a.permissions?.editFollowUp!==true)return;const task=taskId===null?{}:taskId?(a.followUpTasks||(a.followUpTask?[{id:'legacy',...a.followUpTask}]:[])).find(t=>t.id===taskId)||{}:a.followUpTask||{};
    const actions=['Bring the original documents','Submit missing requirements','Provide a corrected document','Complete and sign the required form','Return for a follow-up consultation','Contact OSS for an update'];
    const selected=actions.includes(task.text)?task.text:(task.text?'Other':'');
    openModal('Follow-up task','<p class="field-hint">Choose what the visitor needs to do next.</p><div class="field"><label for="visitTaskAction">Next action</label><select id="visitTaskAction" onchange="toggleVisitTaskOther()"><option value=""'+(!selected?' selected':'')+' disabled>Select an action</option>'+actions.concat('Other').map(value=>'<option value="'+esc(value)+'"'+(value===selected?' selected':'')+'>'+esc(value)+'</option>').join('')+'</select></div><div class="field" id="visitTaskOther"'+(selected==='Other'?'':' hidden')+'><label for="visitTaskText">Other instructions</label><textarea id="visitTaskText" maxlength="500" rows="2" placeholder="Describe what the visitor needs to do.">'+esc(selected==='Other'?task.text:'')+'</textarea></div><div class="form-row"><div class="field"><label for="visitTaskDue">Due date</label><input type="date" id="visitTaskDue" value="'+esc(task.dueDate||OfficeCalendar.parts().date)+'"></div><div class="field"><label for="visitTaskCompleted">Status</label><select id="visitTaskCompleted"><option value="pending"'+(!task.completed?' selected':'')+'>Pending</option><option value="completed"'+(task.completed?' selected':'')+'>Completed</option></select></div></div><div class="field"><label for="visitTaskOwner">Responsible Admin</label><select id="visitTaskOwner"><option value="'+esc(task.ownerId||(typeof currentUser!=='undefined'?currentUser.id:''))+'">'+esc(task.ownerName||(typeof currentUser!=='undefined'?currentUser.fullName:'Current Admin'))+'</option></select></div><div class="field"><label for="visitTaskNotes">Completion notes</label><textarea id="visitTaskNotes" maxlength="1000" rows="3">'+esc(task.completionNotes||'')+'</textarea><p class="field-hint">Required when completing a task.</p></div>',[
      {label:'Back',cls:'btn-ghost',action:()=>openApptDetail(id)},
      {label:'Save task',cls:'btn-primary',action:async()=>{
        const action=document.getElementById('visitTaskAction').value;
        const text=action==='Other'?document.getElementById('visitTaskText').value.trim():action,dueDate=document.getElementById('visitTaskDue').value,completed=document.getElementById('visitTaskCompleted').value==='completed';
        if(!text||!dueDate){toast('Enter the next action and due date.','err');return;}
        const button=document.getElementById('modalBtn1');if(button)button.disabled=true;
        try{SharedAppointments.cache(await SharedAppointments.request('/appointments/'+encodeURIComponent(id)+'/follow-up-task','PATCH',{text,dueDate,completed,revision:a.revision,...(task.id?{taskId:task.id}:{}),ownerId:document.getElementById('visitTaskOwner').value,completionNotes:document.getElementById('visitTaskNotes').value}));openApptDetail(id,false,true);toast('Follow-up task saved.','ok');}catch(e){toast(esc(e.message),'err');if(button)button.disabled=false;}
      }}]);
    if(typeof loadVisitOwners==='function')loadVisitOwners('visitTaskOwner',task.ownerId||(typeof currentUser!=='undefined'?currentUser.id:''));
  };
  const nearAlerts=new Set();
  window.notifyNearTurn=(q,ahead)=>{
    const key=q.id+':'+(q.queueEnteredAt||q.checkedInAt||q.createdAt);if(nearAlerts.has(key))return;
    nearAlerts.add(key);window.dispatchEvent(new CustomEvent('uniserve:near-turn',{detail:{id:q.id,ahead}}));
  };
  window.toggleDashboardNotifications=button=>{
    const panel=document.getElementById(button.getAttribute('aria-controls'));
    if(!panel)return;
    const expanded=button.getAttribute('aria-expanded')!=='true';
    panel.hidden=!expanded;
    button.setAttribute('aria-expanded',String(expanded));
    button.setAttribute('aria-label',expanded?'Close notifications':'Open notifications');
  };
  if(typeof document!=='undefined'){
    document.addEventListener('click',event=>{
      const button=document.querySelector('.dashboard-notifications-toggle[aria-expanded="true"]');
      if(button&&!event.target.closest('.dashboard-notifications'))window.toggleDashboardNotifications(button);
    });
    document.addEventListener('keydown',event=>{
      if(event.key!=='Escape')return;
      const button=document.querySelector('.dashboard-notifications-toggle[aria-expanded="true"]');
      if(button){window.toggleDashboardNotifications(button);button.focus();}
    });
  }
  window.workloadSummaryHtml=(db,attentionHtml='')=>{
    const appointments=(db.appointments||[]).filter(a=>!a.restricted),active=appointments.filter(a=>['Requested','Booked'].includes(a.status));
    const now=Date.now(),today=OfficeCalendar.parts().date;
    const overdue=appointments.flatMap(a=>(a.followUpTasks||(a.followUpTask?[a.followUpTask]:[])).filter(t=>a.status!=='Cancelled'&&!t.completed&&t.dueDate<today).map(t=>({...a,followUpTask:t})));
    const reviews=active.reduce((n,a)=>n+(a.attachments||[]).filter(f=>!f.review||f.review.status==='Pending review').length,0);
    const longWait=(db.queues||[]).filter(q=>q.status==='Waiting'&&(!q.scheduledAt||new Date(q.scheduledAt).getTime()<=now)&&(now-new Date(q.queueEnteredAt||q.checkedInAt||q.createdAt).getTime())>=30*60000).length;
    const unfinished=(db.queues||[]).filter(q=>q.status==='Unfinished').length;
    const waitlist=active.filter(a=>a.earlierSlotOptIn).sort((a,b)=>new Date(a.waitlistJoinedAt)-new Date(b.waitlistJoinedAt));
    const openings=(db.appointments||[]).filter(a=>a.status==='Cancelled'&&a.date&&new Date(a.date+'T'+(a.time||'00:00').slice(0,5)+':00+08:00')>new Date());
    const candidateHtml=waitlist.map(a=>{
      const matches=openings.filter(o=>o.serviceKey===a.serviceKey&&(o.office||'Office of Student Services')===(a.office||'Office of Student Services')&&(!a.date||o.date+' '+o.time<a.date+' '+a.time)&&OfficeCalendar.at(o.date,(o.time||'').slice(0,5)).open&&(db.appointments||[]).filter(b=>b.id!==a.id&&['Requested','Booked','Checked-in'].includes(b.status)&&(b.office||'Office of Student Services')===(a.office||'Office of Student Services')&&b.date===o.date&&(b.time||'').slice(0,5)===(o.time||'').slice(0,5)).length<(db.systemSettings?.appointmentSlotCapacity||1));
      return '<div class="kv"><span>'+esc(a.visitId||a.requestReference||a.code)+' &middot; '+esc(a.service)+(matches.length?' &middot; Opening: '+matches.map(o=>o.date+' '+UniServeUX.timeLabel(o.time)).join(', '):'')+'</span><button type="button" class="btn btn-ghost btn-sm review-schedule-action" data-visit-id="'+esc(a.id)+'" onclick="openApptDetail(this.dataset.visitId,true)">Review schedule</button></div>';
    }).join('');
    const overdueBanner='<details class="waitlist-card overdue-followup-banner"><summary><span class="waitlist-icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v4H9zm3 8v4m0 3h.01"/></svg></span><span class="waitlist-heading"><span class="waitlist-title">Overdue follow-up actions</span><span class="waitlist-subtitle">Visitor tasks that have passed their due date</span></span><span class="waitlist-action">Review follow-ups <span class="dashboard-attention-count">'+overdue.length+'</span></span></summary><div class="waitlist-body">'+(overdue.map(a=>'<div class="kv"><span>'+esc(a.visitId||a.requestReference||a.code)+' &middot; '+esc(a.followUpTask.dueDate)+'</span><button type="button" class="btn btn-ghost btn-sm review-schedule-action" data-visit-id="'+esc(a.id)+'" onclick="openApptDetail(this.dataset.visitId)">View task</button></div>').join('')||'<p class="field-hint">No overdue follow-up tasks.</p>')+'</div></details>';
    const html='<section class="dash-section"><h2 class="dash-h">Staff workload</h2><div class="dashboard-notifications" role="region" aria-labelledby="dashboardNotificationsTitle"><div class="dashboard-notifications-header"><button type="button" class="btn btn-ghost btn-sm dashboard-notifications-toggle" aria-label="Open notifications" aria-expanded="false" aria-controls="dashboardNotificationItems" onclick="toggleDashboardNotifications(this)"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span>Notifications</span><span class="notification-bell-count">'+(waitlist.length+overdue.length+(attentionHtml.match(/dashboard-attention-count">(\d+)/g)||[]).reduce((n,item)=>n+Number(item.split('>')[1]),0))+'</span></button></div><div class="dashboard-notifications-items" id="dashboardNotificationItems" hidden><div class="notification-feed-header"><h3 id="dashboardNotificationsTitle">Notifications</h3><span>Updates and actions for your team</span></div>'+attentionHtml+'<details class="waitlist-card"><summary><span class="waitlist-icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-11 4h4m-4 3h2"/></svg></span><span class="waitlist-heading"><span class="waitlist-title">Earlier-slot waitlist</span><span class="waitlist-subtitle">Visitors available for an earlier appointment</span></span><span class="waitlist-action">Review waitlist <span class="dashboard-attention-count">'+waitlist.length+'</span></span></summary><div class="waitlist-body"><p class="field-hint">Oldest requests first. Check cancellations, opening hours and slot capacity before confirming a change.</p>'+(candidateHtml||'<p class="field-hint">No visitors are waiting for an earlier slot.</p>')+'</div></details>'+overdueBanner+'</div></div><div class="stat-grid">'+[['Documents to review',reviews],['Waiting 30+ minutes',longWait],['Unfinished visits',unfinished],['Overdue follow-ups',overdue.length]].map(([label,count])=>'<div class="stat-card"><div class="lbl">'+label+'</div><div class="val">'+count+'</div></div>').join('')+'</div>'+'</section>';
    const host=typeof document!=='undefined'&&document.getElementById('sidebarNotifications');
    if(!host)return html;
    const start=html.indexOf('<div class="dashboard-notifications"');
    const end=html.indexOf('<div class="stat-grid">',start);
    host.innerHTML=html.slice(start,end);
    const trigger=host.querySelector('.dashboard-notifications-toggle');
    trigger.setAttribute('onclick',"navigate('notifications')");
    trigger.setAttribute('aria-label','Notifications');
    trigger.removeAttribute('aria-expanded');
    trigger.removeAttribute('aria-controls');
    if(typeof state_view!=='undefined'&&state_view==='notifications')trigger.classList.add('active');
    if(typeof window.refreshSidebarNotificationCount==='function')window.refreshSidebarNotificationCount();
    return html.slice(0,start)+html.slice(end);
  };
})();

/* Additional visit actions use the portal's existing modal, field and ticket styles. */
(function(){
  const esc=value=>escapeHtml(String(value??''));
  window.openDocumentHistory=async function(id){
    try{
      const result=await SharedAppointments.request('/appointments/'+encodeURIComponent(id)+'/document-history');
      const files=Object.values(result.versions||{}).flat();
      openModal('Previous document versions',files.length?'<div class="document-version-list">'+files.map(f=>'<article class="document-version-item">'+attachChip(f)+'<dl><div><dt>Review status</dt><dd>'+esc(f.review?.status||'Not reviewed')+'</dd></div><div><dt>Replaced</dt><dd>'+esc(f.replacedAt||'Not recorded')+'</dd></div></dl></article>').join('')+'</div>':'<p class="field-hint">No documents have been replaced.</p>',[{label:'Back',cls:'btn-ghost',action:()=>reviewAppointmentRequirements(id)}]);
    }catch(e){toast(esc(e.message),'err');}
  };
  window.loadVisitOwners=async function(id,selected){
    if(typeof document==='undefined')return;
    const control=document.getElementById(id);if(!control)return;
    try{
      const result=await SharedAppointments.request('/task-owners');
      if(document.getElementById(id)!==control)return;
      control.innerHTML=result.owners.map(owner=>'<option value="'+esc(owner.id)+'"'+(owner.id===selected?' selected':'')+'>'+esc(owner.full_name)+'</option>').join('');
      if(selected&&result.owners.some(o=>o.id===selected))control.value=selected;
    }catch(e){toast(esc(e.message),'err');}
  };
  window.caseWorkflowHtml=function(record,editable){
    const history=(record.caseHistory||[]).map(h=>'<div class="kv"><span>'+esc(h.by)+' &middot; '+esc(h.at)+'</span><span>'+esc(h.to)+' &middot; '+esc(h.ownerName)+' &middot; '+esc(h.dueDate)+'<br>'+esc(h.nextAction)+'<br>'+esc(h.notes)+'</span></div>').join('');
    const fields=editable?'<div class="form-row"><div class="field"><label for="caseOwner">Responsible Admin</label><select id="caseOwner"><option value="'+esc(record.caseOwnerId||currentUser.id)+'">'+esc(record.caseOwnerName||currentUser.fullName)+'</option></select></div><div class="field"><label for="caseDue">Next action due</label><input id="caseDue" type="date" value="'+esc(record.caseDueDate||OfficeCalendar.parts().date)+'"></div></div><div class="field"><label for="caseAction">Next action</label><textarea id="caseAction" rows="2" maxlength="500">'+esc(record.caseNextAction||'')+'</textarea></div><div class="field"><label for="caseNotes">Resolution or reopening notes</label><textarea id="caseNotes" rows="3" maxlength="2000">'+esc(record.caseNotes||'')+'</textarea><p class="field-hint">Required when resolving or reopening a case. Confidential ownership changes require Head Admin assignment and access.</p></div>':record.caseOwnerName?'<div class="kv"><span>Responsible Admin</span><span>'+esc(record.caseOwnerName)+'</span></div><p class="field-hint">'+esc(record.caseNextAction)+' &middot; Due '+esc(record.caseDueDate)+'</p>':'';
    return fields||history?'<section class="case-followup-section"><h4>Case follow-up</h4>'+fields+(history?'<details class="schedule-history"><summary>Case activity</summary>'+history+'</details>':'')+'</section>':'';
  };
  window.updateAssistedVisitorType=function(){
    const student=document.getElementById('assistedType').value==='Student';
    document.getElementById('assistedStudentField').hidden=!student;
    document.getElementById('assistedGuestField').hidden=student;
    if(student)document.getElementById('assistedSenior').checked=false;
  };
  window.formatAssistedContact=function(input){
    if(typeof formatContactInput==='function'){formatContactInput(input);return;}
    const before=input.value,cursor=input.selectionStart;
    let digits=before.replace(/\D/g,'');
    if(digits.startsWith('63'))digits=digits.slice(2);
    digits=digits.replace(/^0+/,'').slice(0,10);
    const formatted='+63'+(digits?' '+[digits.slice(0,3),digits.slice(3,6),digits.slice(6)].filter(Boolean).join(' '):'');
    if(before===formatted)return;
    input.value=formatted;
    if(cursor!=null&&cursor<before.length){
      const prefix=before.replace(/\D/g,'');
      const target=Math.max(2,before.slice(0,cursor).replace(/\D/g,'').length+(prefix.startsWith('63')?0:prefix.startsWith('0')?1:2));
      let position=0,count=0;
      while(position<formatted.length&&count<target){if(/\d/.test(formatted[position]))count++;position++;}
      try{input.setSelectionRange(position,position);}catch{}
    }
  };
  window.maskAssistedStudentNumber=function(input){
    const digits=input.value.replace(/\D/g,'').slice(0,10);
    input.value=digits.slice(0,4)+(digits.length>4?'-'+digits.slice(4,9):'')+(digits.length>9?'-SM-'+digits.slice(9):'');
  };
  window.toggleAssistedIdentityOther=function(){
    const other=document.getElementById('assistedIdentity').value==='Other';
    document.getElementById('assistedIdentityOtherField').hidden=!other;
    const input=document.getElementById('assistedIdentityOther');input.required=other;
    if(other)input.focus();
  };
  window.openAssistedIntake=function(){
    const services=(loadDB().services||[]).filter(s=>!s.disabled);
    const required='<span class="req" aria-hidden="true">*</span>';
    const idTypes=["Driver's License",'Passport','UMID','PhilID (National ID)','Senior Citizen ID','PWD ID',"Voter's ID",'PhilHealth ID','Other Government-Issued ID'];
    const form='<div class="assisted-intake-form">'+
      '<p class="assisted-intake-intro">Enter the visitor details, then verify their identity at the counter. Fields marked * are required.</p>'+
      '<div class="field"><label for="assistedType">Visitor type '+required+'</label><select id="assistedType" onchange="updateAssistedVisitorType()"><option>Student</option><option>Guest</option></select></div>'+
      '<div class="field"><label for="assistedService">Service</label><select id="assistedService">'+services.map(s=>'<option value="'+esc(s.key)+'">'+esc(s.label)+'</option>').join('')+'</select></div>'+
      '<fieldset class="assisted-form-section"><legend>Personal details</legend><div class="form-row"><div class="field"><label for="assistedFirst">First name '+required+'</label><input id="assistedFirst" maxlength="75" autocomplete="given-name" placeholder="Juan" required></div><div class="field"><label for="assistedLast">Last name '+required+'</label><input id="assistedLast" maxlength="74" autocomplete="family-name" placeholder="Dela Cruz" required></div></div>'+
      '<div class="field" id="assistedStudentField"><label for="assistedStudentNumber">Student number <span class="opt">(if available)</span></label><input id="assistedStudentNumber" inputmode="numeric" maxlength="15" autocomplete="off" placeholder="0000-00000-SM-0" oninput="maskAssistedStudentNumber(this)"></div>'+
      '<div class="field" id="assistedGuestField" hidden><label for="assistedIdType">Valid ID type <span class="opt">(if available)</span></label><select id="assistedIdType"><option value="">Select ID type</option>'+idTypes.map(t=>'<option value="'+esc(t)+'">'+esc(t)+'</option>').join('')+'</select></div></fieldset>'+
      '<fieldset class="assisted-priority"><legend>Priority assistance <span>(optional)</span></legend><div class="assisted-priority-options"><label for="assistedSenior"><input id="assistedSenior" type="checkbox"> Senior citizen</label><label for="assistedPWD"><input id="assistedPWD" type="checkbox"> Person with disability</label></div></fieldset>'+
      '<fieldset class="assisted-form-section"><legend>Contact details</legend><div class="field"><label for="assistedContact">Contact number '+required+'</label><div class="ph-phone-input"><span class="ph-phone-prefix" title="Philippines (+63)"><span class="ph-phone-flag" aria-hidden="true"><svg viewBox="0 0 30 20" width="24" height="16"><path fill="#0038a8" d="M0 0h30v10H0z"/><path fill="#ce1126" d="M0 10h30v10H0z"/><path fill="#fff" d="M0 0l17 10L0 20z"/><g fill="#fcd116"><circle cx="5.5" cy="10" r="2.2"/><path d="M5 6h1v8H5zM1.5 9.5h8v1h-8zM2.3 7.3l.7-.7 5.7 5.7-.7.7zM2.3 12.7L8 7l.7.7L3 13.4z"/><circle cx="2.4" cy="3.2" r=".8"/><circle cx="2.4" cy="16.8" r=".8"/><circle cx="13" cy="10" r=".8"/></g></svg></span></span><input id="assistedContact" type="tel" inputmode="tel" autocomplete="tel" maxlength="17" placeholder="+63 917 123 4567" aria-label="Philippine mobile number, country code +63" onfocus="if(!this.value)this.value=\'+63\'" oninput="formatAssistedContact(this)" required></div></div><div class="field"><label for="assistedEmail">Email address <span class="opt">(optional)</span></label><input id="assistedEmail" type="email" autocomplete="email" placeholder="juan.delacruz@gmail.com"></div></fieldset>'+
      '<fieldset class="assisted-form-section"><legend>Staff verification</legend><div class="field"><label for="assistedIdentity">Identity verification '+required+'</label><select id="assistedIdentity" onchange="toggleAssistedIdentityOther()" aria-describedby="assistedIdentityHint" required><option value="" disabled selected>Select verification method</option>'+['Student ID checked at the counter','Government ID checked at the counter','Identity confirmed against school records','Identity confirmed by authorized school staff','Other'].map(method=>'<option value="'+esc(method)+'">'+esc(method)+'</option>').join('')+'</select><p class="field-hint" id="assistedIdentityHint">Select how identity was verified. Avoid copying personal ID details.</p></div><div class="field" id="assistedIdentityOtherField" hidden><label for="assistedIdentityOther">Other verification method '+required+'</label><textarea id="assistedIdentityOther" maxlength="500" minlength="5" rows="2" placeholder="Explain how identity was confirmed"></textarea></div></fieldset>'+
      '<p class="assisted-intake-note">No email? Print the ticket and direct the visitor to the OSS counter for updates or access recovery.</p></div>';
    openModal('Assisted walk-in',form,[
      {label:'Cancel',cls:'btn-ghost',action:closeModal},
      {label:'Issue ticket',cls:'btn-primary',action:async()=>{
        const button=document.getElementById('modalBtn1');if(button)button.disabled=true;
        const value=id=>document.getElementById(id).value.trim();
        try{
          const service=services.find(s=>s.key===value('assistedService'));
          if(!service)throw Error('Choose a service.');
          for(const id of ['assistedFirst','assistedLast','assistedContact','assistedEmail','assistedIdentity']){const input=document.getElementById(id);if(!input.reportValidity()){if(button)button.disabled=false;return;}}
          const first=value('assistedFirst'),last=value('assistedLast'),student=value('assistedType')==='Student',idNumber=student?value('assistedStudentNumber'):'';
          const identityOther=document.getElementById('assistedIdentityOther');
          if(value('assistedIdentity')==='Other'&&!identityOther.reportValidity()){if(button)button.disabled=false;return;}
          const identityCheck=value('assistedIdentity')==='Other'?identityOther.value.trim():value('assistedIdentity');
          if(identityCheck.length<5)throw Error('Explain how identity was confirmed.');
          if(first.length<2||last.length<2)throw Error('Enter the first and last name.');
          if(idNumber&&!/^\d{4}-\d{5}-SM-\d$/.test(idNumber))throw Error('Use student number format 0000-00000-SM-0.');
          const result=await SharedAppointments.request('/visits','POST',{assisted:true,visitorType:value('assistedType'),name:[first,last].join(' '),idNumber,idType:student?'':value('assistedIdType'),serviceKey:service.key,serviceLabel:service.label,contact:value('assistedContact'),email:value('assistedEmail')||null,identityCheck,isSenior:document.getElementById('assistedSenior').checked,isPWD:document.getElementById('assistedPWD').checked});
          SharedAppointments.cache(result);const q=result.queue;
          // The ticket contains a reference, never an authentication token or identity-check notes.
          const ticket='<section class="issued-walkin-ticket"><div class="issued-ticket-heading"><p class="issued-ticket-label">OSS walk-in ticket</p><span class="issued-ticket-status">Issued</span></div><div class="issued-ticket-number">'+esc(q.number)+'</div><p class="issued-ticket-caption">Your queue number</p><dl class="issued-ticket-details"><div><dt>Visit ID</dt><dd class="issued-ticket-id">'+esc(q.visitId)+'</dd></div><div><dt>Service</dt><dd>'+esc(q.serviceLabel)+'</dd></div></dl><p class="issued-ticket-note">Wait for your number to be called. Contact the OSS counter for updates or recovery; staff will check your identity.</p></section>';
          openModal('Walk-in ticket issued',ticket,[{label:'Done',cls:'btn-ghost',action:()=>{closeModal();renderQueueDashboard();}},{label:'Print ticket',cls:'btn-primary',action:()=>printInjected(ticket)}]);
          toast('Assisted walk-in added to the queue.','ok');
        }catch(e){toast(esc(e.message),'err');if(button)button.disabled=false;}
      }}]);
  };
})();
