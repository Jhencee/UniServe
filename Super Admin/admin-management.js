// Database-backed Admin Management authenticated by the current login token.
let adminManagementBusy = false;
async function adminRequest(path = '', method = 'GET', data) {
  const response = await fetch((globalThis.UniServeConfig?.apiBase||'http://127.0.0.1:8000/api')+'/admins' + path, {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + (loadSession().token || '') },
    ...(data === undefined ? {} : { body: JSON.stringify(data) })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(Object.values(result.errors || {}).flat().join(' ') || result.message || 'Account action failed.');
  return result;
}
function cacheAdmins(users) {
  const db = loadDB();
  db.users = db.users.filter(user => user.role === 'SUPER_ADMIN').concat(users);
  saveDB(db);
}
async function refreshAdmins() {
  cacheAdmins((await adminRequest()).users);
  if (state_view === 'users' && document.getElementById('userBody')) renderUserTable();
}
async function renderUsers() {
  document.getElementById('content').innerHTML = `<div class="card">
    <div class="card-head"><div><h3>Admin Accounts</h3><div class="desc">Create and manage OSS Admin accounts</div><div class="desc" id="confSummary"></div></div>
    <button class="btn btn-primary btn-sm" onclick="openUserForm()">${icon('plus', 14)} Add Admin</button></div>
    <div id="adminLoadError" class="err-box" hidden></div>
    <div class="table-wrap"><table><thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Role</th><th>Confidential Access</th><th>Status</th><th>Action</th></tr></thead><tbody id="userBody"><tr><td colspan="7">Loading accounts...</td></tr></tbody></table></div></div>`;
  try { await refreshAdmins(); }
  catch (_) {
    if (state_view !== 'users') return;
    document.getElementById('userBody').innerHTML = '<tr><td colspan="7">Unable to load accounts.</td></tr>';
    const error = document.getElementById('adminLoadError');
    error.hidden = false;
    error.innerHTML = 'Cannot load accounts. Start MySQL and the backend server. <button class="btn btn-sm" onclick="renderUsers()">Retry</button>';
  }
}
function renderUserTable() {
  const users = loadDB().users;
  document.getElementById('userBody').innerHTML = users.map(user => `<tr>
    <td>${escapeHtml(user.fullName)}</td><td>${escapeHtml(user.username)}</td><td>${escapeHtml(user.email || '—')}</td>
    <td>${user.role === 'ADMIN' ? (user.confidentialApprover ? 'Head Admin' : 'Admin') : (ROLES[user.role]?.label || 'Admin')}</td><td>${user.role === 'ADMIN' ? (user.confidentialApprover ? 'Approver' : user.confidentialAccess ? 'Authorized' : 'No access') : 'Not applicable'}</td>
    <td>${user.active ? 'Active' : 'Disabled'}</td><td class="act-cell">${user.role === 'ADMIN' ? `<button class="icon-btn kebab-btn" title="Account actions" aria-haspopup="true" onclick="toggleKebab(event,'${user.id}')">${icon('dots', 16)}</button>
    <div class="kebab-menu" id="kebab_${user.id}" hidden>
      <button class="kebab-item" onclick="closeKebabs();openEditUserModal('${user.id}')">Edit Account</button>
      <button class="kebab-item" onclick="closeKebabs();openConfAccessModal('${user.id}')">Confidential Access</button>
      <button class="kebab-item" onclick="closeKebabs();openConfApproverModal('${user.id}')">${user.confidentialApprover ? 'Remove' : 'Designate'} Head Admin</button>
      <button class="kebab-item" onclick="closeKebabs();openResetAdminPassword('${user.id}')">Reset Password</button>
      <button class="kebab-item" onclick="closeKebabs();toggleUser('${user.id}')">${user.active ? 'Deactivate' : 'Activate'}</button>
      <button class="kebab-item" onclick="closeKebabs();deleteUser('${user.id}')">Remove</button>
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
  } catch (error) { toast(escapeHtml(error instanceof TypeError ? 'Cannot reach the backend server.' : error.message), 'err'); }
  finally {
    adminManagementBusy = false;
    modal?.querySelectorAll('.modal-foot button').forEach(button => button.disabled = false);
  }
}
function accountById(id) { return loadDB().users.find(user => user.id === id && user.role === 'ADMIN'); }
function openConfApproverModal(id) {
  const user=accountById(id); if(!user)return;
  openModal('Head Admin', `<p>${escapeHtml(user.fullName)}</p><p class="field-hint">${user.confidentialApprover ? 'Change this account to Admin. It will no longer manage services, assign cases, or approve access requests.' : 'Designate this account as Head Admin to manage services, assign confidential cases, and approve access requests. This also grants Confidential access; record details still require assignment or approval.'}</p>`,[
    {label:'Cancel',cls:'btn-ghost',action:closeModal},
    {label:user.confidentialApprover?'Change to Admin':'Designate Head Admin',cls:'btn-primary',action:()=>saveAdminAction(id,{confidentialApprover:!user.confidentialApprover},`${user.confidentialApprover?'Removed':'Designated'} access approver ${user.username}`)}
  ]);
}
function openUserForm() { openAdminForm(null); }
function openEditUserModal(id) { const user = accountById(id); if (user) openAdminForm(user); }
function accountCapital(value) { return value.replace(/(^|[\s-])([\p{L}])/gu, (_,gap,letter)=>gap+letter.toLocaleUpperCase()); }
function capitalizeAccountInput(input) { const start=input.selectionStart,end=input.selectionEnd; input.value=accountCapital(input.value); if(start!==null)input.setSelectionRange(start,end); }
function toggleAccountPassword(id,button) { const input=document.getElementById(id),show=input.type==='password';input.type=show?'text':'password';button.setAttribute('aria-pressed',String(show));button.setAttribute('aria-label',show?'Hide password':'Show password');button.innerHTML=icon(show?'eye-off':'eye',17); }
function openAdminForm(user) {
  const parts=(user?.fullName||'').trim().split(/\s+/),first=parts.shift()||'',last=parts.join(' ');
  openModal(user ? 'Edit Admin Account' : 'Add Admin Account', `
    <div class="form-row"><div class="field"><label for="mUsFirst">First Name</label><input id="mUsFirst" autocomplete="given-name" maxlength="60" oninput="capitalizeAccountInput(this)" value="${escapeHtml(first)}"></div><div class="field"><label for="mUsLast">Last Name</label><input id="mUsLast" autocomplete="family-name" maxlength="60" oninput="capitalizeAccountInput(this)" value="${escapeHtml(last)}"></div></div>
    <div class="form-row">
      <div class="field"><label for="mUsUser">Username</label><input id="mUsUser" oninput="capitalizeAccountInput(this)" autocomplete="off" maxlength="50" value="${escapeHtml(user?.username || '')}"></div>
      <div class="field"><label for="mUsEmail">Email</label><input id="mUsEmail" type="email" autocomplete="email" maxlength="120" value="${escapeHtml(user?.email || '')}"></div>
    </div>
    ${user ? '' : `<div class="field"><label for="mUsPass">Temporary Password</label><div class="account-password-input"><input id="mUsPass" type="password" autocomplete="new-password" minlength="12" maxlength="72" aria-describedby="mUsPassHint"><button type="button" class="account-pass-toggle" aria-label="Show password" aria-pressed="false" onclick="toggleAccountPassword('mUsPass',this)">${icon("eye",17)}</button></div><div class="field-hint" id="mUsPassHint">At least 12 characters with uppercase and lowercase letters, a number, and a special character.</div></div><div class="field account-access"><label for="mUsConf"><input id="mUsConf" type="checkbox" aria-describedby="mUsConfHint"> Confidential access</label><div class="field-hint" id="mUsConfHint">Allow this Admin to open confidential records.</div></div>`}`, [
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
  openModal('Handle confidential visits', `<p>${escapeHtml(user.fullName)}: ${user.confidentialAccess ? 'Authorized' : 'No access'}</p>
    ${user.confidentialAccess ? '' : reasonSelectHtml('mCaReason',['Assigned to confidential cases','Covering for another authorized Admin','Official case review','Authorized audit or compliance'],200)}
    <div class="field"><label>Super Admin Password</label><input id="mCaPass" type="password" autocomplete="current-password"></div>`, [
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
  } catch (_) { toast('Cannot reach the backend server.', 'err'); return; }
  let reason='';
  try { if(on) reason=readSelectedReason('mCaReason'); } catch(error) { toast(escapeHtml(error.message),'err'); return; }
  if (on && reason.length < 5) { toast('Add a short reason for granting access.', 'err'); return; }
  return saveAdminAction(id, { confidentialAccess: on }, `${on ? 'Granted' : 'Revoked'} Confidential access for ${id}${reason ? ': ' + reason : ''}`);
}
function toggleUser(id) {
  const user = accountById(id); if (!user) return;
  openModal(user.active ? 'Deactivate Admin Account' : 'Activate Admin Account', `<p>${escapeHtml(user.fullName)} (${escapeHtml(user.username)})</p><p>${user.active ? 'This account will no longer be able to sign in or use existing sessions.' : 'This account will be allowed to sign in again.'}</p>`, [
    { label: 'Cancel', cls: 'btn-ghost', action: closeModal },
    { label: user.active ? 'Deactivate' : 'Activate', cls: user.active ? 'btn-danger-o' : 'btn-primary', action: () => saveAdminAction(id, { active: !user.active }, `${user.active ? 'Deactivated' : 'Activated'} account ${user.username}`) }
  ]);
}
function deleteUser(id) {
  const user = accountById(id); if (!user) return;
  openModal('Remove Admin Account', `<p>Remove ${escapeHtml(user.fullName)} (${escapeHtml(user.username)})? This account will no longer be able to sign in.</p>`, [
    { label: 'Cancel', cls: 'btn-ghost', action: closeModal },
    { label: 'Remove Account', cls: 'btn-danger-o', action: () => saveAdminAction(id, undefined, `Removed Admin account ${user.username}`, true) }
  ]);
}
function openResetAdminPassword(id) {
  const user = accountById(id); if (!user) return;
  openModal('Reset Admin Password', `<p>${escapeHtml(user.fullName)}</p><div class="field"><label>New Temporary Password</label><div class="account-password-input"><input id="mResetPass" type="password" autocomplete="new-password" minlength="12" maxlength="72" aria-describedby="mResetPassHint"><button type="button" class="account-pass-toggle" aria-label="Show password" aria-pressed="false" onclick="toggleAccountPassword('mResetPass',this)">${icon("eye",17)}</button></div><div class="field-hint" id="mResetPassHint">At least 12 characters with uppercase and lowercase letters, a number, and a special character.</div></div>`, [
    { label: 'Cancel', cls: 'btn-ghost', action: closeModal },
    { label: 'Reset Password', cls: 'btn-primary', action: () => saveAdminAction(id, { password: document.getElementById('mResetPass').value }, `Reset password for ${user.username}`) }
  ]);
}
