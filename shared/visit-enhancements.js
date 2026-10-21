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
    const task=a.followUpTask,active=['Requested','Booked'].includes(a.status),canEdit=staff&&a.shared&&a.status!=='Cancelled';
    let html='';
    if(active&&!staff)html+='<div class="visit-extra earlier-opening-card"><div class="earlier-opening-heading"><span class="earlier-opening-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18M8 15h8"/></svg></span><h4>Earlier appointment openings</h4></div><p class="field-hint">'+(a.earlierSlotOptIn?'You are on the waitlist. OSS will confirm if an earlier time is available.':'Want an earlier appointment? Join the waitlist and OSS will review available openings.')+' Your current booking remains until OSS confirms a change.</p><button class="btn btn-ghost btn-sm earlier-opening-action" type="button" data-visit-id="'+esc(a.id)+'" data-enabled="'+(!a.earlierSlotOptIn)+'" onclick="toggleEarlierSlot(this)">'+(a.earlierSlotOptIn?'Leave waitlist':'Join earlier-slot waitlist')+'</button></div>';
    if(task||canEdit)html+='<section class="follow-up-card" aria-label="Follow-up task"><div class="follow-up-heading"><span class="follow-up-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v4H9zm0 10 2 2 4-4"/></svg></span><div class="follow-up-heading-copy"><h4>Follow-up task</h4>'+(!task?'<p>Give the visitor a next step and due date.</p>':'')+'</div>'+(task?'<span class="pill '+(task.completed?'pill-ok':'pill-warn')+'">'+(task.completed?'Completed':'Action needed')+'</span>':'')+'</div>'+(task?'<div class="follow-up-content"><p class="visit-task-text">'+esc(task.text)+'</p><p class="follow-up-due">Due '+esc(task.dueDate)+'</p></div>':'')+(canEdit?'<button type="button" class="btn btn-ghost btn-sm follow-up-action" data-visit-id="'+esc(a.id)+'" onclick="editVisitTask(this.dataset.visitId)">'+(task?'Edit task':'Add task')+'</button>':'')+'</section>';
    if(staff&&(task||canEdit))html=html.replace('<section class="follow-up-card"', '<details class="follow-up-disclosure"><summary><svg class="follow-up-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg><span>Follow-up task</span><span class="schedule-history-count">'+(task?1:0)+'</span></summary><section class="follow-up-card"').replace('</section>','</section></details>');
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
  window.editVisitTask=id=>{
    const a=loadDB().appointments.find(a=>a.id===id);if(!a||a.restricted)return;const task=a.followUpTask||{};
    const actions=['Bring the original documents','Submit missing requirements','Provide a corrected document','Complete and sign the required form','Return for a follow-up consultation','Contact OSS for an update'];
    const selected=actions.includes(task.text)?task.text:(task.text?'Other':'');
    openModal('Follow-up task','<p class="field-hint">Choose what the visitor needs to do next.</p><div class="field"><label for="visitTaskAction">Next action</label><select id="visitTaskAction" onchange="toggleVisitTaskOther()"><option value=""'+(!selected?' selected':'')+' disabled>Select an action</option>'+actions.concat('Other').map(value=>'<option value="'+esc(value)+'"'+(value===selected?' selected':'')+'>'+esc(value)+'</option>').join('')+'</select></div><div class="field" id="visitTaskOther"'+(selected==='Other'?'':' hidden')+'><label for="visitTaskText">Other instructions</label><textarea id="visitTaskText" maxlength="500" rows="2" placeholder="Describe what the visitor needs to do.">'+esc(selected==='Other'?task.text:'')+'</textarea></div><div class="form-row"><div class="field"><label for="visitTaskDue">Due date</label><input type="date" id="visitTaskDue" value="'+esc(task.dueDate||OfficeCalendar.parts().date)+'"></div><div class="field"><label for="visitTaskCompleted">Status</label><select id="visitTaskCompleted"><option value="pending"'+(!task.completed?' selected':'')+'>Pending</option><option value="completed"'+(task.completed?' selected':'')+'>Completed</option></select></div></div>',[
      {label:'Back',cls:'btn-ghost',action:()=>openApptDetail(id)},
      {label:'Save task',cls:'btn-primary',action:async()=>{
        const action=document.getElementById('visitTaskAction').value;
        const text=action==='Other'?document.getElementById('visitTaskText').value.trim():action,dueDate=document.getElementById('visitTaskDue').value,completed=document.getElementById('visitTaskCompleted').value==='completed';
        if(!text||!dueDate){toast('Enter the next action and due date.','err');return;}
        const button=document.getElementById('modalBtn1');if(button)button.disabled=true;
        try{SharedAppointments.cache(await SharedAppointments.request('/appointments/'+encodeURIComponent(id)+'/follow-up-task','PATCH',{text,dueDate,completed,revision:a.revision}));openApptDetail(id);toast('Follow-up task saved.','ok');}catch(e){toast(esc(e.message),'err');if(button)button.disabled=false;}
      }}]);
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
    button.querySelector('.notification-toggle-label').textContent=expanded?'Hide updates':'View updates';
  };
  window.workloadSummaryHtml=(db,attentionHtml='')=>{
    const appointments=(db.appointments||[]).filter(a=>!a.restricted),active=appointments.filter(a=>['Requested','Booked'].includes(a.status));
    const now=Date.now(),today=OfficeCalendar.parts().date;
    const overdue=appointments.filter(a=>a.status!=='Cancelled'&&a.followUpTask&&!a.followUpTask.completed&&a.followUpTask.dueDate<today);
    const reviews=active.reduce((n,a)=>n+(a.attachments||[]).filter(f=>!f.review||f.review.status==='Pending review').length,0);
    const longWait=(db.queues||[]).filter(q=>q.status==='Waiting'&&(!q.scheduledAt||new Date(q.scheduledAt).getTime()<=now)&&(now-new Date(q.queueEnteredAt||q.checkedInAt||q.createdAt).getTime())>=30*60000).length;
    const unfinished=(db.queues||[]).filter(q=>q.status==='Unfinished').length;
    const waitlist=active.filter(a=>a.earlierSlotOptIn).sort((a,b)=>new Date(a.waitlistJoinedAt)-new Date(b.waitlistJoinedAt));
    const openings=(db.appointments||[]).filter(a=>a.status==='Cancelled'&&a.date&&new Date(a.date+'T'+(a.time||'00:00').slice(0,5)+':00+08:00')>new Date());
    const candidateHtml=waitlist.map(a=>{
      const matches=openings.filter(o=>o.serviceKey===a.serviceKey&&(!a.date||o.date+' '+o.time<a.date+' '+a.time)&&OfficeCalendar.at(o.date,(o.time||'').slice(0,5)).open&&(db.appointments||[]).filter(b=>b.id!==a.id&&['Booked','Checked-in'].includes(b.status)&&b.date===o.date&&(b.time||'').slice(0,5)===(o.time||'').slice(0,5)).length<(db.systemSettings?.appointmentSlotCapacity||1));
      return '<div class="kv"><span>'+esc(a.visitId)+' &middot; '+esc(a.service)+(matches.length?' &middot; Opening: '+matches.map(o=>o.date+' '+UniServeUX.timeLabel(o.time)).join(', '):'')+'</span><button type="button" class="btn btn-ghost btn-sm review-schedule-action" data-visit-id="'+esc(a.id)+'" onclick="openApptDetail(this.dataset.visitId,true)">Review schedule</button></div>';
    }).join('');
    const overdueBanner='<details class="waitlist-card overdue-followup-banner"><summary><span class="waitlist-icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3h6v4H9zm3 8v4m0 3h.01"/></svg></span><span class="waitlist-heading"><span class="waitlist-title">Overdue follow-up actions</span><span class="waitlist-subtitle">Visitor tasks that have passed their due date</span></span><span class="waitlist-action">Review follow-ups <span class="dashboard-attention-count">'+overdue.length+'</span><svg class="waitlist-chevron" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12h16m-6-6 6 6-6 6"/></svg></span></summary><div class="waitlist-body">'+(overdue.map(a=>'<div class="kv"><span>'+esc(a.visitId)+' &middot; '+esc(a.followUpTask.dueDate)+'</span><button type="button" class="btn btn-ghost btn-sm review-schedule-action" data-visit-id="'+esc(a.id)+'" onclick="openApptDetail(this.dataset.visitId)">View task</button></div>').join('')||'<p class="field-hint">No overdue follow-up tasks.</p>')+'</div></details>';
    return '<section class="dash-section"><h2 class="dash-h">Staff workload</h2><div class="dashboard-notifications" role="region" aria-labelledby="dashboardNotificationsTitle"><div class="dashboard-notifications-header"><h3 id="dashboardNotificationsTitle">Notifications</h3><button type="button" class="btn btn-ghost btn-sm dashboard-notifications-toggle" aria-expanded="false" aria-controls="dashboardNotificationItems" onclick="toggleDashboardNotifications(this)"><span class="notification-toggle-label">View updates</span><svg class="notification-toggle-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></button></div><div class="dashboard-notifications-items" id="dashboardNotificationItems" hidden>'+attentionHtml+'<details class="waitlist-card"><summary><span class="waitlist-icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-11 4h4m-4 3h2"/></svg></span><span class="waitlist-heading"><span class="waitlist-title">Earlier-slot waitlist</span><span class="waitlist-subtitle">Visitors available for an earlier appointment</span></span><span class="waitlist-action">Review waitlist <span class="dashboard-attention-count">'+waitlist.length+'</span><svg class="waitlist-chevron" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12h16m-6-6 6 6-6 6"/></svg></span></summary><div class="waitlist-body"><p class="field-hint">Oldest requests first. Check cancellations, opening hours and slot capacity before confirming a change.</p>'+(candidateHtml||'<p class="field-hint">No visitors are waiting for an earlier slot.</p>')+'</div></details>'+overdueBanner+'</div></div><div class="stat-grid">'+[['Documents to review',reviews],['Waiting 30+ minutes',longWait],['Unfinished visits',unfinished],['Overdue follow-ups',overdue.length]].map(([label,count])=>'<div class="stat-card"><div class="lbl">'+label+'</div><div class="val">'+count+'</div></div>').join('')+'</div>'+'</section>';
  };
})();
