// Server-backed case assignment and temporary approvals, using existing controls.
(function () {
  let accessData = null;
  let confidentialPrintRecord = null;
  const assignments = new Map();
  function accessTime(value){const date=new Date(value.includes('T')?value:value.replace(' ','T')+'Z');const options={timeZone:'Asia/Manila'};return date.toLocaleDateString('en-CA',options)+' &middot; '+date.toLocaleTimeString('en-PH',{...options,hour:'numeric',minute:'2-digit',second:'2-digit',hour12:true});}
  const reasons = ['Case review', 'Follow-up on an assigned case', 'Requested by the student or requestor', 'Official referral or endorsement', 'Audit or compliance', 'Prepare an authorized report', 'Other'];
  const api = (path = '', method = 'GET', data) => UniServeUX.request('/confidential' + path, method, data);
  maskName = () => 'Restricted record';
  setInterval(async () => {
    for (const id of confUnlocked.keys()) {
      try {await api('/cases/'+encodeURIComponent(id)+'/status');}
      catch (_) {lockConfTxn(id);if(id.startsWith('appointment:')&&state_view==='appointments')await renderAppointments(true);}
    }
  }, 10000);
  async function register(record) {
    await api('/cases', 'POST', { id: record.id, code: record.code });
  }
  window.openConfidentialAccess = async function () {
    try {
      accessData = await api();
      const records = loadDB().transactions.filter(isConfidentialTxn);
      if(currentUser.confidentialAccess)for (const record of records) await register(record);
      accessData = await api();
      document.getElementById('content').innerHTML = `<div class="card"><div class="card-head"><div><h3>Confidential Access</h3><div class="desc">Case assignments and temporary access approvals</div></div><button class="home-back-arrow btn btn-ghost btn-sm back-to-transactions" onclick="renderTransactions()" aria-label="Back to transactions" title="Back to transactions"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 5-7 7 7 7M5 12h14"/></svg></button></div>
        <div class="confidential-access-tabs"><h4 class="my-requests-heading">My Requests</h4></div><div id="confidentialAccessBody"></div></div>`;
      paintConfidentialRequests();
    } catch (error) { toast(escapeHtml(error.message), 'err'); }
  };
  window.openApprovedAccessRequest=async function(id){
    try{
      accessData=await api();
      const request=accessData.requests.find(r=>r.id===id&&r.requester_id===currentUser.id);
      if(!request||request.status!=='Approved'||!request.expires_at||new Date(request.expires_at.replace(' ','T')+'Z')<=new Date())throw Error('This approval expired or was revoked.');
      await openRequestRecord(id,'view');
    }catch(e){toast(escapeHtml(e.message),'err');}
  };
  function accessMenu(id,items){const icons={'View request':'eye','Review':'checkin','Revoke access':'x','Unlock':'lock','Print':'print'};return `<button class="icon-btn kebab-btn" aria-label="Record actions" aria-haspopup="true" onclick="toggleKebab(event,'${id}')">${icon('dots',16)}</button><div class="kebab-menu" id="kebab_${id}" hidden>${items.map(([label,action,disabled])=>`<button class="kebab-item" ${disabled?'disabled title="Valid approval is required; printing also requires View and Print permission."':''} onclick="closeKebabs();${action}">${icon(icons[label]||'log',14)} ${label}</button>`).join('')}</div>`;}
  function requestActions(r){
    const approved=r.status==='Approved'&&r.expires_at&&new Date(r.expires_at.replace(' ','T')+'Z')>new Date();
    const items=[];
    if(r.requester_id===currentUser.id){
      items.push(['Unlock',`openRequestRecord('${r.id}','view')`,!approved]);
      if(!r.case_id.startsWith('appointment:'))items.push(['Print',`openRequestRecord('${r.id}','print')`,!approved||r.scope!=='print']);
    }
    return items.length?accessMenu('access_'+r.id,items):'&mdash;';
  }
  window.requestTransactionAccess=function(id){const record=loadDB().transactions.find(t=>t.id===id);if(record)requestConfidentialAccess(record,'view');};
  window.viewAccessRequest=function(id){const r=accessData.requests.find(item=>item.id===id);if(!r)return;const expired=r.status==='Approved'&&r.expires_at&&new Date(r.expires_at.replace(' ','T')+'Z')<=new Date();openModal('Access request',`<div class="access-request-summary"><strong>${escapeHtml(r.requester_name)}</strong><div class="access-request-meta"><span class="mono">${escapeHtml(r.code)}</span>${statusPill(expired?'Expired':r.status)}</div><div class="access-request-reason"><span>Reason</span><p>${escapeHtml(r.reason)}</p></div></div><div class="kv"><span>Access</span><span>${r.scope==='print'?'View and Print':'View'}</span></div><div class="kv"><span>Expires</span><span>${r.expires_at?accessTime(r.expires_at):'&mdash;'}</span></div>${r.decision_note?`<p class="field-hint">${escapeHtml(r.decision_note)}</p>`:''}`,[{label:'Done',cls:'btn-ghost',action:closeModal}]);};
  window.openRequestRecord=async function(id,action){const request=accessData.requests.find(r=>r.id===id);if(!request)return;try{if(request.case_id.startsWith('appointment:')){const appointmentId=request.case_id.slice(12);const record={id:request.case_id,code:request.code,service:'concern'};await requireConfUnlock(record,async()=>{navigate('appointments');await renderAppointments(true);const appointment=loadDB().appointments.find(a=>a.id===appointmentId);if(appointment&&!appointment.restricted)openApptDetail(appointmentId,true);},'view');return;}await SharedAppointments.reloadRecords();const record=loadDB().transactions.find(t=>t.id===request.case_id);if(!record)throw Error('Record unavailable. Refresh transactions and try again.');if(action==='request')requestConfidentialAccess(record,request.scope);else if(action==='print'){if(request.scope==='print')printTransaction(record.id);else requestConfidentialAccess(record,'print');}else openTxnDetail(record.id);}catch(e){toast(escapeHtml(e.message),'err');}};
  window.isAssignedConfidentialRecord=function(id){return accessData?.cases?.some(c=>c.id===id&&c.assigned_admin_id===currentUser.id)||false;};
  function selectAccessTab(index){document.querySelectorAll(".confidential-access-tabs button").forEach((button,i)=>{button.classList.toggle("active",i===index);button.setAttribute("aria-selected",String(i===index));});}
  window.paintConfidentialRequests = function () {
    if (!accessData || !document.getElementById('confidentialAccessBody')) return;
    selectAccessTab(0);
    document.getElementById('confidentialAccessBody').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Record</th><th>Admin</th><th>Access</th><th>Reason</th><th class="access-status-column">Status</th><th>Expires</th><th class="appointment-action-heading">Actions</th></tr></thead><tbody>${accessData.requests.map(r => `<tr><td>${escapeHtml(r.code)}</td><td>${escapeHtml(r.requester_name)}</td><td>${r.scope==='print'?'View and Print':'View'}</td><td>${escapeHtml(r.reason)}${r.decision_note ? `<div class="muted">${escapeHtml(r.decision_note)}</div>` : ''}</td><td class="access-status-column">${statusPill(r.status === 'Approved' && new Date(r.expires_at.replace(' ', 'T') + 'Z') < new Date() ? 'Expired' : r.status)}</td><td>${r.expires_at ? accessTime(r.expires_at) : '&mdash;'}</td><td class="act-cell appointment-action-cell">${requestActions(r)}</td></tr>`).join('') || '<tr class="empty-row"><td colspan="7">No access requests.</td></tr>'}</tbody></table></div>`;
  };
  window.requestConfidentialAccess = function(record, scope) {
    openModal('Request access', `<p class="field-hint">${scope==='print'?'Print access is locked. Super Admin approval for View and Print is required.':'This confidential record is locked.'}</p><p class="field-hint">Record: <strong>${escapeHtml(record.code)}</strong></p><div class="field"><label for="confRequestReason">Reason for access</label><select id="confRequestReason" onchange="toggleRequestOther(this)"><option value="">Select a reason</option>${reasons.map(reason=>`<option value="${escapeHtml(reason)}">${escapeHtml(reason)}</option>`).join('')}</select></div><div class="field" id="confRequestOtherField" hidden><label for="confRequestOther">Explain your reason <span class="req">*</span></label><textarea id="confRequestOther" rows="2" maxlength="350" placeholder="Why do you need access?"></textarea></div><p class="field-hint">Super Admin will review your request.</p>`,[
      {label:'Cancel',cls:'btn-ghost',action:closeModal},
      {label:'Send request',cls:'btn-primary',action:async()=>{
        try {let reason=document.getElementById('confRequestReason').value;if(!reason)throw Error('Select a reason for access.');if(reason==='Other'){const explanation=document.getElementById('confRequestOther').value.trim();if(explanation.length<5)throw Error('Explain your reason with at least 5 characters.');reason='Other: '+explanation;}await api('/requests','POST',{caseId:record.id,scope:scope==='print'?'print':'view',reason});closeModal();toast('Request sent to Super Admin.','ok');}catch(e){toast(escapeHtml(e.message),'err');}
      }}
    ]);
  };
  window.toggleRequestOther=function(select){const other=select.value==='Other';document.getElementById('confRequestOtherField').hidden=!other;document.getElementById('confRequestOther').required=other;};
  window.unlockVisitorLogEntry=function(id){
    const record=loadDB().transactions.find(t=>t.id===id);
    if(!record){toast('The linked confidential case is unavailable. Refresh the Visitor Log.','err');return;}
    requireConfUnlock(record,async()=>{await SharedAppointments.reloadRecords();if(state_view==='logbook')await renderVisitorLogbook(true);},'view');
  };
  window.requireConfUnlock = async function(record, onOk, scope='view') {
    if (!record.id.startsWith('appointment:') && !isConfidentialTxn(record)) {onOk();return;}
    const report=record.id.startsWith('rpt:')||record.id.startsWith('svc:');
    if(report){toast('Print confidential records individually after approval.','err');return;}
    try{await api('/cases/'+encodeURIComponent(record.id)+'/status?scope='+encodeURIComponent(scope));}catch(e){if(e.status===403){requestConfidentialAccess(record,scope);return;}toast(escapeHtml(e.message),'err');return;}
    openModal((scope==='print'?'Unlock print access: ':'Unlock ')+escapeHtml(record.code), `<p class="field-hint">${scope==='print'?'Print access is locked. Your permission is valid; enter your password to unlock and print.':'Access granted. Enter your password to open this record.'}</p><div class="field"><label for="confPassword">Your password</label><div class="profile-password-input"><input id="confPassword" type="password" autocomplete="current-password"><button type="button" class="profile-pass-toggle" aria-label="Show password" aria-pressed="false" onclick="toggleProfilePassword('confPassword',this)">${profilePasswordEye(true)}</button></div></div>`,[
      {label:'Cancel',cls:'btn-ghost',action:closeModal},
      {label:'Unlock',cls:'btn-primary',action:async()=>{
        try {const result=await api('/cases/'+encodeURIComponent(record.id)+'/unlock','POST',{password:document.getElementById('confPassword').value,reason:'Open record with granted access',scope});assignments.set(record.id,result.assignedAdmin || 'Unassigned');confUnlocked.set(record.id,new Date(result.expiresAt).getTime());clearTimeout(confTimers[record.id]);confTimers[record.id]=setTimeout(()=>{lockConfTxn(record.id);if(record.id.startsWith('appointment:')&&state_view==='appointments')renderAppointments(true);},Math.max(0,new Date(result.expiresAt)-Date.now()));closeModal();await onOk();}catch(e){toast(escapeHtml(e.message),'err');}
      }}
    ]);
  };
  api().then(data=>{accessData=data;if(state_view==='transactions'&&document.getElementById('txnBody'))renderTxnTable();}).catch(()=>{});
  const originalCard = renderTxnCard;
  renderTxnCard = function(keep) {
    originalCard(keep);
    const nav=document.getElementById('txnStatusNav');
    if(nav){const button=document.createElement('button');button.textContent='Confidential Access';button.onclick=openConfidentialAccess;nav.appendChild(button);}
  };
  const originalDetail = openTxnDetail;
  openTxnDetail = function(id) {const r=loadDB().transactions.find(t=>t.id===id);if(isConfidentialTxn(r)) requireConfUnlock(r,async()=>{
    if(r.shared)await SharedAppointments.reloadRecords();
    originalDetail(id);
    const body=document.querySelector('#activeModal .modal-body');
    if(body){const assignment=document.createElement('div');assignment.className='kv';const label=document.createElement('span');label.textContent='Assigned Admin';const value=document.createElement('span');value.textContent=assignments.get(id)||'Unassigned';assignment.append(label,value);body.prepend(assignment);}
  });else originalDetail(id);};
  const originalPrint = printTransaction;
  const originalVisitorLogPrint=printVisitorLog;
  printVisitorLog=function(){
    const db=loadDB(),entries=logbookRows(db,true),ids=[...new Set(entries.map(r=>r.confidentialCaseId).filter(Boolean))];
    if(!ids.length&&!entries.some(r=>r.restricted)){originalVisitorLogPrint(false);return;}
    const buttons=[{label:'Print redacted copy',cls:'btn-primary',action:()=>{closeModal();originalVisitorLogPrint(false);}}];
    openModal('Print visitor log','<div class="log-print-options"><p>A redacted copy hides confidential names and personal details.</p></div>',buttons);
  };
  printTransaction = function(id) {const r=loadDB().transactions.find(t=>t.id===id);if(isConfidentialTxn(r)) requireConfUnlock(r,async()=>{
    if(r.shared)await SharedAppointments.reloadRecords();
    confidentialPrintRecord=r;
    try {originalPrint(id);} finally {confidentialPrintRecord=null;}
  },'print');else originalPrint(id);};
  const originalPrintInjected = printInjected;
  printInjected = function(html, report = false) {
    if (confidentialPrintRecord) {
      html += `<div class="doc-footnote">Confidential access: Unlocked for authorized printing &middot; ${escapeHtml(confidentialPrintRecord.code)} &middot; ${escapeHtml(currentUser.fullName)} &middot; ${escapeHtml(fmtDateTime(new Date()))}</div>`;
    }
    originalPrintInjected(html, report);
  };
})();
