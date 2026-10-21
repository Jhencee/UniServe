(function () {
  const API=(globalThis.UniServeConfig?.apiBase||'http://127.0.0.1:8000/api');
  const attachmentCache=new Map(), privateRecords=new Map();
  const originalLoad=loadDB, originalSave=saveDB;
  loadDB=function(){const db=originalLoad();db.transactions=(db.transactions||[]).map(t=>privateRecords.get(t.id)||t);for(const a of [...db.appointments||[],...db.transactions||[]])if(attachmentCache.has(a.id))a.attachments=attachmentCache.get(a.id);return db;};
  function snapshot(db){const copy=JSON.parse(JSON.stringify(db));for(const a of [...copy.appointments||[],...copy.transactions||[]])if(a.shared){if(a.restricted)attachmentCache.delete(a.id);if((a.attachments||[]).some(f=>f.dataUrl))attachmentCache.set(a.id,a.attachments);a.attachments=(a.attachments||[]).map(({dataUrl,...metadata})=>metadata);}for(const t of copy.transactions||[])if(t.shared&&(copy.services?.find(s=>s.key===t.service)?.confidential ?? ['incident_report','concern','scholarship_txn','excuse_letter'].includes(t.service))){if(t.restricted)privateRecords.delete(t.id);else privateRecords.set(t.id,{...t,attachments:attachmentCache.get(t.id)||t.attachments});for(const k of Object.keys(t))if(!['id','code','service','status','caseStatus','createdAt','shared'].includes(k))delete t[k];Object.assign(t,{name:'Restricted record',type:'',restricted:true});}return copy;}
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
    const db=loadDB();
    if(result.appointments) db.appointments=db.appointments.filter(a=>!a.shared).concat(result.appointments);
    if(result.appointment) db.appointments=db.appointments.filter(a=>a.id!==result.appointment.id&&a.visitId!==result.appointment.visitId).concat(result.appointment);
    if(result.queue) db.queues=db.queues.filter(q=>q.id!==result.queue.id).concat(result.queue);
    // API snapshots are cached directly; never enqueue another write for a read.
    (window.SecureState?SecureState.persist(snapshot(db)):localStorage.setItem(DB_KEY,JSON.stringify(snapshot(db))));
    return result;
  }
  function verify(onSuccess, context={}) {
    const description=context.purpose==='submission'?'Verify the Gmail in your details before submitting. We will email you a six-digit code.':context.purpose==='cancellation'?'To cancel your appointment, verify its Gmail address. We will email you a six-digit verification code.':context.purpose==='chat'?'Verify your Gmail to send a question or concern to OSS, or reopen your conversation.':'Verify your Gmail to securely access your visits and requests.';
    openModal('Verify your Gmail', `<p class="field-hint">${description}</p><div class="field"><label for="appointmentEmail">Gmail</label><input id="appointmentEmail" type="email" autocomplete="email" placeholder="name@gmail.com" value="${escapeHtml(context.email||'')}" ${context.purpose==='submission'?'readonly':''} required><p id="appointmentEmailStatus" class="field-hint" role="status" aria-live="polite"></p></div>${VisitorTurnstile.markup('appointmentSecurity')}`,[
      {label:'Cancel',cls:'btn-ghost',action:closeModal},
      {label:'Send Code',cls:'btn-primary',action:async()=>{
        const input=document.getElementById('appointmentEmail');
        const status=document.getElementById('appointmentEmailStatus');
        const button=document.getElementById('modalBtn1');
        const email=input.value.trim();
        if(!/^[^\s@]+@gmail\.com$/i.test(email)){
          status.textContent='Enter a valid Gmail address, such as name@gmail.com.';
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
          openModal('Verify your Gmail', `<p class="field-hint">Your code has been requested for ${escapeHtml(email)}. Delivery may take a moment. Check your inbox and spam folder.</p><div class="field"><label for="appointmentCode">Verification code</label><input id="appointmentCode" class="verification-code-input" placeholder="000000" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div>`,[
            {label:'Cancel',cls:'btn-ghost',action:closeModal},
            {label:'Verify',cls:'btn-primary',action:async()=>{
              try {const result=await request('/history/verify','POST',{challengeId:challenge.challengeId,code:document.getElementById('appointmentCode').value.trim()});sessionStorage.setItem('ossuniserve_visitor_token',result.visitorToken);cache(result);closeModal();await onSuccess();}catch(e){toast(escapeHtml(e.message),'err');}
            }},
            {label:'Resend code',cls:'btn-ghost',action:()=>{
              if(window.CodeCooldown?.remaining(cooldownKey))return;
              verify(onSuccess,{...context,email});
              document.getElementById('modalBtn1').click();
            }}
          ]);
          window.CodeCooldown?.bind(document.getElementById('modalBtn2'),cooldownKey);
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
      else if(result.cancelled){const id=decodeURIComponent(path.split('/')[2]),a=loadDB().appointments.find(a=>a.id===id);if(a){const updated=cache(await request('/appointments/visit/'+encodeURIComponent(a.visitId)));showPassModalReadonly(updated.appointment,true);}}
    });return null;}throw e;}
  }
  async function ensureEmail(email, onVerified) {
    try { await request('/history/session','POST',{email}); return true; }
    catch(e) {
      if(e.status===401 || e.status===403) { verify(onVerified,{purpose:'submission',email}); return false; }
      throw e;
    }
  }
  window.documentReviewHtml=function(a,editable=false){
    if(!a?.attachments?.length)return '';
    const canEdit=editable&&a.shared&&!a.restricted&&['Requested','Booked'].includes(a.status);
    return '<div class="document-review"><label>Document review</label>'+a.attachments.map((f,i)=>{
      const review=f.review||{},status=review.status||'Pending review';
      const cls=status==='Accepted'?'pill-ok':status==='Needs correction'?'pill-danger':'pill-warn';
      return '<div class="document-review-item"><div class="document-review-heading"><strong>'+escapeHtml(f.name)+'</strong><span class="pill '+cls+'">'+escapeHtml(status)+'</span></div>'+
        (review.reason?'<p class="field-hint">'+escapeHtml(review.reason)+'</p>':'')+
        (review.reviewedAt?'<p class="field-hint">Reviewed '+escapeHtml(fmtDateTime(review.reviewedAt))+'</p>':'')+
        (canEdit?'<div class="field"><label for="documentStatus'+i+'">Review result</label><select id="documentStatus'+i+'">'+['Pending review','Accepted','Needs correction'].map(s=>'<option'+(s===status?' selected':'')+'>'+s+'</option>').join('')+'</select></div><div class="field"><label for="documentReason'+i+'">Correction instructions</label><textarea id="documentReason'+i+'" maxlength="1000" rows="2" placeholder="Explain what to correct and bring to OSS.">'+escapeHtml(review.reason||'')+'</textarea></div><button type="button" class="btn btn-ghost btn-sm" data-review-id="'+escapeHtml(a.id)+'" data-review-index="'+i+'" onclick="saveDocumentReview(this)">Save review</button>':'')+'</div>';
    }).join('')+'<p class="field-hint">Review applies to uploaded copies. Bring required originals and any corrected documents to OSS.</p></div>';
  };
  window.saveDocumentReview=async function(button){
    const id=button.dataset.reviewId,index=Number(button.dataset.reviewIndex),a=loadDB().appointments.find(a=>a.id===id);
    if(!a)return;
    const status=document.getElementById('documentStatus'+index).value,reason=document.getElementById('documentReason'+index).value.trim();
    if(status==='Needs correction'&&!reason){toast('Explain what the visitor needs to correct.','err');document.getElementById('documentReason'+index).focus();return;}
    button.disabled=true;
    try{const result=cache(await request('/appointments/'+encodeURIComponent(id)+'/documents/'+index,'PATCH',{status,reason,revision:a.revision}));const updated=document.createElement('div');updated.innerHTML=documentReviewHtml(result.appointment,true);button.closest('.document-review-item').replaceWith(updated.querySelectorAll('.document-review-item')[index]);toast('Document review saved.','ok');}
    catch(e){toast(escapeHtml(e.message),'err');if(e.status===409){try{cache(await request('/appointments'));}catch{}}}
    finally{button.disabled=false;}
  };
  window.SharedAppointments={request,cache,verify,visitorRequest,ensureEmail};
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
          const updated=cache(await request('/appointments/visit/'+encodeURIComponent(a.visitId)));
          showPassModalReadonly(updated.appointment,true);
        },{purpose:'cancellation',email:a.email});
      }
    }catch(e){toast(escapeHtml(e.message),'err');}
  };
  if(typeof visitorView==='undefined') {
    const originalCalendar=renderCalendar;
    renderCalendar=async function(){try{cache(await request('/appointments'));if(state_view==='calendar')originalCalendar();}catch(e){toast(escapeHtml(e.message),'err');}};
    const originalServices=renderServicesManage;
    renderServicesManage=async function(){try{await services();if(state_view==='services')originalServices();}catch(e){toast(escapeHtml(e.message),'err');}};
    async function records() {
      const result=await request('/service-records'),db=loadDB();
      db.transactions=db.transactions.filter(t=>!t.shared && !result.transactions.some(s=>s.id===t.id||s.visitId&&s.visitId===t.visitId)).concat(result.transactions);
      db.visitorLog=db.visitorLog.filter(l=>!l.shared && !result.visitorLog.some(s=>s.id===l.id||s.visitId&&s.visitId===l.visitId)).concat(result.visitorLog);
      (window.SecureState?SecureState.persist(snapshot(db)):localStorage.setItem(DB_KEY,JSON.stringify(snapshot(db))));
    }
    SharedAppointments.reloadRecords=records;
    const oldLock=lockConfTxn;lockConfTxn=function(id){const hadAccess=confUnlocked.has(id);privateRecords.delete(id);attachmentCache.delete(id);oldLock(id);if(hadAccess){const db=loadDB(),record=db.transactions.find(t=>t.id===id);logActivity(db,currentUser,'Confidential record relocked',{category:'Confidential',target:record?.code||id});saveDB(db);}};
    const originalTransactions=renderTransactions, originalLog=renderVisitorLogbook;
    const originalDashboard=renderDashboard;
    renderDashboard=async function(){try{await Promise.all([records(),request('/appointments').then(cache),loadSharedQueue()]);if(state_view==='dashboard')originalDashboard();}catch(e){toast(escapeHtml(e.message),'err');}};
    const originalReports=renderReports;
    renderReports=async function(){try{await Promise.all([records(),request('/appointments').then(cache)]);if(state_view==='reports')await originalReports();}catch(e){toast(escapeHtml(e.message),'err');}};
    renderTransactions=async function(){try{await records();if(state_view==='transactions')originalTransactions();}catch(e){toast(escapeHtml(e.message),'err');}};
    renderVisitorLogbook=async function(keep){try{await records();if(state_view==='logbook')originalLog(keep);}catch(e){toast(escapeHtml(e.message),'err');}};
    handleCompleteQueue=async function(id){
      try{cache(await request('/queue/'+encodeURIComponent(id),'PATCH',{status:'Completed'}));await records();await renderQueueDashboard();renderSidebar();toast('Visit completed and logged.','ok');}catch(e){toast(escapeHtml(e.message),'err');}
    };
    const original=renderAppointments;
    renderAppointments=async function(keep){try{cache(await request('/appointments'));if(state_view==='appointments')original(keep);}catch(e){toast(escapeHtml(e.message),'err');}};
    adminCheckInAppointment=async function(id){
      const a=loadDB().appointments.find(a=>a.id===id);
      if(!a?.shared){toast('This legacy appointment must be migrated before check-in.','err');return;}
      try{cache(await request('/appointments/'+encodeURIComponent(id)+'/check-in','POST',{}));closeModal();await renderAppointments(true);renderSidebar();toast('Checked in.','ok');}catch(e){toast(escapeHtml(e.message),'err');}
    };
  } else {
    refreshAppointmentPass=async function(){
      const id=sessionStorage.getItem('oss_activeAppointmentId'),a=loadDB().appointments.find(a=>a.id===id);
      if(!a?.shared)return;
      try{const result=await visitorRequest('/appointments/visit/'+encodeURIComponent(a.visitId));if(result)showPassModalReadonly(result.appointment,true);}catch(e){toast(escapeHtml(e.message),'err');}
    };
    const originalLookup=lookupMyVisit;
    lookupMyVisit=async function(){
      const code=normVisitRef(document.getElementById('cvInput').value).replace(/[^A-Z0-9]/g,'').replace(/^VIS/,'VIS-');
      if(!code){visitorFormError('Enter your Visit ID.','visitorLookupError');return;}
      try{const result=await visitorRequest('/appointments/visit/'+encodeURIComponent(code));if(!result)return;if(result.queue){myActiveQueueId=result.queue.id;persistSession();renderQueueTicket();}else showPassModalReadonly(result.appointment,true);}
      catch(e){if(e.status===404)await originalLookup();else visitorFormError(escapeHtml(e.message),'visitorLookupError');}
    };
  }
})();
