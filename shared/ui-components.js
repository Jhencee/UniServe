(function(root) {
  'use strict';
  const API=(globalThis.UniServeConfig?.apiBase||'http://127.0.0.1:8000/api');
  const esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  root.reasonSelectHtml=function(id,options,max=500){
    return `<div class="field"><label for="${id}">Reason</label><select id="${id}" onchange="toggleReasonOther(this)"><option value="">Select a reason</option>${options.map(option=>`<option>${esc(option)}</option>`).join('')}<option>Other</option></select></div><div class="field" id="${id}OtherField" hidden><label for="${id}Other">Other reason</label><textarea id="${id}Other" minlength="5" maxlength="${max}" placeholder="Please specify the reason."></textarea></div>`;
  };
  root.toggleReasonOther=function(select){const field=document.getElementById(select.id+'OtherField');field.hidden=select.value!=='Other';if(!field.hidden)field.querySelector('textarea').focus();};
  root.readSelectedReason=function(id){
    const choice=document.getElementById(id).value;
    if(!choice)throw Error('Select a reason.');
    if(choice!=='Other')return choice;
    const text=document.getElementById(id+'Other').value.trim();
    if(text.length<5)throw Error('Explain the other reason with at least 5 characters.');
    return text;
  };
  root.flowServiceHistory=function(history){
    if(!history?.length)return '';
    const date=value=>{const d=value?new Date(value):null;return !d||Number.isNaN(d.getTime())?'Not recorded':d.toLocaleString('en-US',{timeZone:'Asia/Manila',month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'});};
    return '<section class="card card-pad flow-history"><h3>Service history</h3>'+history.map(step=>`<article class="flow-history-item"><div class="flow-history-heading"><h4>${esc(step.serviceLabel)}</h4><span class="flow-history-status">${esc(step.outcome)}</span></div>${step.adminName?'<p class="flow-history-staff">Handled by '+esc(step.adminName)+'</p>':''}<div class="flow-history-dates"><span><b>Started</b> ${esc(step.servingAt||step.calledAt?date(step.servingAt||step.calledAt):'Not started')}</span><span><b>Ended</b> ${esc(date(step.endedAt))}</span></div></article>`).join('')+'</section>';
  };
  const session=()=>{try{return JSON.parse(sessionStorage.getItem('ossuniserve_session')||'{}');}catch(_){return {};}};
  async function request(path,method='GET',body) {
    const response=await fetch(API+path,{method,headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+(session().token||'')},...(body?{body:JSON.stringify(body)}:{})});
    const result=await response.json(); if(!response.ok){const error=Error(Object.values(result.errors||{}).flat().join(' ')||result.message||'Please try again.');error.status=response.status;throw error;} return result;
  }
  function appointmentTime(value) {
    const m=/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(value||''); if(!m)return null;
    let h=Number(m[1]); if(m[3])h=h%12+(/PM/i.test(m[3])?12:0);return String(h).padStart(2,'0')+':'+m[2];
  }
  function timeLabel(value) {
    const time=appointmentTime(value);if(!time)return value||'';
    const [hour,minute]=time.split(':');const h=Number(hour);
    return `${h%12||12}:${minute} ${h>=12?'PM':'AM'}`;
  }
  function conflict(appt) {
    if(!appt.date || ['Cancelled','No-show','Completed','Checked-in','Unfinished'].includes(appt.status))return '';
    const time=appointmentTime(appt.time);if(!time)return '';
    const availability=OfficeCalendar.at(appt.date,time);
    return availability.open?'':availability.reason;
  }
  let preferredTarget='', month='';
  async function visitorCalendar(target) {
    preferredTarget=target||''; month=OfficeCalendar.parts().date.slice(0,7);
    if(!await OfficeCalendar.refresh()) {root.toast('Cannot load the office calendar. Please try again.','err');return;}
    paintVisitorCalendar();
  }
  function paintVisitorCalendar() {
    const cfg=OfficeCalendar.get(),today=OfficeCalendar.parts().date,first=new Date(month+'-01T12:00:00Z');
    const count=new Date(first.getUTCFullYear(),first.getUTCMonth()+1,0).getDate();
    const body=`<div class="ux-calendar-toolbar"><button class="btn btn-ghost btn-sm" aria-label="Previous month" onclick="UniServeUX.calendarMove(-1)">&lsaquo;</button><h3>${first.toLocaleDateString('en-PH',{month:'long',year:'numeric',timeZone:'UTC'})}</h3><button class="btn btn-ghost btn-sm" aria-label="Next month" onclick="UniServeUX.calendarMove(1)">&rsaquo;</button></div>
      <div class="ux-calendar-legend"><span class="open">Open</span><span class="closed">Closed</span><span class="holiday">Holiday</span><span class="special">Special hours</span></div>
      <p class="ux-calendar-note">Office schedule${cfg.lunch.enabled?' &middot; Lunch '+esc(OfficeCalendar.clock(cfg.lunch.start))+' &ndash; '+esc(OfficeCalendar.clock(cfg.lunch.end)):''}</p><div class="ux-calendar-grid">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(n=>`<span>${n}</span>`).join('')}${'<span></span>'.repeat(first.getUTCDay())}${Array.from({length:count},(_,i)=>{
        const date=month+'-'+String(i+1).padStart(2,'0'),day=OfficeCalendar.day(date,cfg),ranges=OfficeCalendar.intervals(date,cfg);
        const available=date>=today && ranges.length>0;
        const name=day.name||(!day.open?'Closed':day.type==='special'?'Special hours':'Open');
        const type=day.type==='holiday'?'holiday':!day.open?'closed':day.type==='special'?'special':'open';
        return `<button class="ux-calendar-day ${type} ${date<today?'past':''} ${date===today?'today':''}" ${available?'':'disabled'} title="${esc(name)}${date<today?' (past date)':''}" aria-label="${date}, ${esc(name)}" ${date===today?'aria-current="date"':''} onclick="UniServeUX.calendarSelect('${date}')"><span class="ux-calendar-number">${i+1}</span><small>${esc(day.name||(day.type==='holiday'?'Holiday':!day.open?'Closed':day.type==='special'?'Special hours':''))}</small><span class="ux-calendar-dot" aria-hidden="true"></span></button>`;
      }).join('')}</div><p class="ux-calendar-note" id="visitorCalendarDetails" role="status">Select an open date to see its hours.${preferredTarget?' This is a preferred date; OSS confirms your appointment.':''}</p>`;
    root.openModal('Office calendar',body,[]);
    document.querySelector('#activeModal .modal')?.classList.add('office-calendar-modal');
  }
  function calendarMove(delta) {const date=new Date(month+'-01T12:00:00Z');date.setUTCMonth(date.getUTCMonth()+delta);month=date.toISOString().slice(0,7);paintVisitorCalendar();}
  function calendarSelect(date) {
    const ranges=OfficeCalendar.intervals(date);if(!ranges.length)return;
    const label=ranges.map(([a,b])=>OfficeCalendar.clock(a)+' – '+OfficeCalendar.clock(b)).join(' and ');
    const readableDate=new Date(date+'T12:00:00Z').toLocaleDateString('en-PH',{weekday:'long',month:'long',day:'numeric',year:'numeric',timeZone:'Asia/Manila'});
    const note=document.getElementById('visitorCalendarDetails');
    note.textContent=readableDate+' · Open '+label+'.';
    if(preferredTarget){const input=document.getElementById(preferredTarget);if(input){input.value=date;root.closeModal();}}
  }
  async function queueNotification(appt,kind='confirmation') {
    if(!appt.email){root.toast('No email is available for this visit.','err');return;}
    const time=appointmentTime(appt.time);
    if(!appt.date||!time){root.toast('Assign a date and time before sending the pass.','err');return;}
    try {
      const result=await request('/notifications','POST',{visitId:appt.visitId||appt.code,email:appt.email,name:appt.name,service:appt.service,date:appt.date,time,kind});
      if(result.cancelToken){const db=root.loadDB(),record=db.appointments.find(a=>a.id===appt.id);if(record){record.notificationCancelToken=result.cancelToken;root.saveDB(db);}}
      root.toast(result.mailConfigured?'Email queued. A reminder will be sent one day before the appointment.':'Email saved as pending. Configure Gmail credentials and run the notification scheduler to deliver it.',result.mailConfigured?'ok':'err');
    }catch(error){root.toast(esc(error.message),'err');}
  }
  async function notificationStatus(appt) {
    try {
      const result=await request('/notifications?visitId='+encodeURIComponent(appt.visitId||appt.code));
      root.openModal('Email delivery details',result.notifications.length?result.notifications.map(n=>`<div class="kv"><span>${esc(n.kind)}</span><span>${esc(String(n.status).toLowerCase()==='superseded'?'Replaced':n.status)}${n.sent_at?' · '+esc(n.sent_at):''}</span></div>`).join(''):'<p>Confirmation emails are queued automatically when the schedule is saved. No email records were found for this visit.</p>',appt.status==='Booked'&&(result.notifications.some(n=>n.status==='failed')||!result.notifications.length)?[{label:'Resend email',cls:'resend-text',action:()=>queueNotification(appt,result.notifications.some(n=>n.kind==='rescheduled')?'rescheduled':'confirmation')}]:[]);
    }catch(error){root.toast(esc(error.message),'err');}
  }
  const auditKey='ossuniserve_pending_audit_v1';let syncing=false;
  function auditRecord(entry) {
    if(!['ADMIN','SUPER_ADMIN','SYSTEM'].includes(entry.role))return;
    if(!session().token||!['Appointments','Transactions','Settings','Confidential','Data','System','Authentication','Accounts','Queue','Messages','Feedback'].includes(entry.category))return;
    // Data changes are audited by the backend; keep browser-only export/print/session actions.
    if(!/print|download|export|session timed out|locked|relocked/i.test(entry.action))return;
    try{
      const records=JSON.parse(localStorage.getItem(auditKey)||'[]');
      records.push({actor:session().currentUser?.id,id:root.crypto?.randomUUID?.() || Date.now()+'-'+Math.random().toString(16).slice(2),category:entry.category,action:String(entry.action).replace(/<[^>]*>/g,'').slice(0,1000),target:entry.target||null,changes:(entry.changes||[]).map(c=>({field:String(c.field),from:String(c.from??''),to:String(c.to??'')}))});
      localStorage.setItem(auditKey,JSON.stringify(records));syncAudit();
    }catch(_){/* Existing local audit remains available if storage is full. */}
  }
  async function syncAudit() {
    if(syncing||!session().token)return;syncing=true;
    try{
      const items=JSON.parse(localStorage.getItem(auditKey)||'[]');
      for(const item of items.filter(i=>i.actor===session().currentUser?.id)){
        const {actor,...payload}=item;await request('/audit','POST',payload);
        const latest=JSON.parse(localStorage.getItem(auditKey)||'[]');localStorage.setItem(auditKey,JSON.stringify(latest.filter(i=>!(i.id===item.id&&i.actor===actor))));
      }
    }catch(_){/* Retry after connectivity returns; no audit entry is discarded. */}finally{syncing=false;}
  }
  function metrics(db,now=new Date()) {
    const start=now.getTime()-30*86400000, queues=(db.queues||[]).filter(q=>new Date(q.createdAt).getTime()>=start),appointments=(db.appointments||[]).filter(a=>new Date(a.date?a.date+'T12:00:00+08:00':a.createdAt).getTime()>=start);
    const waits=[],durations=[],hours=Array(24).fill(0);
    for(const q of queues){
      if(q.servingAt){const wait=(new Date(q.servingAt)-new Date(q.checkedInAt||q.createdAt))/60000;if(Number.isFinite(wait)&&wait>=0)waits.push(wait);}
      if(q.completedAt&&q.servingAt){const duration=(new Date(q.completedAt)-new Date(q.servingAt))/60000;if(Number.isFinite(duration)&&duration>=0)durations.push(duration);}
      const time=new Date(q.checkedInAt||q.createdAt);if(!Number.isNaN(+time))hours[Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Manila',hour:'2-digit',hourCycle:'h23'}).format(time))]++;
    }
    const average=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
    return {waiting:average(waits),service:average(durations),waitSamples:waits.length,serviceSamples:durations.length,noShows:appointments.filter(a=>a.status==='No-show').length,total:queues.length,hours};
  }
  function durationLabel(minutes){if(minutes===null||minutes===undefined||!Number.isFinite(Number(minutes)))return '?';const total=Math.max(0,Math.round(Number(minutes))),hours=Math.floor(total/60),mins=total%60;return hours?hours+'h'+(mins?' '+mins+'m':''):total+'m';}
  function reportHtml(db) {
    const m=metrics(db),max=Math.max(...m.hours,1);
    return `<div class="card ux-report"><div class="card-head"><div><h3>Queue &amp; appointment performance</h3><div class="desc">Last 30 days &middot; Queue and appointment summary</div></div><button class="btn btn-ghost btn-sm" onclick="UniServeUX.exportMetrics()">Download CSV</button></div><div class="card-pad"><div class="stat-grid"><div class="stat-card"><div class="lbl">Average waiting</div><div class="val">${m.waiting===null?'—':durationLabel(m.waiting)}</div><div class="field-hint">${m.waitSamples} timed visits</div></div><div class="stat-card"><div class="lbl">Average service</div><div class="val">${m.service===null?'—':durationLabel(m.service)}</div><div class="field-hint">${m.serviceSamples} completed visits</div></div><div class="stat-card"><div class="lbl">Missed appointments</div><div class="val">${m.noShows}</div></div></div><h3>Arrivals by hour</h3><div class="ux-hour-bars">${m.hours.some(Boolean)?m.hours.map((count,h)=>count?`<div class="ux-hour-row"><span>${OfficeCalendar.clock(String(h).padStart(2,'0')+':00')}</span><div class="ux-hour-track"><div class="ux-hour-fill" style="width:${Math.round(count/max*100)}%"></div></div><span>${count}</span></div>`:'').join(''):'<p class="field-hint">No arrivals recorded in the last 30 days.</p>'}</div></div></div>`;
  }
  function exportMetrics() {
    const m=metrics(root.loadDB()),rows=[['Metric','Value'],['Average waiting minutes',m.waiting??''],['Average service minutes',m.service??''],['Missed appointments',m.noShows],['Arrival hour','Visits'],...m.hours.map((n,h)=>[h,n])];
    const url=URL.createObjectURL(new Blob([rows.map(r=>r.join(',')).join('\r\n')],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download='uniserve-performance-'+OfficeCalendar.parts().date+'.csv';a.click();URL.revokeObjectURL(url);
  }
  let pendingConfirmation=null, previousOverflow='', modalReturnFocus=null;
  const inertBackground=new Map();
  function closeUnifiedModal() {
    const modal=document.getElementById('activeModal');if(modal){modal.remove();document.body.style.overflow=previousOverflow;}
    for(const [element,wasInert] of inertBackground)element.inert=wasInert;inertBackground.clear();
    if(modalReturnFocus?.isConnected)modalReturnFocus.focus();modalReturnFocus=null;
    if(pendingConfirmation){const resolve=pendingConfirmation;pendingConfirmation=null;resolve(false);}
  }
  function unifiedModal(title,body,buttons=[]) {
    buttons=buttons.filter(button=>!(/^close$/i.test(String(button.label).trim())&&(button.action===root.closeModal||button.action===closeUnifiedModal)));
    closeUnifiedModal();modalReturnFocus=document.activeElement;previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';
    const visibleButtons=buttons.map((button,index)=>({button,index})).filter(({button})=>!/^back(?:\s|$)/i.test(String(button.label).trim()));
    const overlay=document.createElement('div');overlay.className='overlay';overlay.id='activeModal';
    overlay.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-labelledby="activeModalTitle" tabindex="-1"><div class="modal-head"><h3 id="activeModalTitle">${title}</h3><button class="close-x" id="modalCloseX" aria-label="Close dialog">${root.icon('x',18)}</button></div><div class="modal-body">${body}</div>${visibleButtons.length?`<div class="modal-foot">${visibleButtons.map(({button:b,index:i})=>`<button class="btn ${b.cls||'btn-ghost'} btn-sm" id="modalBtn${i}" data-modal-action="${i}">${b.label}</button>`).join('')}</div>`:''}</div>`;
    document.body.appendChild(overlay);
    for(const element of document.body.children){if(element===overlay||['SCRIPT','STYLE','LINK'].includes(element.tagName)||element.hasAttribute('aria-live')||element.id==='toastContainer')continue;inertBackground.set(element,element.inert);element.inert=true;}
    const dismiss=()=>{if(overlay.dataset.busy!=='true')closeUnifiedModal();};
    overlay.querySelector('.close-x').onclick=dismiss;overlay.onclick=e=>{if(e.target===overlay)dismiss();};
    visibleButtons.forEach(({button,index:i})=>{overlay.querySelector(`[data-modal-action="${i}"]`).onclick=async()=>{
      if(overlay.dataset.busy==='true')return;overlay.dataset.busy='true';
      const controls=[...overlay.querySelectorAll('.modal-foot button,.close-x')];controls.forEach(b=>b.disabled=true);
      try{await button.action();}catch(error){unifiedToast(esc(error.message||'Could not complete this action. Please try again.'),'err');}
      finally{overlay.dataset.busy='false';controls.forEach(b=>b.disabled=false);}
    };});
    (overlay.querySelector('input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')||overlay.querySelector('.modal-foot button')||overlay.querySelector('.modal')).focus();
  }
  function unifiedToast(message,type='ok') {
    let host=document.getElementById('toastWrap');if(!host){host=document.createElement('div');host.id='toastWrap';host.className='toast-wrap';document.body.appendChild(host);}
    const el=document.createElement('div');el.className='toast '+type;el.setAttribute('role',type==='err'?'alert':'status');
    el.innerHTML=`<span class="toast-ic">${root.icon(type==='err'?'x':'check',15)}</span><span class="toast-msg">${message}</span><button class="toast-close" type="button" aria-label="Dismiss notification">${root.icon('x',12)}</button>`;
    el.querySelector('button').onclick=()=>el.remove();host.appendChild(el);setTimeout(()=>el.remove(),type==='err'?7000:4000);
  }
  function confirmDialog(title,message,label='Confirm') {
    return new Promise(resolve=>{unifiedModal(esc(title),`<p>${esc(message)}</p>`,[{label:'Cancel',cls:'btn-ghost',action:()=>closeUnifiedModal()},{label,cls:'btn-danger-o',action:()=>{pendingConfirmation=null;closeUnifiedModal();resolve(true);}}]);pendingConfirmation=resolve;});
  }
  function previousDay(q,now=new Date()) {
    if(!['Waiting','Called','Skipped'].includes(q.status))return false;
    const stamp=new Date(q.checkedInAt||q.createdAt);return !Number.isNaN(+stamp)&&OfficeCalendar.parts(stamp).date<OfficeCalendar.parts(now).date;
  }
  function statusBadge(status){
    const colors={Pending:'warn',Requested:'warn',Waiting:'warn',Unfinished:'warn','Under Review':'warn',Processing:'info',Serving:'info',Booked:'info',Scheduled:'info',Open:'info',Approved:'ok',Completed:'ok',Resolved:'ok',Called:'gold','Checked-in':'gold',Rejected:'danger',Cancelled:'danger','No-show':'danger',Skipped:'danger',Closed:'danger',Denied:'danger',Revoked:'danger',Expired:'danger'};
    return `<span class="pill pill-${colors[status]||'info'}">${esc(status)}</span>`;
  }
  function install() {root.openModal=unifiedModal;root.closeModal=closeUnifiedModal;root.toast=unifiedToast;root.statusPill=statusBadge;}
  root.UniServeUX={appointmentTime,timeLabel,conflict,visitorCalendar,calendarMove,calendarSelect,queueNotification,notificationStatus,auditRecord,syncAudit,metrics,reportHtml,exportMetrics,request,escape:esc,confirm:confirmDialog,previousDay,install};
  if(typeof document!=='undefined') {
    let focusedBeforeModal=null,currentModal=null;
    document.addEventListener('click',()=>{if(!document.getElementById('activeModal'))focusedBeforeModal=document.activeElement;},true);
    document.addEventListener('click',event=>{const details=event.target.closest('.ux-secondary-actions');if(details&&event.target.closest('button'))details.open=false;},true);
    const observer=new MutationObserver(()=>{
      const modal=document.getElementById('activeModal');
      if(modal && modal!==currentModal){currentModal=modal;const title=modal.querySelector('.modal-head h3'),dialog=modal.querySelector('.modal');if(title&&dialog){title.id='activeModalTitle';dialog.setAttribute('aria-labelledby',title.id);} }
      if(!modal&&currentModal){currentModal=null;if(focusedBeforeModal?.isConnected)focusedBeforeModal.focus();}
      document.querySelectorAll('.field').forEach(field=>{const label=field.querySelector('label'),input=field.querySelector('input[id],select[id],textarea[id]');if(label&&input&&!label.htmlFor)label.htmlFor=input.id;});
    });
    observer.observe(document.documentElement,{childList:true,subtree:true});
    // Supply Enter submission for controls built outside native forms.
    document.addEventListener('keydown',event=>{
      if(event.key!=='Enter'||event.defaultPrevented||event.repeat||event.isComposing||event.keyCode===229||event.shiftKey||event.ctrlKey||event.altKey||event.metaKey)return;
      const input=event.target;
      if(!input.matches?.('input')||input.disabled||input.readOnly||input.closest('[onkeydown]'))return;
      if(['button','submit','reset','checkbox','radio','file','range','color','hidden'].includes(input.type))return;
      // Existing login/reset listeners already submit these controls.
      if(['loginUser','loginPass','fpEmail'].includes(input.id))return;
      const modal=document.getElementById('activeModal');
      if(modal&&!modal.contains(input))return;
      if(modal?.dataset.busy==='true'){event.preventDefault();return;}
      if(input.form)return; // Preserve native submission and validation.
      const scope=modal||input.closest('.card,.login-card,section');
      if(!scope)return;
      const visible=button=>button.getClientRects().length&&!button.closest('[hidden],[inert]');
      const candidates=[...scope.querySelectorAll(modal?'.modal-foot button':'button.btn-primary,button[type="submit"],[data-enter-submit]')].filter(visible);
      const primary=candidates.filter(button=>button.matches('.btn-primary,[data-enter-submit],button[type="submit"]'));
      const action=primary.length===1?primary[0]:(modal&&candidates.length===1&&!/^(cancel|close|back)$/i.test(candidates[0].textContent.trim())?candidates[0]:null);
      if(!action)return;
      event.preventDefault();
      if(!action.disabled&&action.getAttribute('aria-disabled')!=='true')action.click();
    });
    document.addEventListener('keydown',event=>{
      const modal=document.getElementById('activeModal');if(!modal)return;
      if(event.key==='Escape'){if(modal.dataset.busy!=='true')root.closeModal();return;}
      if(event.key!=='Tab')return;
      const focusable=[...modal.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(e=>e.getClientRects().length);
      if(!focusable.length)return;const first=focusable[0],last=focusable[focusable.length-1];
      if(event.shiftKey&&(document.activeElement===first||!focusable.includes(document.activeElement))){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||!focusable.includes(document.activeElement))){event.preventDefault();first.focus();}
    });
    setInterval(syncAudit,30000);root.addEventListener('online',syncAudit);
  }
})(globalThis);

// Shared live guidance for every new staff password field.
(function(){
  function passwordRequirements(value){
    const missing=[];
    if(value.length<12)missing.push('at least 12 characters');
    if(!/[A-Z]/.test(value))missing.push('an uppercase letter');
    if(!/[a-z]/.test(value))missing.push('a lowercase letter');
    if(!/[0-9]/.test(value))missing.push('a number');
    if(!/[^A-Za-z0-9\s]/.test(value))missing.push('a special character');
    if(value.length>72)missing.push('no more than 72 characters');
    return missing;
  }
  globalThis.staffPasswordRequirements=passwordRequirements;
  if(typeof document!=='undefined')document.addEventListener?.('input',function(event){
    const input=event.target;
    if(!['mUsPass','mResetPass','pfPass','fpPass'].includes(input.id))return;
    const hint=document.getElementById(input.getAttribute('aria-describedby'));
    if(!hint)return;
    const missing=passwordRequirements(input.value);
    hint.textContent=input.value ? (missing.length?'Still needed: '+missing.join(', ')+'.':'All password requirements met.') : 'At least 12 characters with uppercase and lowercase letters, a number, and a special character.';
    hint.style.color=missing.length?'var(--danger, #dc2626)':'var(--success, #15803d)';
  });
})();

function profilePasswordEye(hidden) {
 const path=hidden?'M3 9c2 4 5 6 9 6s7-2 9-6M5 12l-2 3M9 14.5l-1 3.5M15 14.5l1 3.5M19 12l2 3':'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 100-6 3 3 0 000 6z';
 return '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+path+'"/></svg>';
}
function toggleProfilePassword(id,button) {
 const input=document.getElementById(id),show=input.type==='password';input.type=show?'text':'password';button.innerHTML=profilePasswordEye(!show);button.setAttribute('aria-label',show?'Hide password':'Show password');button.setAttribute('aria-pressed',String(show));
}

(function(){
 if(typeof document==='undefined'||typeof MutationObserver==='undefined')return;
 let sequence=0;
 function enhanceLabels(){
  document.querySelectorAll('.field label:not([for])').forEach(label=>{
   const field=label.closest('.field'),inputs=field.querySelectorAll('input:not([type="hidden"]),select,textarea');
   if(inputs.length!==1||label.querySelector('input,select,textarea'))return;
   const input=inputs[0];if(!input.id)input.id='accessible-field-'+(++sequence);label.htmlFor=input.id;
  });
  document.querySelectorAll('.nav-item').forEach(button=>{if(button.classList.contains('active'))button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  document.querySelectorAll('button[title]:not([aria-label])').forEach(button=>{if(!button.textContent.trim())button.setAttribute('aria-label',button.title);});
 }
 new MutationObserver(enhanceLabels).observe(document.body,{childList:true,subtree:true});enhanceLabels();
})();

// In-app visit notices do not request browser notification permission.
(function(root){
  if(typeof document==='undefined'||typeof root.addEventListener!=='function')return;
  try{localStorage.removeItem('uniserve:browser-alerts');}catch(_){}
  if(typeof navigator!=='undefined'&&navigator.serviceWorker?.getRegistrations){
    navigator.serviceWorker.getRegistrations().then(registrations=>Promise.all(registrations.filter(registration=>[registration.active,registration.waiting,registration.installing].some(worker=>{
      if(!worker?.scriptURL)return false;
      const url=new URL(worker.scriptURL,location.href);
      return url.origin===location.origin&&url.pathname.endsWith('/shared/notification-worker.js');
    })).map(registration=>registration.unregister()))).catch(()=>{});
  }
  root.addEventListener('uniserve:near-turn',event=>{
    const data=event.detail;if(!data?.id||document.visibilityState!=='visible')return;
    const message=data.ahead===0?'You are next in the waiting queue. Stay near OSS.':'Your turn is near. Only '+Number(data.ahead)+' people are ahead of you. Stay near OSS.';
    root.toast?.(message,'ok');
  });
  const intakeEvents=new Set();
  root.addEventListener('uniserve:intake-notification',event=>{
    const data=event.detail;if(!data?.id||intakeEvents.has(data.id))return;
    intakeEvents.add(data.id);if(intakeEvents.size>100)intakeEvents.delete(intakeEvents.values().next().value);
    if(document.visibilityState!=='visible')return;
    const message=data.mode==='closed'?'Head Admin closed walk-in intake'+(data.time?' at '+data.time:'')+'.':data.mode==='scheduled'?'Head Admin scheduled walk-in cutoff for '+data.time+'.':data.mode==='extra'?'Head Admin allowed extra walk-ins during office hours.':'Head Admin restored automatic walk-in cutoff.';
    root.toast?.(root.UniServeUX.escape(message),'ok');
  });
})(globalThis);
