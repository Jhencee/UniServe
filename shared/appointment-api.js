(function () {
  const API=(globalThis.UniServeConfig?.apiBase||'http://127.0.0.1:8000/api');
  const attachmentCache=new Map(), privateRecords=new Map();
  const originalLoad=loadDB, originalSave=saveDB;
  loadDB=function(){const db=originalLoad();db.transactions=(db.transactions||[]).map(t=>privateRecords.get(t.id)||t);for(const a of [...db.appointments||[],...db.transactions||[]])if(attachmentCache.has(a.id))a.attachments=attachmentCache.get(a.id);return db;};
  function snapshot(db) {
    const copy=JSON.parse(JSON.stringify(db));
    for(const record of [...copy.appointments||[],...copy.transactions||[]]) {
      if(!record.shared)continue;
      if(record.restricted)attachmentCache.delete(record.id);
      if(!record.restricted&&attachmentCache.has(record.id)){
        const previous=attachmentCache.get(record.id);
        attachmentCache.set(record.id,(record.attachments||[]).map((file,index)=>({...file,...(!file.dataUrl&&previous[index]?.name===file.name&&previous[index]?.dataUrl?{dataUrl:previous[index].dataUrl}:{})})));
      }
      if((record.attachments||[]).some(file=>file.dataUrl))attachmentCache.set(record.id,record.attachments);
      delete record.documentVersions;
      record.attachments=(record.attachments||[]).map(({dataUrl,...metadata})=>metadata);
    }
    const safeFields=new Set(['id','code','service','status','caseStatus','pickupStatus','createdAt','completedAt','waitingTimeMin','serviceTimeMin','totalTimeMin','shared']);
    for(const record of copy.transactions||[]) {
      const confidential=copy.services?.find(service=>service.key===record.service)?.confidential ?? ['incident_report','concern','scholarship_txn','excuse_letter'].includes(record.service);
      if(!record.shared||!confidential)continue;
      if(record.restricted)privateRecords.delete(record.id);
      else privateRecords.set(record.id,{...record,attachments:attachmentCache.get(record.id)||record.attachments});
      for(const field of Object.keys(record))if(!safeFields.has(field))delete record[field];
      Object.assign(record,{name:'Restricted record',type:'',restricted:true});
    }
    return copy;
  }
  saveDB=function(db){originalSave(snapshot(db));};
  async function request(path,method='GET',body) {
    const session=JSON.parse(sessionStorage.getItem('ossuniserve_session')||'{}');
    const headers={Accept:'application/json','Content-Type':'application/json'};
    if(typeof visitorView==='undefined') headers.Authorization='Bearer '+(session.token||'');
    else headers['X-Visitor-Token']=sessionStorage.getItem('ossuniserve_visitor_token')||'';
    const response=await fetch(API+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});
    const result=await response.json();
    if(!response.ok){const e=Error(Object.values(result.errors||{}).flat().join(' ')||result.message||'Request failed.');e.status=response.status;throw e;}
    return result;
  }
  function cache(result) {
    if(typeof visitorView==='undefined'&&typeof sharedQueueSnapshot!=='undefined')for(const q of [...(result.queues||[]),...(result.queue?[result.queue]:[])])sharedQueueSnapshot.set(q.id,JSON.stringify(q));
    const db=loadDB();
    if(result.appointments) db.appointments=db.appointments.filter(a=>!a.shared).concat(result.appointments);
    if(result.appointment) db.appointments=db.appointments.filter(a=>a.id!==result.appointment.id&&(!result.appointment.visitId||a.visitId!==result.appointment.visitId)).concat(result.appointment);
    if(result.queue) db.queues=db.queues.filter(q=>q.id!==result.queue.id).concat(result.queue);
    // API snapshots are cached directly; never enqueue another write for a read.
    (window.SecureState?SecureState.persist(snapshot(db)):localStorage.setItem(DB_KEY,JSON.stringify(snapshot(db))));
    if(typeof refreshSidebarCounts==='function')refreshSidebarCounts();
    if(typeof window.refreshSidebarNotificationCount==='function')window.refreshSidebarNotificationCount();
    return result;
  }
  function verify(onSuccess, context={}) {
    const description=context.purpose==='submission'?'Verify the email in your details before submitting. We will email you a six-digit code.':context.purpose==='cancellation'?'To cancel your appointment, verify its email address. We will email you a six-digit verification code.':context.purpose==='chat'?'Verify your email to send a question or concern to OSS, or reopen your conversation.':'Verify your email to securely access your visits and requests.';
    openModal('Verify your email', `<p class="field-hint">${description}</p><div class="field"><label for="appointmentEmail">Email</label><input id="appointmentEmail" type="email" autocomplete="email" placeholder="name@gmail.com" value="${escapeHtml(context.email||'')}" ${context.purpose==='submission'?'readonly':''} required><p id="appointmentEmailStatus" class="field-hint" role="status" aria-live="polite"></p></div>${VisitorTurnstile.markup('appointmentSecurity')}`,[
      {label:'Cancel',cls:'btn-ghost',action:closeModal},
      {label:'Send Code',cls:'btn-primary',action:async()=>{
        const input=document.getElementById('appointmentEmail');
        const status=document.getElementById('appointmentEmailStatus');
        const button=document.getElementById('modalBtn1');
        const email=input.value.trim();
        if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(email)){
          status.textContent='Enter a valid email address, such as name@gmail.com.';
          input.setAttribute('aria-invalid','true');input.focus();return;
        }
        input.removeAttribute('aria-invalid');
        const cooldownKey='visitor:'+email;
        if(window.CodeCooldown?.remaining(cooldownKey)){
          window.CodeCooldown.bind(button,cooldownKey,'Send Code');return;
        }
        window.CodeCooldown?.unbind(button);
        button.disabled=true;button.textContent='Sending…';
        status.textContent='Requesting your verification code…';
        try {
          const turnstileToken=await VisitorTurnstile.getToken('appointmentSecurity');
          let challenge;
          try { challenge=await request('/history/code','POST',{email,turnstileToken}); }
          finally { VisitorTurnstile.reset('appointmentSecurity'); }
          window.CodeCooldown?.start(cooldownKey);
          openModal('Verify your email', `<p class="field-hint">A verification code has been requested for ${escapeHtml(email)}.</p><div class="field"><label class="verification-code-label" for="appointmentCode">Verification code</label><input id="appointmentCode" class="verification-code-input" placeholder="000000" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div><div id="appointmentResend" style="display:flex;justify-content:center;margin-top:12px"></div>`,[
            {label:'Cancel',cls:'btn-ghost',action:closeModal},
            {label:'Verify',cls:'btn-primary',action:async()=>{
              try {const result=await request('/history/verify','POST',{challengeId:challenge.challengeId,code:document.getElementById('appointmentCode').value.trim()});sessionStorage.setItem('ossuniserve_visitor_token',result.visitorToken);cache(result);closeModal();await onSuccess();}catch(e){toast(escapeHtml(e.message),'err');}
            }},
            {label:'Resend code',cls:'btn-ghost resend-text',action:()=>{
              if(window.CodeCooldown?.remaining(cooldownKey))return;
              verify(onSuccess,{...context,email});
              document.getElementById('modalBtn1').click();
            }}
          ]);
          const resendButton = document.getElementById('modalBtn2');
          document.getElementById('appointmentResend').appendChild(resendButton);
          window.CodeCooldown?.bind(resendButton,cooldownKey);
        }catch(e){status.textContent=e.message==='Failed to fetch'?'Cannot reach the server. Check your connection and try again.':e.message;}
        finally{if(button.isConnected){button.disabled=false;button.textContent='Send Code';}}
      }}
    ]);
    VisitorTurnstile.mount('appointmentSecurity');
    const emailInput=document.getElementById('appointmentEmail');
    const bindSend=()=>window.CodeCooldown?.bind(document.getElementById('modalBtn1'),'visitor:'+emailInput.value.trim(),'Send Code');
    emailInput.addEventListener('input',bindSend);bindSend();
  }
  async function visitorRequest(path,method='GET',body) {
    try{return cache(await request(path,method,body));}
    catch(e){if(e.status===401){verify(async()=>{
      const result=cache(await request(path,method,body));
      if(result.queue){myActiveQueueId=result.queue.id;persistSession();renderQueueTicket();}
      else if(result.appointment)showPassModalReadonly(result.appointment,true);
      else if(result.cancelled){const id=decodeURIComponent(path.split('/')[2]),a=loadDB().appointments.find(a=>a.id===id);if(a){const updated=cache(await request('/appointments/visit/'+encodeURIComponent(a.visitId||a.id)));showPassModalReadonly(updated.appointment,true);}}
    });return null;}throw e;}
  }
  async function ensureEmail(email, onVerified) {
    try { await request('/history/session','POST',{email}); return true; }
    catch(e) {
      if(e.status===401 || e.status===403) { verify(onVerified,{purpose:'submission',email}); return false; }
      throw e;
    }
  }
  const correctionOptions=['Upload a clearer copy.','Upload the complete document, including all pages.','Upload the correct document for this service.','Add the required signature.','Correct the details to match your ID.','Bring the original document to OSS.'];
  window.toggleDocumentCorrection=function(select){
    const field=document.getElementById(select.id+'OtherField');
    field.hidden=select.value!=='Other';
    if(!field.hidden)field.querySelector('textarea').focus();
  };
  function correctionSelectHtml(index,reason=''){
    const selected=correctionOptions.includes(reason)?reason:reason?'Other':'';
    return '<div class="field"><label for="documentReason'+index+'">Correction instructions</label><select id="documentReason'+index+'" onchange="toggleDocumentCorrection(this)"><option value="">Select an instruction</option>'+correctionOptions.concat('Other').map(option=>'<option'+(selected===option?' selected':'')+'>'+escapeHtml(option)+'</option>').join('')+'</select></div><div class="field" id="documentReason'+index+'OtherField"'+(selected==='Other'?'':' hidden')+'><label for="documentReason'+index+'Other">Other instruction</label><textarea id="documentReason'+index+'Other" maxlength="1000" rows="2" placeholder="Explain what needs to be corrected.">'+escapeHtml(selected==='Other'?reason:'')+'</textarea></div>';
  }
  function documentRequirementSelect(a,index,review) {
    const db=loadDB(),service=(db.services||[]).find(s=>s.key===(a.serviceKey||a.service)||s.label===a.service);
    const requirements=[...new Set((service?.requirements||[]).map(label=>String(label).trim()).filter(Boolean))];
    if(!requirements.length)return '';
    return '<div class="field"><label for="documentRequirement'+index+'">Requirement covered</label><select id="documentRequirement'+index+'"><option value="">Select a requirement</option>'+requirements.map(label=>'<option value="'+escapeHtml(label)+'"'+(review.requirement===label&&review.serviceKey===service.key?' selected':'')+'>'+escapeHtml(label)+'</option>').join('')+'</select><p class="field-hint">When accepted, this upload satisfies the selected requirement in Queue.</p></div>';
  }
  function documentReviewSummary(a) {
    const files=a.attachments||[],accepted=files.filter(f=>f.review?.status==='Accepted').length,corrections=files.filter(f=>f.review?.status==='Needs correction').length,pending=files.length-accepted-corrections;
    const next=corrections?'Review correction instructions and follow up with the visitor.':pending?'Review the remaining uploaded documents.':'Uploaded documents are accepted. Check the service requirements before proceeding.';
    return '<div class="document-review-summary"><p><strong>'+accepted+' of '+files.length+' files accepted</strong> &middot; '+pending+' pending &middot; '+corrections+' need correction</p><p class="field-hint">'+next+'</p></div>';
  }
  window.documentReviewHtml=function(a,editable=false){
    if(!a?.attachments?.length)return '';
    const canEdit=editable&&a.shared&&!a.restricted&&['Requested','Booked'].includes(a.status);
    const historyButton=editable?'<button type="button" class="btn btn-ghost btn-sm document-history-action" data-visit-id="'+escapeHtml(a.id)+'" onclick="openDocumentHistory(this.dataset.visitId)"><span>Previous document versions</span></button>':'';
    return '<section class="document-review"><h4 class="document-review-title">Uploaded requirements</h4>'+(typeof state_view!=='undefined'?documentReviewSummary(a):'')+a.attachments.map((f,i)=>{
      const review=f.review||{},status=review.status||'Pending review';
      const cls=status==='Accepted'?'pill-ok':status==='Needs correction'?'pill-danger':'pill-warn';
      return '<div class="document-review-item"><div class="document-review-heading"><div class="document-review-file">'+attachChip(f)+'</div>'+(!canEdit?'<span class="pill '+cls+'">'+escapeHtml(status)+'</span>':'')+'</div>'+
        (!canEdit&&review.requirement?'<p class="field-hint">Requirement: '+escapeHtml(review.requirement)+'</p>':'')+
        (!canEdit&&review.reason?'<p class="field-hint">'+escapeHtml(review.reason)+'</p>':'')+
        (!canEdit&&review.reviewedAt?'<p class="field-hint">Reviewed '+escapeHtml(String(fmtDateTime(review.reviewedAt)).replace(/&middot;/g, '\u00b7'))+'</p>':'')+
        (!editable&&typeof visitorView!=='undefined'&&status==='Needs correction'&&['Requested','Booked'].includes(a.status)?'<div class="field"><label for="replacement'+i+'">Corrected document</label><input id="replacement'+i+'" type="file" accept="application/pdf,image/png,image/jpeg"><button type="button" class="btn btn-ghost btn-sm" data-visit-id="'+escapeHtml(a.id)+'" data-index="'+i+'" onclick="replaceVisitDocument(this)">Submit replacement</button></div>':'')+
        (canEdit?'<div class="document-review-form" oninput="markDocumentReadinessUnsaved(this)" onchange="markDocumentReadinessUnsaved(this)">'+documentRequirementSelect(a,i,review)+'<div class="field"><label for="documentStatus'+i+'">Readiness decision</label><select id="documentStatus'+i+'" data-review-index="'+i+'" onchange="toggleDocumentReviewCorrection(this)">'+['Pending review','Accepted','Needs correction'].map(decision=>'<option'+(decision===status?' selected':'')+'>'+decision+'</option>').join('')+'</select></div><div id="documentCorrection'+i+'"'+(status==='Needs correction'?'':' hidden')+'>'+correctionSelectHtml(i,review.reason||'')+'</div><button type="button" class="btn btn-primary btn-sm" data-review-id="'+escapeHtml(a.id)+'" data-review-index="'+i+'" onclick="saveDocumentReview(this)"'+(review.reviewedAt?' disabled':'')+'>Save readiness</button><p class="field-hint document-save-state" role="status" aria-live="polite" data-state="'+(review.reviewedAt?'saved':'unsaved')+'">'+(review.reviewedAt?'Saved &middot; '+escapeHtml(String(fmtDateTime(review.reviewedAt)).replace(/&middot;/g,' / ')):'Not saved yet')+'</p></div>':'')+'</div>';
    }).join('')+historyButton+'</section>';
  };
  window.replaceVisitDocument=async function(button){
    const id=button.dataset.visitId,index=button.dataset.index,a=loadDB().appointments.find(a=>a.id===id),input=document.getElementById('replacement'+index),file=input.files?.[0];
    if(!a||!file){toast('Choose a corrected document.','err');return;}
    if(file.size>5*1024*1024){toast('Each file must be at most 5 MB.','err');return;}
    button.disabled=true;
    try{const [attachment]=await readFilesAsAttachments([file]);const result=await visitorRequest('/appointments/'+encodeURIComponent(id)+'/documents/'+index,'PUT',{name:attachment.name,dataUrl:attachment.dataUrl,revision:a.revision});if(result){cache(result);showPassModalReadonly(result.appointment,true);toast('Replacement submitted for staff review.','ok');}}catch(e){toast(escapeHtml(e.message),'err');}finally{button.disabled=false;}
  };
  window.markDocumentReadinessUnsaved=function(form){
    const note=form.querySelector('.document-save-state'),button=form.querySelector('button[data-review-id]');
    note.textContent='Unsaved changes';note.dataset.state='unsaved';button.disabled=false;
  };
  window.toggleDocumentReviewCorrection=function(select){
    const field=document.getElementById('documentCorrection'+select.dataset.reviewIndex);
    field.hidden=select.value!=='Needs correction';
  };
  window.saveDocumentReview=async function(button){
    const id=button.dataset.reviewId,index=Number(button.dataset.reviewIndex),a=loadDB().appointments.find(a=>a.id===id);
    if(!a)return;
    const status=document.getElementById('documentStatus'+index).value,choice=document.getElementById('documentReason'+index).value;
    const reason=status==='Needs correction'?(choice==='Other'?document.getElementById('documentReason'+index+'Other').value.trim():choice):'';
    if(status==='Needs correction'&&!reason){toast('Explain what the visitor needs to correct.','err');document.getElementById('documentReason'+index).focus();return;}
    const requirementField=document.getElementById('documentRequirement'+index),requirement=requirementField?.value||'';
    if(status==='Accepted'&&requirementField&&!requirement){toast('Select the requirement this document covers.','err');requirementField.focus();return;}
    const form=button.closest('.document-review-form'),saveState=form.querySelector('.document-save-state');
    const fields=[...form.querySelectorAll('select,textarea,input,button')];
    fields.forEach(field=>field.disabled=true);button.textContent='Saving...';saveState.textContent='Saving readiness...';saveState.dataset.state='saving';
    try{const result=cache(await request('/appointments/'+encodeURIComponent(id)+'/documents/'+index,'PATCH',{status,reason,requirement,revision:a.revision}));const updated=document.createElement('div');updated.innerHTML=documentReviewHtml(result.appointment,true);const summary=button.closest('.document-review')?.querySelector('.document-review-summary');if(summary&&updated.querySelector('.document-review-summary'))summary.replaceWith(updated.querySelector('.document-review-summary'));button.closest('.document-review-item').replaceWith(updated.querySelectorAll('.document-review-item')[index]);if(typeof state_view!=='undefined'&&state_view==='appointments'&&typeof renderApptTable==='function')renderApptTable();toast('Readiness saved.','ok');}
    catch(e){saveState.textContent='Not saved. '+(e.status===409?'This record changed. Reopen requirements to review the latest version.':'Try saving again.');saveState.dataset.state='unsaved';toast(escapeHtml(e.message),'err');if(e.status===409){try{cache(await request('/appointments'));}catch{}}}
    finally{fields.forEach(field=>field.disabled=false);button.textContent='Save readiness';}
  };
  window.SharedAppointments={request,cache,verify,visitorRequest,ensureEmail,clearPrivateCache:()=>{attachmentCache.clear();privateRecords.clear();}};
  window.requestNewSchedule=function(id){
    openModal('Request a new schedule','<p class="field-hint">Your details and uploads will be retained. OSS must confirm a new date and time; your current booking remains until then.</p>'+reasonSelectHtml('rescheduleReason',['Class or exam conflict','Work schedule conflict','Illness or medical appointment','Family emergency','Travel or transportation difficulty','Additional time to prepare requirements'])+'',[
      {label:'Back',cls:'btn-ghost',action:closeModal},
      {label:'Send request',cls:'btn-primary',action:async()=>{
        try{const result=await visitorRequest('/appointments/'+encodeURIComponent(id)+'/reschedule-request','POST',{reason:readSelectedReason('rescheduleReason')});if(result)showPassModalReadonly(result.appointment,true);}catch(e){toast(escapeHtml(e.message),'err');}
      }}
    ]);
  };
  async function services(){const result=await request('/services'),db=loadDB();db.services=result.services;(window.SecureState?SecureState.persist(snapshot(db)):localStorage.setItem(DB_KEY,JSON.stringify(snapshot(db))));}
  services().then(()=>{if(typeof visitorView!=='undefined' && visitorView==='visit' && visitStep==='pick')renderVisitScreen();}).catch(()=>{});
  window.cancelSharedAppointment=async function(id){
    try {
      const a=loadDB().appointments.find(a=>a.id===id);
      if(typeof visitorView==='undefined'){
        if(!await UniServeUX.confirm('Cancel appointment?','Are you sure you want to cancel this appointment? Its pending reminder emails will also be stopped.','Yes, cancel appointment'))return;
        await request('/appointments/'+encodeURIComponent(id)+'/cancel','POST',{});closeModal();await renderAppointments(true);
      }
      else {
        if(!a)throw Error('Appointment not found. Open your visit again.');
        verify(async()=>{
          if(!await UniServeUX.confirm('Cancel appointment?','Are you sure you want to cancel appointment '+(a.visitId||'')+'? You will need to start a new visit if you still need this service.','Yes, cancel appointment'))return;
          await request('/appointments/'+encodeURIComponent(id)+'/cancel','POST',{});
          const updated=cache(await request('/appointments/visit/'+encodeURIComponent(a.visitId||a.id)));
          showPassModalReadonly(updated.appointment,true);
        },{purpose:'cancellation',email:a.email});
      }
    }catch(e){toast(escapeHtml(e.message),'err');}
  };
  if(typeof visitorView==='undefined') {
    const originalCalendar=renderCalendar;
    renderCalendar=async function(){try{cache(await request('/appointments'));if(state_view==='calendar')originalCalendar();}catch(e){if(state_view==='calendar')toast(escapeHtml(e.message),'err');}};
    const originalServices=renderServicesManage;
    renderServicesManage=async function(){try{await services();if(state_view==='services')originalServices();}catch(e){if(state_view==='services')toast(escapeHtml(e.message),'err');}};
    let recordRefreshPromise=null;
    async function records() {
      if(recordRefreshPromise)return recordRefreshPromise;
      recordRefreshPromise=(async()=>{
        const result=await request('/service-records'),db=loadDB();
        db.transactions=db.transactions.filter(t=>!t.shared && !result.transactions.some(s=>s.id===t.id||s.visitId&&s.visitId===t.visitId)).concat(result.transactions);
        db.visitorLog=db.visitorLog.filter(l=>!l.shared && !result.visitorLog.some(s=>s.id===l.id||s.visitId&&s.visitId===l.visitId)).concat(result.visitorLog);
        (window.SecureState?SecureState.persist(snapshot(db)):localStorage.setItem(DB_KEY,JSON.stringify(snapshot(db))));
        if(typeof refreshSidebarCounts==='function')refreshSidebarCounts();
        if(typeof window.refreshSidebarNotificationCount==='function')window.refreshSidebarNotificationCount();
      })();
      try{await recordRefreshPromise;}finally{recordRefreshPromise=null;}
    }
    SharedAppointments.reloadRecords=async function(){
      // Permission changes must not reuse a read started before the unlock.
      if(recordRefreshPromise){try{await recordRefreshPromise;}catch(_){}}
      await records();
    };
    const oldLock=lockConfTxn;lockConfTxn=function(id){const hadAccess=confUnlocked.has(id);privateRecords.delete(id);attachmentCache.delete(id);oldLock(id);if(hadAccess){const db=loadDB(),record=db.transactions.find(t=>t.id===id);logActivity(db,currentUser,'Confidential record relocked',{category:'Confidential',target:record?.code||id});saveDB(db);}};
    const originalTransactions=renderTransactions, originalLog=renderVisitorLogbook;
    const originalDashboard=renderDashboard;
    renderDashboard=async function(){try{await Promise.all([records(),request('/appointments').then(cache),loadSharedQueue()]);if(state_view==='dashboard')originalDashboard();}catch(e){if(state_view==='dashboard')toast(escapeHtml(e.message),'err');}};
    const originalReports=renderReports;
    renderReports=async function(){try{await Promise.all([records(),request('/appointments').then(cache)]);if(state_view==='reports')await originalReports();}catch(e){if(state_view==='reports')toast(escapeHtml(e.message),'err');}};
    renderTransactions=async function(){try{await records();if(state_view==='transactions')originalTransactions();}catch(e){if(state_view==='transactions')toast(escapeHtml(e.message),'err');}};
    renderVisitorLogbook=async function(keep){try{await records();if(state_view==='logbook')originalLog(keep);}catch(e){if(state_view==='logbook')toast(escapeHtml(e.message),'err');}};
    handleCompleteQueue=async function(id){
      if(typeof queueRequirementSaving!=='undefined'&&queueRequirementSaving.has(id)){toast('Wait for the checklist to finish saving.','warn');return;}
      try{
        await loadSharedQueue();
        const db=loadDB(),q=db.queues.find(q=>q.id===id);
        if(q&&typeof queueRequirementState==='function'&&!queueRequirementState(db,q).ready){toast('Check all requirements before completing this visit.','warn');return;}
        const complete=async(documentPreparation=false)=>{try{cache(await request('/queue/'+encodeURIComponent(id),'PATCH',{status:'Completed',documentPreparation}));sessionStorage.removeItem('uniserve_document_preparation:'+id);closeModal();await records();await renderQueueDashboard();renderSidebar();toast(documentPreparation?'Visit completed. Document added to preparation.':'Visit completed and logged.','ok');}catch(e){toast(escapeHtml(e.message),'err');}};
        if(q&&!q.pickupTransactionId){const preparation=typeof documentPreparationSelected==='function'&&documentPreparationSelected(id);openModal('Complete service','<p class="field-hint">'+(preparation?'Complete this visit and add the document to pending preparation.':'Complete this visit and save the service record.')+'</p>',[{label:'Cancel',cls:'btn-ghost',action:closeModal},{label:'Complete service',cls:'btn-primary',action:()=>complete(preparation)}]);return;}
        await complete();}catch(e){toast(escapeHtml(e.message),'err');}
    };
    const original=renderAppointments;
    renderAppointments=async function(keep){try{await Promise.all([request('/appointments').then(cache),typeof loadSharedQueue==='function'?loadSharedQueue():Promise.resolve()]);if(state_view==='appointments')original(keep);}catch(e){if(state_view==='appointments')toast(escapeHtml(e.message),'err');}};
    adminCheckInAppointment=async function(id){
      const a=loadDB().appointments.find(a=>a.id===id);
      if(!a?.shared){toast('This legacy appointment must be migrated before check-in.','err');return;}
      const now=Date.now(),at=new Date(a.date+'T'+a.time+':00+08:00').getTime(),late=a.arrivalPolicy?.lateMinutes||60;
      if(now<at-30*60000||now>=at+late*60000){
        openModal('Review arrival time','<p class="field-hint">Check-in opens 30 minutes before the appointment. Review early or late arrivals before overriding the window. Scheduled visitors are called when their appointment time arrives.</p>'+reasonSelectHtml('arrivalOverrideReason',['Transportation delay','Class or work schedule conflict','Medical or accessibility assistance','Visitor arrived early and staff approved check-in','Office instructed a different arrival time']).replace('>Reason</label>','>Override reason</label>')+'',[{label:'Back',cls:'btn-ghost',action:closeModal},{label:'Confirm check-in',cls:'btn-primary',action:async()=>{let reason;try{reason=readSelectedReason('arrivalOverrideReason');}catch(e){toast(escapeHtml(e.message),'err');return;}try{cache(await request('/appointments/'+encodeURIComponent(id)+'/check-in','POST',{arrivalOverrideReason:reason}));closeModal();await renderAppointments(true);renderSidebar();toast('Checked in. Override recorded.','ok');}catch(e){toast(escapeHtml(e.message),'err');}}}]);return;
      }
      try{cache(await request('/appointments/'+encodeURIComponent(id)+'/check-in','POST',{}));closeModal();await renderAppointments(true);renderSidebar();toast('Checked in.','ok');}catch(e){toast(escapeHtml(e.message),'err');}
    };
  } else {
    let appointmentRefreshBusy=false;
    setInterval(async()=>{
      if(appointmentRefreshBusy||window.UniServeRealtime?.connected||document.visibilityState==='hidden'||document.getElementById('activeModal'))return;
      if(typeof visitorHubOpen!=='undefined'&&visitorHubOpen)return;
      if(!['visit','checkvisit'].includes(visitorView)||!sessionStorage.getItem('oss_activeAppointmentId'))return;
      appointmentRefreshBusy=true;
      try{await refreshAppointmentPass();}finally{appointmentRefreshBusy=false;}
    },5000);
    refreshAppointmentPass=async function(){
      if(typeof visitorHubOpen!=='undefined'&&visitorHubOpen)return;
      const navigation=typeof visitorNavigationVersion==='undefined'?0:visitorNavigationVersion;
      const stillViewing=()=>sessionStorage.getItem('oss_activeAppointmentId')===id&&(typeof visitorNavigationVersion==='undefined'||visitorNavigationVersion===navigation)&&(typeof visitorHubOpen==='undefined'||!visitorHubOpen);
      const id=sessionStorage.getItem('oss_activeAppointmentId'),a=loadDB().appointments.find(a=>a.id===id);
      if(!id)return;
      // The appointment ID stays stable while its pending reference becomes a Visit ID.
      // Cached Visit IDs from older browser versions may no longer match the server.
      if(a?.shared)showPassModalReadonly(a,true);
      try{
        const result=await visitorRequest('/appointments/visit/'+encodeURIComponent(id));
        if(!stillViewing())return;
        if(result)showPassModalReadonly(result.appointment,true);
      }catch(e){
        if(!stillViewing())return;
        if(!a?.shared&&typeof document!=='undefined'){
          const content=document.getElementById('visitorContent');
          if(content)content.innerHTML='<div class="visitor-page-wrap"><div class="card card-pad"><p role="alert">Could not load your visit status. Please try again.</p><button type="button" class="btn btn-primary" onclick="refreshAppointmentPass()">Retry</button><button type="button" class="btn btn-ghost" onclick="navigateVisitor(\'checkvisit\')">Check another visit</button></div></div>';
        }
        if(e.status===404){
          toast(a?.shared?'Could not refresh this appointment. Your saved ticket is still shown; use Visit History to check your records.':'Could not find this appointment. Use Visit History to check your records.','err');
        }else toast(escapeHtml(e.message),'err');
      }
    };
    const originalLookup=lookupMyVisit;
    lookupMyVisit=async function(){
      const code=normVisitRef(document.getElementById('cvInput').value).replace(/[^A-Z0-9]/g,'').replace(/^(VIS|APT)/,'$1-');
      if(!code){visitorFormError('Enter your Visit ID.','visitorLookupError');return;}
      try{const result=await visitorRequest('/appointments/visit/'+encodeURIComponent(code));if(!result)return;if(result.queue){myActiveQueueId=result.queue.id;persistSession();renderQueueTicket();}else showPassModalReadonly(result.appointment,true);}
      catch(e){if(e.status===404)await originalLookup();else visitorFormError(escapeHtml(e.message),'visitorLookupError');}
    };
  }
})();

let staffSlotVersion=0;
function selectStaffAppointmentSlot(button) {
 const input=document.getElementById('mApptTime');if(!input||input.disabled||button.disabled)return;
 input.value=button.dataset.time;
 document.querySelectorAll('#staffSlotChoices button[data-time]').forEach(row=>row.setAttribute('aria-pressed',String(row===button)));
 if(typeof calendarAppointmentWarning==='function')calendarAppointmentWarning();
}
function staffAppointmentSlotsHtml(result,selected='') {
 const slots=result.availability||result.slots.map(time=>({time,available:true,status:'available'}));
 const count=slots.filter(slot=>slot.available).length;
 return '<p class="staff-slot-summary" role="status">'+count+' '+(count===1?'time slot available':'time slots available')+'</p><div class="staff-slot-list" role="group" aria-label="Appointment times">'+slots.map(slot=>{
  const occupied=slot.occupied===undefined?'':slot.occupied+'/'+slot.capacity;
  const reserved=result.currentReservation?.time===slot.time;
  const label=slot.status==='past'?'Time passed':!slot.available?'Full':reserved?'Your reserved time':slot.remaining===undefined?'Available':slot.remaining+' available';
  const breakdown=slot.pending===undefined?'':'<small class="staff-slot-breakdown">'+slot.pending+' pending &middot; '+slot.confirmed+' confirmed'+(reserved?' &middot; excludes this appointment':'')+'</small>';
  return '<button type="button" class="staff-slot-option" data-time="'+escapeHtml(slot.time)+'" aria-pressed="'+(slot.available&&slot.time===selected)+'" '+(!slot.available?'disabled':'')+' onclick="selectStaffAppointmentSlot(this)"><span>'+escapeHtml(UniServeUX.timeLabel(slot.time))+'</span><span class="staff-slot-availability">'+label+(occupied?' <small>'+occupied+'</small>':'')+breakdown+'</span></button>';
 }).join('')+'</div>'+(slots.length?'':'<p class="field-hint">No appointment times for this date. Choose another date.</p>')+'';
}
async function refreshStaffAppointmentSlots(){
 const version=++staffSlotVersion,input=document.getElementById('mApptTime'),date=document.getElementById('mApptDate')?.value,host=document.getElementById('staffSlotChoices');
 if(!input)return;input.disabled=true;input.innerHTML='<option value="">'+(date?'Loading slots...':'Choose a date first')+'</option>';
 if(host)host.innerHTML='<p class="field-hint" role="status">'+(date?'Loading appointment times?':'Choose a date to see appointment times.')+'</p>';
 if(!date)return;
 try{
  const result=await SharedAppointments.request('/appointment-slots?'+new URLSearchParams({date,office:input.dataset.office,exclude:input.dataset.appointmentId}));
  if(version!==staffSlotVersion||!input.isConnected)return;
  input.innerHTML='<option value="">'+(result.slots.length?'Select an available time':'No available slots')+'</option>'+result.slots.map(time=>'<option value="'+time+'">'+escapeHtml(UniServeUX.timeLabel(time))+'</option>').join('');
  input.value=result.slots.includes(input.dataset.current)?input.dataset.current:'';input.disabled=!result.slots.length;
  if(host)host.innerHTML=staffAppointmentSlotsHtml(result,input.value);
 }catch(error){
  if(version!==staffSlotVersion||!input.isConnected)return;
  input.innerHTML='<option value="">Availability could not be loaded</option>';
  if(host)host.innerHTML='<p class="field-hint" role="alert">Could not load times. <button type="button" class="btn btn-ghost btn-sm" onclick="refreshStaffAppointmentSlots()">Retry</button></p>';
  toast(escapeHtml(error.message),'err');
 }
}
