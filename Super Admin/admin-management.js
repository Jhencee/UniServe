// Database-backed Admin Management authenticated by the current login token.
let adminManagementBusy = false;
async function adminRequest(path = '', method = 'GET', data) {
  const response = await fetch((globalThis.UniServeConfig?.apiBase||'http://127.0.0.1:8000/api')+'/admins' + path, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + (loadSession().token || '') },
    ...(data === undefined ? {} : { body: JSON.stringify(data) })
  });
  const result = await response.json();
  if (!response.ok) {const error=new Error(Object.values(result.errors || {}).flat().join(' ') || result.message || 'Account action failed.');error.status=response.status;throw error;}
  return result;
}
function cacheAdmins(users) {
  const db = loadDB();
  db.users = users;
  saveDB(db);
}
async function refreshAdmins() {
  cacheAdmins((await adminRequest()).users);
  if (state_view === 'users' && document.getElementById('userBody')) renderUserTable();
}
async function renderUsers() {
  document.getElementById('content').innerHTML = `<div class="card">
    <div class="card-head"><div><h3>Admin Accounts</h3><div class="desc">Create and manage OSS Admin accounts</div><div class="desc" id="confSummary"></div></div>
    <div class="admin-management-header-actions"><button class="btn btn-primary btn-sm" onclick="openUserForm()">${icon('plus', 14)} Add Admin</button></div></div>
    <details class="super-permissions-help"><summary>Roles and confidential access</summary><dl><dt>Admin</dt><dd>Handles visitor services within assigned permissions.</dd><dt>Super Admin</dt><dd>Grants confidential access and reviews case access requests.</dd><dt>Confidential access</dt><dd>Completed records still require assignment or approval and a password unlock.</dd></dl></details>
    <div id="adminLoadError" class="err-box" hidden></div>
    <div class="table-wrap"><table><thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Role</th><th>Confidential Access</th><th>Status</th><th>Action</th></tr></thead><tbody id="userBody"><tr><td colspan="7">Loading accounts...</td></tr></tbody></table></div></div>`;
  try { await refreshAdmins(); }
  catch (_) {
    if (state_view !== 'users') return;
    document.getElementById('userBody').innerHTML = '<tr><td colspan="7">Unable to load accounts.</td></tr>';
    const error = document.getElementById('adminLoadError');
    error.hidden = false;
    error.innerHTML = 'Cannot load accounts. Check your connection, staff session and API availability. <button class="btn btn-sm" onclick="renderUsers()">Retry</button>';
  }
}
function renderUserTable() {
  const users = loadDB().users;
  document.getElementById('userBody').innerHTML = users.map(user => `<tr>
    <td>${escapeHtml(user.fullName)}</td><td>${escapeHtml(user.username)}</td><td>${escapeHtml(user.email || '—')}</td>
    <td>${user.role === 'ADMIN' ? 'Admin' : (ROLES[user.role]?.label || 'Admin')}</td><td>${user.role === 'ADMIN' ? (user.confidentialAccess ? 'Authorized' : 'No access') : 'Not applicable'}</td>
    <td>${user.active ? 'Active' : 'Disabled'}</td><td class="act-cell super-account-actions">${user.role === 'ADMIN' ? `<button class="icon-btn kebab-btn" title="Account actions" aria-haspopup="true" onclick="toggleKebab(event,'${user.id}')">${icon('dots', 16)}</button>
    <div class="kebab-menu" id="kebab_${user.id}" hidden>
      <button class="kebab-item" onclick="closeKebabs();openEditUserModal('${user.id}')">${icon('edit',14)} Edit Account</button>
      <button class="kebab-item" onclick="closeKebabs();openConfAccessModal('${user.id}')">${icon('lock',14)} Confidential Access</button>
      ${user.active&&user.confidentialAccess?`<button class="kebab-item" onclick="closeKebabs();openConfidentialAssignment('${user.id}')">${icon('users',14)} Assign confidential case</button>`:''}
      <button class="kebab-item" onclick="closeKebabs();openResetAdminPassword('${user.id}')">${icon('lock',14)} Reset Password</button>
      <button class="kebab-item" onclick="closeKebabs();toggleUser('${user.id}')">${icon(user.active?'x':'check',14)} ${user.active ? 'Deactivate' : 'Activate'}</button>
      <button class="kebab-item" onclick="closeKebabs();deleteUser('${user.id}')">${icon('trash',14)} Remove</button>
    </div>` : `<button class="icon-btn" title="Manage in My Profile" aria-label="Manage in My Profile" onclick="navigate('profile')">${icon('userc', 16)}</button>`}</td></tr>`).join('');
  const admins = users.filter(user => user.role === 'ADMIN');
  document.getElementById('confSummary').textContent = `${admins.filter(user => user.confidentialAccess).length} of ${admins.length} Admins allowed to handle confidential visits; completed records still require an unlock`;
}
async function saveAdminAction(id, data, action, remove = false) {
  if(data?.password!==undefined && (data.password.length<12 || data.password.length>72 || !/[A-Z]/.test(data.password) || !/[a-z]/.test(data.password) || !/[0-9]/.test(data.password) || !/[^A-Za-z0-9\s]/.test(data.password))){toast('At least 12 characters with uppercase and lowercase letters, a number, and a special character.','err');return;}
  if (adminManagementBusy) return;
  adminManagementBusy = true;
  const modal = document.getElementById('activeModal');
  modal?.querySelectorAll('.modal-foot button').forEach(button => button.disabled = true);
  try {
    await adminRequest(id ? '/' + encodeURIComponent(id) : '', remove ? 'DELETE' : id ? 'PATCH' : 'POST', remove ? undefined : data);
    const db = loadDB();
    logActivity(db, currentUser, action, { category: 'Accounts', target: data?.username || id });
    saveDB(db);
    closeModal();
    try { await refreshAdmins(); }
    catch (_) { if (state_view === 'users') await renderUsers(); }
    toast('Account updated.', 'ok');
  } catch (error) { if(error.status===428){confirmSuperAction(()=>saveAdminAction(id,data,action,remove));return;} toast(escapeHtml(error instanceof TypeError ? 'Cannot connect to UniServe. Check your connection and try again.' : error.message), 'err'); }
  finally {
    adminManagementBusy = false;
    modal?.querySelectorAll('.modal-foot button').forEach(button => button.disabled = false);
  }
}
function accountById(id) { return loadDB().users.find(user => user.id === id && user.role === 'ADMIN'); }
function adminAccountSummary(user,status,statusClass='') {
  return `<div class="admin-account-summary"><div><span class="admin-account-label">Admin account</span><strong>${escapeHtml(user.fullName)}</strong></div><span class="admin-account-status ${statusClass}">${escapeHtml(status)}</span></div>`;
}
async function confidentialRequest(path='',method='GET',data) {
  const response=await fetch((globalThis.UniServeConfig?.apiBase||'http://127.0.0.1:8000/api')+'/confidential'+path,{method,headers:{Accept:'application/json','Content-Type':'application/json',Authorization:'Bearer '+(loadSession().token||'')},...(data?{body:JSON.stringify(data)}:{})});
  const result=await response.json();if(!response.ok)throw Error(result.message||'Unable to process confidential access.');return result;
}
async function openConfidentialRequests(){
  try{
    const data=await confidentialRequest();const requests=data.requests.filter(r=>r.status==='Pending'||(r.status==='Approved'&&r.expires_at&&new Date(r.expires_at.replace(' ','T')+'Z')>new Date()));
    openModal('Confidential access requests',requests.length?requests.map(r=>`<div class="field"><label><input type="checkbox" class="conf-request-choice" data-status="${escapeHtml(r.status)}" value="${escapeHtml(r.id)}"> ${escapeHtml(r.requester_name)} · ${escapeHtml(r.code)} · ${escapeHtml(r.scope)} · ${escapeHtml(r.status)}</label><p class="field-hint">${escapeHtml(r.reason)}</p></div>`).join('')+'<p class="field-hint">Approved access lasts 60 minutes. Select pending requests to approve or deny, or approved requests to revoke.</p>':'<p>No pending or active requests.</p>',[
      {label:'Close',cls:'btn-ghost',action:closeModal},...(requests.length?[{label:'Deny selected',cls:'btn-ghost',action:()=>reviewConfidentialRequests('Denied')},{label:'Revoke selected',cls:'btn-ghost',action:()=>reviewConfidentialRequests('Revoked')},{label:'Approve selected',cls:'btn-primary',action:()=>reviewConfidentialRequests('Approved')}]:[])
    ]);
  }catch(error){toast(escapeHtml(error.message),'err');}
}
async function reviewConfidentialRequests(decision){
  const selected=Array.from(document.querySelectorAll('.conf-request-choice:checked'));if(!selected.length){toast('Select at least one request.','err');return;}
  const required=decision==='Revoked'?'Approved':'Pending';if(selected.some(el=>el.dataset.status!==required)){toast(`Select only ${required.toLowerCase()} requests for this action.`,'err');return;}
  let changed=0;for(const el of selected){try{await confidentialRequest('/requests/'+encodeURIComponent(el.value),'PATCH',{decision,minutes:60});changed++;}catch(error){toast(escapeHtml(error.message),'err');}}
  toast(`${changed} of ${selected.length} requests ${decision.toLowerCase()}.`,changed===selected.length?'ok':'err');await openConfidentialRequests();
}
async function openConfidentialAssignment(adminId=''){
  try{
    const data=await confidentialRequest();const admins=loadDB().users.filter(u=>u.role==='ADMIN'&&u.active&&u.confidentialAccess),target=adminId?admins.find(u=>String(u.id)===String(adminId)):null;
    if(!data.cases.length||(!adminId&&!admins.length)){toast('An existing confidential case and an authorized active Admin are required.','err');return;}
    if(adminId&&!target){toast('This Admin must be active and authorized for confidential access before a case can be assigned.','err');return;}
    const assignedAdmin=target?`<p class="field-hint">Assigning a case to <strong>${escapeHtml(target.fullName)}</strong>.</p>`:'';
    const adminSelector=target?'':`<div class="field"><label for="confAdminSelect">Admin</label><select id="confAdminSelect">${admins.map(a=>`<option value="${escapeHtml(a.id)}">${escapeHtml(a.fullName)}</option>`).join('')}</select></div>`;
    openModal('Assign confidential case',`${assignedAdmin}<div class="field"><label for="confCaseSelect">Case</label><select id="confCaseSelect">${data.cases.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.code)}</option>`).join('')}</select></div>${adminSelector}`,[
      {label:'Cancel',cls:'btn-ghost',action:closeModal},{label:'Assign',cls:'btn-primary',action:async()=>{try{await confidentialRequest('/cases/'+encodeURIComponent(document.getElementById('confCaseSelect').value),'PATCH',{adminId:target?.id||document.getElementById('confAdminSelect').value});closeModal();toast('Case assigned.','ok');}catch(error){toast(escapeHtml(error.message),'err');}}}
    ]);
  }catch(error){toast(escapeHtml(error.message),'err');}
}
function openUserForm() { openAdminForm(null); }
function openEditUserModal(id) {
  const user=accountById(id);
  if(!user)return;
  openAdminForm(user);
  const target=document.getElementById('accountLastSignIn');
  if(!target)return;
  getSystemOversight().then(data=>{
    if(!target.isConnected)return;
    const account=data.accounts.find(a=>String(a.id)===String(id));
    target.textContent=account?(account.lastSignIn?oversightDate(account.lastSignIn):'No sign-in recorded'):'Sign-in history unavailable';
    if(account?.active&&account.reviewInactive)target.textContent+=' ? Over 90 days ago; check if this account is still needed.';
  }).catch(()=>{if(target.isConnected)target.textContent='Sign-in history unavailable';});
}
function accountCapital(value) { return value.replace(/(^|[\s-])([\p{L}])/gu, (_,gap,letter)=>gap+letter.toLocaleUpperCase()); }
function capitalizeAccountInput(input) { const start=input.selectionStart,end=input.selectionEnd; input.value=accountCapital(input.value); if(start!==null)input.setSelectionRange(start,end); }
function toggleAccountPassword(id,button) { const input=document.getElementById(id),show=input.type==='password';input.type=show?'text':'password';button.setAttribute('aria-pressed',String(show));button.setAttribute('aria-label',show?'Hide password':'Show password');button.innerHTML=profilePasswordEye(!show); }
function openAdminForm(user) {
  const parts=(user?.fullName||'').trim().split(/\s+/),first=parts.shift()||'',last=parts.join(' ');
  openModal(user ? 'Edit Admin Account' : 'Add Admin Account', `
    ${user ? '<div class="field"><label>Last recorded sign-in</label><p id="accountLastSignIn" class="field-hint" role="status">Loading sign-in history...</p></div>' : ''}
    <div class="form-row"><div class="field"><label for="mUsFirst">First Name</label><input id="mUsFirst" autocomplete="given-name" maxlength="60" oninput="capitalizeAccountInput(this)" value="${escapeHtml(first)}"></div><div class="field"><label for="mUsLast">Last Name</label><input id="mUsLast" autocomplete="family-name" maxlength="60" oninput="capitalizeAccountInput(this)" value="${escapeHtml(last)}"></div></div>
    <div class="form-row">
      <div class="field"><label for="mUsUser">Username</label><input id="mUsUser" oninput="capitalizeAccountInput(this)" autocomplete="off" maxlength="50" value="${escapeHtml(user?.username || '')}"></div>
      <div class="field"><label for="mUsEmail">Email</label><input id="mUsEmail" type="email" autocomplete="email" maxlength="120" value="${escapeHtml(user?.email || '')}"></div>
    </div>
    ${user ? '' : `<div class="field"><label for="mUsPass">Temporary Password</label><div class="account-password-input"><input id="mUsPass" type="password" autocomplete="new-password" minlength="12" maxlength="72" aria-describedby="mUsPassHint"><button type="button" class="account-pass-toggle" aria-label="Show password" aria-pressed="false" onclick="toggleAccountPassword('mUsPass',this)">${profilePasswordEye(true)}</button></div><div class="field-hint" id="mUsPassHint">At least 12 characters with uppercase and lowercase letters, a number, and a special character.</div></div><div class="field account-access"><label for="mUsConf"><input id="mUsConf" type="checkbox" aria-describedby="mUsConfHint"> Confidential access</label><div class="field-hint" id="mUsConfHint">Allow this Admin to open confidential records.</div></div>`}`, [
    { label: 'Cancel', cls: 'btn-ghost', action: closeModal },
    { label: user ? 'Save changes' : 'Create admin account', cls: 'btn-primary', action: () => {
      const firstName=accountCapital(document.getElementById('mUsFirst').value.trim()),lastName=accountCapital(document.getElementById('mUsLast').value.trim());
      if(!firstName||!lastName){toast('First name and last name are required.','err');return;}
      const data = { firstName,lastName,fullName: firstName+' '+lastName, username: accountCapital(document.getElementById('mUsUser').value.trim()), email: document.getElementById('mUsEmail').value.trim() || null };
      if (!data.fullName || !data.username) { toast('Name and username are required.', 'err'); return; }
      if (!document.getElementById('mUsEmail').checkValidity()) { toast('Enter a valid email.', 'err'); return; }
      if (!user) { data.password = document.getElementById('mUsPass').value; data.confidentialAccess = document.getElementById('mUsConf').checked; }
      return saveAdminAction(user?.id, data, `${user ? 'Updated' : 'Created'} Admin account ${data.username}`);
    } }
  ]);
}
function openConfAccessModal(id) {
  const user = accountById(id); if (!user) return;
  openModal('Handle confidential visits', `<div class="conf-access-form">${adminAccountSummary(user,user.confidentialAccess?'Authorized':'No access',user.confidentialAccess?'is-positive':'')}
    ${user.confidentialAccess ? '' : reasonSelectHtml('mCaReason',['Assigned to confidential cases','Covering for another authorized Admin','Official case review','Authorized audit or compliance'],200)}
    <div class="field"><label for="mCaPass">Confirm with Super Admin password</label><input id="mCaPass" type="password" autocomplete="current-password"><p class="field-hint">Required to change this Admin’s confidential access.</p></div></div>`, [
    { label: 'Cancel', cls: 'btn-ghost', action: closeModal },
    { label: user.confidentialAccess ? 'Remove Access' : 'Grant Access', cls: 'btn-primary', action: () => applyConfAccess(id, !user.confidentialAccess) }
  ]);
}
async function applyConfAccess(id, on) {
  try {
    const response = await fetch((globalThis.UniServeConfig?.apiBase||'http://127.0.0.1:8000/api')+'/password/confirm', {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization:'Bearer '+(loadSession().token||'') },
      body: JSON.stringify({ password: document.getElementById('mCaPass').value })
    });
    const result = await response.json();
    if (!response.ok || result.confirmed !== true) { toast('Incorrect Super Admin password.', 'err'); return; }
  } catch (_) { toast('Cannot connect to UniServe. Check your connection and try again.', 'err'); return; }
  let reason='';
  try { if(on) reason=readSelectedReason('mCaReason'); } catch(error) { toast(escapeHtml(error.message),'err'); return; }
  if (on && reason.length < 5) { toast('Add a short reason for granting access.', 'err'); return; }
  return saveAdminAction(id, { confidentialAccess: on }, `${on ? 'Granted' : 'Revoked'} Confidential access for ${id}${reason ? ': ' + reason : ''}`);
}
function toggleUser(id) {
  const user = accountById(id); if (!user) return;
  openModal(user.active ? 'Deactivate Admin Account' : 'Activate Admin Account', `${adminAccountSummary(user,user.active?'Active':'Disabled',user.active?'is-positive':'')}<p class="admin-action-copy">${user.active ? 'This account will no longer be able to sign in or use existing sessions.' : 'This account will be allowed to sign in again.'}</p>`, [
    { label: 'Cancel', cls: 'btn-ghost', action: closeModal },
    { label: user.active ? 'Deactivate' : 'Activate', cls: user.active ? 'btn-danger-o' : 'btn-primary', action: () => saveAdminAction(id, { active: !user.active }, `${user.active ? 'Deactivated' : 'Activated'} account ${user.username}`) }
  ]);
}
function deleteUser(id) {
  const user = accountById(id); if (!user) return;
  openModal('Remove Admin Account', `${adminAccountSummary(user,user.active?'Active':'Disabled',user.active?'is-positive':'')}<p class="admin-action-copy">This account will no longer be able to sign in.</p>`, [
    { label: 'Cancel', cls: 'btn-ghost', action: closeModal },
    { label: 'Remove Account', cls: 'btn-danger-o', action: () => saveAdminAction(id, undefined, `Removed Admin account ${user.username}`, true) }
  ]);
}
function openResetAdminPassword(id) {
  const user = accountById(id); if (!user) return;
  openModal('Reset Admin Password', `${adminAccountSummary(user,user.active?'Active':'Disabled',user.active?'is-positive':'')}<div class="field"><label>New Temporary Password</label><div class="account-password-input"><input id="mResetPass" type="password" autocomplete="new-password" minlength="12" maxlength="72" aria-describedby="mResetPassHint"><button type="button" class="account-pass-toggle" aria-label="Show password" aria-pressed="false" onclick="toggleAccountPassword('mResetPass',this)">${profilePasswordEye(true)}</button></div><div class="field-hint" id="mResetPassHint">At least 12 characters with uppercase and lowercase letters, a number, and a special character.</div></div>`, [
    { label: 'Cancel', cls: 'btn-ghost', action: closeModal },
    { label: 'Reset Password', cls: 'btn-primary', action: () => saveAdminAction(id, { password: document.getElementById('mResetPass').value }, `Reset password for ${user.username}`) }
  ]);
}
