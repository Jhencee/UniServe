/* Security responses stay in memory; secrets and recovery codes are never cached. */
function confirmSuperAction(action) {
  openModal('Confirm your password','<div class="field"><label for="securityConfirmPassword">Super Admin password</label><input id="securityConfirmPassword" type="password" autocomplete="current-password"></div><p id="securityConfirmError" class="field-hint" role="alert"></p>',[
    {label:'Cancel',cls:'btn-ghost',action:closeModal},
    {label:'Continue',cls:'btn-primary',action:async()=>{
      const error=document.getElementById('securityConfirmError');
      try { await UniServeUX.request('/password/confirm','POST',{password:document.getElementById('securityConfirmPassword').value});closeModal();await action(); }
      catch(e){if(error.isConnected)error.textContent=e.message;else toast(e.message,'err');}
    }}
  ]);
}
async function openSecuritySessions() {
  try {
    const data=await UniServeUX.request('/security/sessions');
    const sessions=[...data.sessions].sort((a,b)=>Number(b.current)-Number(a.current));
    openModal('Active sessions',`<div class="security-session-dialog"><p class="field-hint">Sign out of sessions you no longer use.</p><ul class="security-session-list">${sessions.map(s=>`<li><div><strong>${s.current?'This session':'Other session'}</strong><span>Signed in ${escapeHtml(oversightDate(s.started))}</span></div>${s.current?'<span class="security-session-current">Current</span>':`<button type="button" class="security-session-signout" data-revoke-session="${escapeHtml(s.id)}">Sign out</button>`}</li>`).join('')||'<li>No active sessions found.</li>'}</ul><p class="security-session-note">Signing out ends access for that session. Your current session stays signed in.</p></div>`,[{label:'Close',cls:'btn-ghost',action:closeModal}]);
    document.querySelectorAll('[data-revoke-session]').forEach(b=>b.addEventListener('click',()=>confirmSuperAction(async()=>{await UniServeUX.request('/security/sessions','DELETE',{id:b.dataset.revokeSession});await openSecuritySessions();})));
  }catch(e){toast(e.message,'err');}
}
async function openSecurityMfa() {
  try {
    const data=await UniServeUX.request('/security/mfa');
    if(data.enabled){
      confirmSuperAction(async()=>openModal('Disable two-step sign-in','<p class="field-hint">Enter a new authenticator code or an unused recovery code.</p><div class="field"><label for="disableMfaCode">Code</label><input id="disableMfaCode" autocomplete="one-time-code"></div><p id="mfaError" class="field-hint" role="alert"></p>',[{label:'Cancel',cls:'btn-ghost',action:closeModal},{label:'Disable',cls:'btn-danger-o',action:async()=>{try{await UniServeUX.request('/security/mfa','POST',{action:'disable',code:document.getElementById('disableMfaCode').value.trim()});endSession('Two-step sign-in disabled. Please sign in again.');}catch(e){document.getElementById('mfaError').textContent=e.message;}}}]));
    }else confirmSuperAction(async()=>{
      const setup=await UniServeUX.request('/security/mfa','POST',{action:'setup'});
      openModal('Set up two-step sign-in',`<p class="field-hint">Add an account in your authenticator app. Choose a time-based code and enter this setup key manually. Account name: UniServe.</p><p class="security-setup-key">${escapeHtml(setup.secret)}</p><div class="field"><label for="enableMfaCode">Six-digit authenticator code</label><input id="enableMfaCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6"></div><p id="mfaError" class="field-hint" role="alert"></p>`,[{label:'Cancel',cls:'btn-ghost',action:closeModal},{label:'Enable',cls:'btn-primary',action:async()=>{
        try {const result=await UniServeUX.request('/security/mfa','POST',{action:'enable',code:document.getElementById('enableMfaCode').value.trim()});if(result.token){const session=JSON.parse(sessionStorage.getItem('ossuniserve_session')||'{}');session.token=result.token;sessionStorage.setItem('ossuniserve_session',JSON.stringify(session));}openModal('Save your recovery codes',`<p>Keep these codes securely outside UniServe. Each code works once if you lose your authenticator. They will not be shown again.</p><pre class="security-recovery-codes">${result.recoveryCodes.map(escapeHtml).join('\n')}</pre>`,[{label:'I saved my codes — sign in again',cls:'btn-primary',action:()=>endSession('Two-step sign-in enabled. Please sign in again.')}]);}
        catch(e){document.getElementById('mfaError').textContent=e.message;}
      }}]);
    });
  }catch(e){
    const needsUpdate=e.status===503||e.status===404;
    openModal('Two-step sign-in unavailable',`<div class="security-setup-notice"><p>${needsUpdate?'Your server needs an update before you can set up two-step sign-in.':'We could not load your sign-in security settings.'}</p><p class="field-hint">${needsUpdate?'Update the backend and apply its database migration, then try again.':'Check your connection and try again.'}</p></div>`,[{label:'Close',cls:'btn-ghost',action:closeModal},{label:'Try again',cls:'btn-primary',action:()=>{closeModal();openSecurityMfa();}}]);
  }
}
function sendSystemTestEmail() {
  confirmSuperAction(async()=>{const result=await UniServeUX.request('/system/test-email','POST',{}, {signal:AbortSignal.timeout(30000)});openModal('Check your inbox',`<p>${escapeHtml(result.message)}</p><p>Reference: <strong>${escapeHtml(result.reference)}</strong></p><p class="field-hint">A successful send does not prove inbox delivery. Match this reference in your email.</p>`,[{label:'Close',cls:'btn-ghost',action:closeModal}]);});
}
