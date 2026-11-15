/* Server evidence only. Never persist account/audit/health responses in browser storage. */
let oversightRequest = null;
let oversightGeneration = 0;
const oversightDate = value => value ? new Date(value).toLocaleString('en-PH', {timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}) : 'Not observed';
const oversightEscape = value => escapeHtml(String(value ?? ''));

async function getSystemOversight() {
  if (oversightRequest) return oversightRequest;
  oversightRequest = UniServeUX.request('/system/oversight');
  try { return await oversightRequest; } finally { oversightRequest = null; }
}
function oversightError(target, error, retry) {
  if (!target?.isConnected) return;
  const unavailable = error.status === 404 ? 'System checks are unavailable from the connected API. Check the API address and confirm the frontend and backend use matching releases.' : 'Could not load current server information. Check the API connection and your staff session.';
  target.innerHTML = `<div class="oversight-empty" role="status">${oversightEscape(unavailable)} <button type="button" class="analytics-link" onclick="${retry}()">Retry</button></div>`;
}
function oversightAlerts(data) {
  const alerts = [];
  if (data.security.failedOrDenied24h) alerts.push({title:`${data.security.failedOrDenied24h} failed or denied events`,note:'Last 24 hours. Review before deciding whether activity is suspicious.',page:'activitylog',action:'Review audit',auditReview:'failed'});
  if (data.security.structuralIssues) alerts.push({title:`${data.security.structuralIssues} audit structure issues`,note:'Recent records have an invalid changes field. This check does not prove tampering.',page:'activitylog',action:'Review records',auditReview:'structure'});
  const inactive = data.accounts.filter(a => a.reviewInactive).length;
  if (inactive) alerts.push({title:`${inactive} accounts need inactivity review`,note:'Last retained successful sign-in was over 90 days ago. No accounts are disabled automatically.',page:'users',action:'Review accounts'});
  if (data.health.mail.failed || data.health.queue.failed) alerts.push({title:'Failed background deliveries or jobs',note:`${data.health.mail.failed} failed notification records; ${data.health.queue.failed ?? 'unknown'} failed jobs.`,page:'systemhealth',action:'Check services'});
  const latest = data.backups.latest;
  if (!latest || !latest.fileAvailable || Date.now()-new Date(latest.savedAt).getTime()>48*3600*1000) alerts.push({title:'Check backup readiness',note:'No available server backup from the last 48 hours was recorded. Off-server recovery must be checked separately.',page:'backup',action:'Review backups'});
  return alerts;
}
async function mountSystemOversight() {
  const dashboard=document.querySelector('.system-overview');
  if(!dashboard||state_view!=='dashboard')return;
  dashboard.querySelector('#systemOversightAttention')?.remove();
  const section=document.createElement('section');section.id='systemOversightAttention';section.className='dash-section super-system-charts';section.setAttribute('aria-label','System review items');
  section.innerHTML='<p class="field-hint" role="status">Checking system information...</p>';
  const grid=dashboard.querySelector('.super-dashboard-grid');
  const metrics=dashboard.querySelector('[aria-label="System metrics"]');
  if(grid)grid.prepend(section);else (metrics||dashboard.querySelector('.analytics-heading')).after(section);
  const results=await Promise.allSettled([getSystemOversight(),UniServeUX.request('/backup/history')]);
  if(!section.isConnected||state_view!=='dashboard')return;
  if(results[0].status!=='fulfilled'){oversightError(section,results[0].reason,'mountSystemOversight');return;}
  try{
    const data=results[0].value,history=results[1].status==='fulfilled'?results[1].value:null;
    const checks=['api','database','scheduler','worker','mail','realtime'].map(key=>key==='realtime'&&window.UniServeRealtime?.connected?'connected':data.health[key].state);
    const card=(title,description,body,footer)=>'<div class="card"><div class="card-head"><div><h3>'+title+'</h3><div class="desc">'+description+'</div></div></div><div class="card-pad">'+body+'</div><div class="analytics-footer">'+footer+'</div></div>';
    const queue=data.health.queue;
    const serviceNote='Tasks: '+(queue.pending??'Unknown')+' waiting &middot; '+(queue.failed??'Unknown')+' failed &middot; '+(data.health.mail.failed??'Unknown')+' failed emails';
    const saved=history&&Array.isArray(history.backups)?history.backups:null;
    const backupItems=saved?.filter(item=>Number.isFinite(+new Date(item.savedAt))&&new Date(item.savedAt)<=new Date(data.checkedAt)).sort((a,b)=>new Date(b.savedAt)-new Date(a.savedAt)).slice(0,3);
    const latest=backupItems?.[0]||data.backups.latest;
    const available=latest?.fileAvailable;
    const backupNote=latest?'Latest: '+oversightEscape(oversightDate(latest.savedAt))+' &middot; '+(available?'File available':'File missing'):'Check backup readiness: no saved backup recorded.';

    const backupBody=!saved?emptyChart('Backup history could not be loaded.'):backupItems.length?'<ul class="dashboard-status-list">'+backupItems.map(item=>'<li><span>'+oversightEscape(oversightDate(item.savedAt))+'</span><strong>'+ (item.fileAvailable?'File available':'File missing')+'</strong></li>').join('')+'</ul>':emptyChart('No saved backups recorded.');
    const serviceLabels=['API connection','Database','Scheduled tasks','Background jobs','Email','Live updates'];
    const serviceBody='<ul class="dashboard-status-list">'+checks.map((state,index)=>'<li><span>'+serviceLabels[index]+'</span><strong>'+(['responding','observed','connected'].includes(state)?'Activity confirmed':state==='disabled'?'Turned off':'Needs checking')+'</strong></li>').join('')+'</ul>';
    const inactive=data.accounts.filter(account=>account.active&&account.reviewInactive).length;
    section.innerHTML='<div class="super-dashboard-section-head"><h3 class="overview-section-title">System checks</h3><small class="oversight-reviewed-at">Checked '+oversightEscape(oversightDate(data.checkedAt))+'</small></div><div class="dashboard-today-grid">'+card('Service status','Recent connections and task activity',serviceBody,'<span>'+serviceNote+'</span><button type="button" class="analytics-link" onclick="navigate(\'systemhealth\')">System Health</button>')+card('Backups saved','Latest saved files',backupBody,'<span>'+backupNote+'</span><button type="button" class="analytics-link" onclick="navigate(\'backup\')">Review backups</button>')+'</div><p class="super-dashboard-evidence-note">Backup history is limited to retained server records; keep a separate copy.'+(inactive?' '+inactive+' active account'+(inactive===1?' needs':'s need')+' inactivity review.':'')+'</p>';
    if(typeof arrangeSuperDashboardCharts==='function')arrangeSuperDashboardCharts();
  }catch(error){oversightError(section,error,'mountSystemOversight');}
}
function oversightPage(title, description, retry) {
  const generation=++oversightGeneration;
  document.getElementById('content').innerHTML=`<div class="oversight-page"><div class="oversight-section-head"><div><h2>${title}</h2><p class="field-hint">${description}</p></div><button type="button" class="btn btn-ghost btn-sm" onclick="${retry}()">Refresh</button></div><div id="oversightPageBody" role="status">Loading server information…</div></div>`;
  return {generation,target:document.getElementById('oversightPageBody')};
}
function oversightUsesLocalApi() {
 try { const host=new URL(globalThis.UniServeConfig?.apiBase||'http://127.0.0.1:8000/api').hostname;return ['localhost','127.0.0.1','[::1]','::1'].includes(host); } catch (_) { return false; }
}
function oversightServerLocation() { return oversightUsesLocalApi()?'your local server configuration':'your hosting dashboard'; }
function explainHealthService(key, check) {
  const descriptions={api:['System connection','Lets the portals connect to the server.'],database:['Saved records','Stores staff accounts, visits and settings.'],scheduler:['Automatic tasks','Runs reminders, expiry checks and scheduled backups.'],worker:['Email processing','Processes queued messages and other waiting tasks.'],mail:['Email delivery','Sends verification codes and visit notifications.'],realtime:['Live updates','Shows changes without manually refreshing the page.']};
  const [label,description]=descriptions[key];
  const observed=['responding','observed','connected'].includes(check.state);
  let status=check.state==='observed'?'Activity seen':'Available now';
  let next='';
  if(!observed){
    status='Needs checking';
    next={api:'Check the API server status and logs in '+oversightServerLocation()+'.',database:'Check the database connection settings and server logs.',scheduler:'Check that scheduled tasks are running in '+oversightServerLocation()+'.',worker:'Check that background task processing is running on your API server.',mail:'Send a test email and confirm it arrives in the inbox.',realtime:'Refresh the page. If updates remain off, check the live update service and server logs.'}[key];
    if(key==='mail'&&check.state==='configured')status='Delivery not confirmed';
    if(key==='realtime'&&check.state==='disabled')status='Updates off';
  }
  return {key,label,description,status,next,needsReview:!observed};
}
async function renderSystemHealth() {
  const {generation,target}=oversightPage('System health','See what is available, what needs checking, and what to do next.','renderSystemHealth');
  try {
    const data=await getSystemOversight();
    if (generation!==oversightGeneration || !target.isConnected) return;
    const browserConnected=Boolean(window.UniServeRealtime?.connected);
    const health={...data.health,realtime:{state:browserConnected?'connected':data.health.realtime.state,detail:browserConnected?'This browser is subscribed to the staff update channel.':'This browser has no confirmed live subscription. Check the Reverb service and connection.'}};
    const services=['api','database','scheduler','worker','mail','realtime'].map(key=>explainHealthService(key,health[key]));
    const needsChecking=services.filter(service=>service.needsReview);
    target.className='system-health-body';
    target.innerHTML=`<div class="card health-settings health-simple"><div class="card-head"><div><h3>System checks</h3><p class="desc">${needsChecking.length?'Some services still need confirmation.':'All listed services have recent connection or activity evidence.'}</p></div><small class="oversight-timestamp">Checked ${oversightEscape(oversightDate(data.checkedAt))}</small></div>
      <div class="table-wrap"><table class="health-status-table"><thead><tr><th scope="col">Feature</th><th scope="col">Status</th><th scope="col">What to do</th></tr></thead><tbody>${services.map(service=>`<tr><th scope="row">${service.label}</th><td><span class="health-status" data-state="${oversightEscape(health[service.key].state)}">${service.status}</span></td><td>${service.next||'No action needed.'}</td></tr>`).join('')}</tbody></table></div>
      <div class="health-simple-footer"><span>Tasks: ${data.health.queue.pending??'Unknown'} waiting &middot; ${data.health.queue.failed??'Unknown'} failed</span><div><button type="button" class="analytics-link" onclick="sendSystemTestEmail()">Send test email</button><button type="button" class="analytics-link" onclick="navigate('settings')">System settings</button><button type="button" class="analytics-link" onclick="navigate('activitylog')">Audit Trail</button><button type="button" class="analytics-link" onclick="navigate('backup')">Backups</button></div></div></div><p class="health-simple-note">Needs checking means activity is unconfirmed, not that the service has failed.</p>`;

  } catch(error) { oversightError(target,error,'renderSystemHealth'); }
}
function oversightChangeList(changes) {
  const value=v=>v===null||v===undefined||v===''?'Not set':String(v);
  return changes.length?`<ol class="oversight-change-list">${changes.map(c=>{
    const fields=(c.changes||[]).filter(x=>!['area','result'].includes(String(x.field).toLowerCase())&&value(x.from)!==value(x.to));
    return `<li><div><strong>${oversightEscape(c.action)}</strong><small>${oversightEscape(c.actor_name)} &middot; ${oversightEscape(oversightDate(c.created_at))}</small>${fields.length?`<dl class="oversight-field-changes">${fields.map(x=>`<div><dt>${oversightEscape(x.field)}</dt><dd><span><small>Previous value</small>${oversightEscape(value(x.from))}</span><span><small>New value</small>${oversightEscape(value(x.to))}</span></dd></div>`).join('')}</dl>`:''}</div></li>`;
  }).join('')}</ol>`:'<p class="field-hint">No recorded account or settings changes.</p>';
}

async function renderAccessReview() {
  const {generation,target}=oversightPage('Access review','Review staff access. Select an account to see its permissions and sign-in history.','renderAccessReview');
  try {
    const data=await getSystemOversight();
    if (generation!==oversightGeneration || !target.isConnected) return;
    target.className='access-review-body';
    const role=a=>a.role==='SUPER_ADMIN'?'Super Admin':a.headAdmin?'Head Admin':'Admin';
    target.innerHTML=`<div class="card table-wrap access-review-table"><table><thead><tr><th scope="col">Staff member</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col">Action</th></tr></thead><tbody>${data.accounts.map(a=>`<tr><th scope="row">${oversightEscape(a.name)}</th><td>${role(a)}</td><td>${!a.active?'Disabled':a.reviewInactive?'Needs review':'Active'}</td><td><button type="button" class="analytics-link" data-review-account="${oversightEscape(a.id)}">View details</button></td></tr>`).join('')||'<tr><td colspan="4">No staff accounts to review.</td></tr>'}</tbody></table></div><div class="access-review-footer"><p class="field-hint">Needs review: last recorded sign-in was over 90 days ago.</p><button type="button" class="analytics-link" id="accessAuditTrail">View Audit Trail</button></div><p class="oversight-timestamp">Checked ${oversightEscape(oversightDate(data.checkedAt))}</p>`;
    target.querySelectorAll('[data-review-account]').forEach(button=>button.addEventListener('click',()=>openAccessReviewDetails(button.dataset.reviewAccount,data.accounts)));
    document.getElementById('accessAuditTrail').addEventListener('click',()=>navigate('activitylog'));
  } catch(error) { oversightError(target,error,'renderAccessReview'); }
}
function openAccessReviewDetails(id,accounts) {
  const account=accounts.find(a=>String(a.id)===String(id));
  if(!account)return;
  const role=account.role==='SUPER_ADMIN'?'Super Admin':account.headAdmin?'Head Admin':'Admin';
  const access=account.role==='SUPER_ADMIN'?'System administration; no confidential service access through this role.':account.headAdmin?'Approves confidential access requests.':account.confidentialAccess?'Allowed to handle eligible confidential work.':'Standard service access only.';
  openModal('Staff access details',`<div class="access-review-dialog"><h3>${oversightEscape(account.name)}</h3><dl><div><dt>Role</dt><dd>${role}</dd></div><div><dt>Account status</dt><dd>${account.active?'Active':'Disabled'}</dd></div><div><dt>Confidential access</dt><dd>${access}</dd></div><div><dt>Last recorded sign-in</dt><dd>${account.lastSignIn?oversightEscape(oversightDate(account.lastSignIn)):'No sign-in recorded'}</dd></div></dl><p class="field-hint">${account.active&&account.reviewInactive?'Check whether this account is still needed. Its last recorded sign-in was over 90 days ago.':'Review the staff member?s responsibilities before changing access.'} Missing sign-in history does not mean inactivity. Accounts are not disabled automatically.</p></div>`,[{label:'Close',cls:'btn-ghost',action:closeModal},{label:account.role==='SUPER_ADMIN'&&String(account.id)===String(currentUser.id)?'View profile':'Review account',cls:'btn-primary',action:()=>{closeModal();reviewSystemAccount(account.id,accounts);}}]);
}
async function reviewSystemAccount(id,accounts) {
  const account=accounts.find(a=>a.id===id);
  if (!account) return;
  if (account.role==='SUPER_ADMIN') { navigate(id===currentUser.id?'profile':'users'); return; }
  try { await refreshAdmins(); if (state_view==='accessreview'||state_view==='users') openEditUserModal(id); }
  catch(error) { toast('Could not load the current account. Please retry.','err'); }
}

let systemBackupBusy=false;
function saveBackupDownload(backup,filename) {
  const url=URL.createObjectURL(new Blob([JSON.stringify(backup)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function downloadSystemBackup(id=null) {
  if (systemBackupBusy) return;
  systemBackupBusy=true;
  const button=document.getElementById('createServerBackup');
  if(button){button.disabled=true;button.textContent='Creating and verifying…';}
  try {
    const backup=await UniServeUX.request(id?'/backup/files/'+encodeURIComponent(id):'/backup','GET',undefined,{signal:AbortSignal.timeout(120000)});
    saveBackupDownload(backup,'uniserve-database-backup-'+(id||new Date().toISOString().slice(0,10))+'.json');
    toast('Verified encrypted database backup downloaded. Keep an off-server copy and the original application key separately.','ok');
    if(state_view==='backup')renderServerBackups();
  }catch(error){toast(oversightEscape(error.message),'err');}
  finally { systemBackupBusy=false;if(button?.isConnected){button.disabled=false;button.textContent='Create and download backup';} }
}
async function renderServerBackups() {
  ++oversightGeneration;
  document.getElementById('content').innerHTML=`<div class="backup-page oversight-page">
    <section class="card oversight-panel"><div class="backup-section-heading"><h3>Application database backup</h3><button type="button" class="backup-guide-link" onclick="openRecoveryGuide()">Recovery guide</button></div><p>Includes server accounts, service records, queues, appointments, chats, settings and audit history. Uploaded documents stored inside encrypted database payloads are included.</p><p class="field-hint">This is not a full server image. Preserve the original APP_KEY and deployment secrets separately, plus the application source and migration version. A verified export is not a completed restore test.</p><button id="createServerBackup" type="button" class="btn btn-primary btn-sm" onclick="downloadSystemBackup()">Create and download backup</button></section>
    <section class="card oversight-panel"><h3>Restore a database backup</h3><p>Replacement is destructive. Stop intake and background writers during a recovery window, save a current backup, and use a matching migrated application version. The preview checks decryption, table completeness and columns before replacement.</p><p class="field-hint">A pre-restore recovery file is saved first. Pending and failed notification emails from the restored backup are paused. Stop other workers during restore so old queued jobs cannot execute.</p><div class="backup-file-picker"><button type="button" id="restoreBackupChoose" class="btn btn-ghost btn-sm" onclick="document.getElementById('restoreBackupFile').click()">Choose backup to verify</button><span id="restoreBackupName" class="backup-file-name">Encrypted JSON · Up to 30 MB</span><input id="restoreBackupFile" type="file" accept=".json,application/json" onchange="previewBackupFile(this)" hidden></div><p id="restoreBackupStatus" class="field-hint" role="status"></p></section>
    <section class="card oversight-panel"><h3>Server backup and recovery history</h3><p class="field-hint">Private API storage must be persistent across deployments. Copy backups off-server. Showing the latest 20 saved backup records and latest 20 successful restore events. Files are not automatically deleted; monitor disk usage and apply your retention policy.</p><div id="serverBackupHistory" role="status">Loading server backups…</div></section>
    </div>`;
  const target=document.getElementById('serverBackupHistory');
  try {
    const result=await UniServeUX.request('/backup/history');
    if(!target.isConnected)return;
    target.innerHTML=result.backups.length?`<div class="table-wrap"><table><thead><tr><th>Saved</th><th>Kind</th><th>Scope</th><th>Verification</th><th>Action</th></tr></thead><tbody>${result.backups.map(b=>`<tr><td>${oversightEscape(oversightDate(b.savedAt))}<small class="field-hint">${oversightEscape(b.actor)}</small></td><td>${oversightEscape(b.kind)}</td><td>${b.tables} tables · ${b.rows} rows<br>${(b.bytes/1048576).toFixed(2)} MB</td><td>${b.fileAvailable?'Decryption/schema checked when saved':'File missing'}<small class="field-hint">Restore test not recorded</small></td><td>${b.fileAvailable?`<button type="button" class="analytics-link" data-download-backup="${oversightEscape(b.id)}">Verify and download</button>`:'Unavailable'}</td></tr>`).join('')}</tbody></table></div>`:'<p class="field-hint">No verified server exports have been recorded by this version. Older pre-restore files may still exist in private storage; check private server storage for these files.</p>';
    if(result.schedule)target.insertAdjacentHTML('afterbegin', '<p class="field-hint">Scheduled backups: '+(result.schedule.enabled?'Enabled daily at 2:00 AM (Philippine time). Confirm recent backups appear below.':'Not enabled. Set up the schedule on your API server; see Recovery guide.')+'</p>');
    target.querySelectorAll('[data-download-backup]').forEach(button=>button.addEventListener('click',()=>downloadSystemBackup(button.dataset.downloadBackup)));
    if(result.restores?.length) target.insertAdjacentHTML('beforeend',`<h4>Retained successful restore events</h4><ol class="oversight-change-list">${result.restores.map(r=>`<li><strong>${oversightEscape(r.action)}</strong><small>${oversightEscape(r.actor_name)} · ${oversightEscape(oversightDate(r.created_at))}</small></li>`).join('')}</ol>`);
  }catch(error){oversightError(target,error,'renderServerBackups');}
}

if (typeof state_view!=='undefined' && state_view==='dashboard') mountSystemOversight();

async function openManagedAccessReview(id) {
  try {
    const data=await getSystemOversight();
    if(state_view==='users') openAccessReviewDetails(id,data.accounts);
  } catch(error) { toast(error.status===404?'Access details require the matching backend release.':'Could not load access details. Please try again.','err'); }
}

function openRecoveryGuide() {
 openModal('Recovery guide',`<p class="field-hint">As Super Admin, complete these steps before restoring. Manage server settings in ${oversightServerLocation()}.</p><ol class="oversight-checklist"><li>Download a recent backup and keep a copy in a secure place outside this server.</li><li>Keep the original application encryption key separately. It is needed to open the backup.</li><li>Keep the application version that matches the backup.</li><li>Test restoration in a separate environment with email sending and background tasks turned off.</li><li>Check records, documents, sign-in and permissions before reopening the system.</li></ol><p class="field-hint">Automatic backups need setup on the API server. Configure the schedule and persistent storage in ${oversightServerLocation()}, then confirm that backups are being saved.</p>`,[{label:'Close',cls:'btn-ghost',action:closeModal}]);
}
