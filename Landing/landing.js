// Use the shared modal, toast and status controls before page initialization.
UniServeUX.install();
const DB_KEY = 'ossuniserve_db_v1';
const QUEUE_AVG_MINUTES = 4;
const DEFAULT_GRACE_MINUTES = 15;
const DEFAULT_NOSHOW_MINUTES = 60;
const AUDIT_MAX_ENTRIES = 2000;
const CONFIDENTIAL_SERVICES = ['incident_report', 'concern', 'scholarship_txn', 'excuse_letter'];

const DEFAULT_SERVICES = [
  { key: 'good_moral', label: 'Good Moral Character', icon: 'cap', desc: 'Certification of good standing for scholarships, transfers or employment.', requirements: ['Valid School ID', 'Duly accomplished request form'] },
  { key: 'student_id', label: 'Student ID-Related Requests', icon: 'idcard', desc: 'Replacement or first-time issuance of a student identification card.', requirements: ['Affidavit of Loss (if lost)', '1x1 recent ID picture'] },
  { key: 'incident_report', label: 'Incident Reports', icon: 'alert', desc: 'Report and document an incident for OSS review and action.', requirements: ['Written incident statement', 'Valid ID'] },
  { key: 'excuse_letter', label: 'Excuse Letters', icon: 'checkin', desc: 'Official excuse documentation for class or activity absences.', requirements: ['Medical certificate or proof of absence'] },
  { key: 'scholarship_txn', label: 'Scholarship Transactions', icon: 'cap', desc: 'Scholarship application, renewal or documentation requests.', requirements: ['Certificate of Grades', 'Financial assistance application form'] },
  { key: 'concern', label: 'Student Concerns/Complaints', icon: 'alert', desc: 'Raise a concern or complaint for OSS review and action.', requirements: ['Written statement of the concern'] },
  { key: 'offcampus', label: 'Off-Campus Activity Requests', icon: 'calendar', desc: 'Permission and documentation for off-campus student activities.', requirements: ['Parent/Guardian consent form', 'Activity proposal'] },
  { key: 'activity_approval', label: 'Activity Approval', icon: 'checkin', desc: 'Approval request for a planned school or student activity.', requirements: ['Activity proposal', 'Adviser/Head endorsement'] },
  { key: 'orgevent', label: 'Organization Activities/Events', icon: 'users', desc: 'Approval workflow for student organization events on or off campus.', requirements: ['Activity proposal', 'Adviser endorsement letter'] },
  { key: 'sportsevent', label: 'Sports Events', icon: 'chart', desc: 'Coordination and approval for sports competitions and away games.', requirements: ['Coach endorsement', 'Player/participant list'] },
  { key: 'lost_document', label: 'Lost Certificate/Document Requests', icon: 'folder', desc: 'Re-issuance or certification for lost school records.', requirements: ['Affidavit of Loss', 'Valid ID'] },
  { key: 'other', label: 'Other Student Services Documentation', icon: 'home', desc: 'Any other OSS request not covered by the categories above.', requirements: ['Supporting document, if applicable'] },
];

let pdTimer = null;
let pdVoice = false;
let pdCalledIds = null;
let pdRecallStamps = {};

function uid(p) {
  const c = (Number(localStorage.getItem(DB_KEY + '_uidc')) || 1000) + 1;
  localStorage.setItem(DB_KEY + '_uidc', c);
  return p + c;
}
const pad2 = n => String(n).padStart(2, '0');
const fmtDate = d => { d = new Date(d); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const fmtTime = d => { d = new Date(d); let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${pad2(d.getMinutes())} ${ap}`; };
const today = () => fmtDate(new Date());
const genTempPassword = () => {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = ''; for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtWaitDuration(mins) {
  if (!mins || mins <= 0) return 'No wait';
  if (mins < 1) { const s = Math.max(1, Math.round(mins * 60)); return `${s} second${s === 1 ? '' : 's'}`; }
  if (mins < 60) { const m = Math.round(mins); return `${m} minute${m === 1 ? '' : 's'}`; }
  const h = Math.max(1, Math.round(mins / 60));
  return `${h} hour${h === 1 ? '' : 's'}`;
}
function isOfficeHours(d = new Date()) { return OfficeCalendar.status(d).open; }

const VISIT_ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomVisitSuffix(len) {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, b => VISIT_ID_CHARS[b % VISIT_ID_CHARS.length]).join('');
}
function visitIdExists(db, id) {
  return ['appointments', 'queues', 'transactions', 'visitorLog', 'chats'].some(k => (db[k] || []).some(x => String(x.visitId || '').replace(/-/g, '') === String(id).replace(/-/g, '')));
}
function nextVisitId(db) {
  let id;
  do { const s = randomVisitSuffix(8); id = `VIS-${s}`; } while (visitIdExists(db, id));
  return id;
}
const LEGACY_VISIT_ID = /^VIS-\d+$/;
function migrateLegacyVisitIds(db) {
  const map = {};
  let changed = false;
  ['appointments', 'queues', 'transactions', 'visitorLog', 'chats'].forEach(k => (db[k] || []).forEach(x => {
    if (x.visitId && LEGACY_VISIT_ID.test(x.visitId)) { x.visitId = map[x.visitId] || (map[x.visitId] = nextVisitId(db)); changed = true; }
  }));
  return changed;
}
function migrateVisitIds(db) {
  let changed = false;
  (db.appointments || []).forEach(a => { if (!a.visitId) { a.visitId = nextVisitId(db); changed = true; } });
  (db.queues || []).forEach(q => {
    if (!q.visitId) {
      const a = q.appointmentId ? (db.appointments || []).find(x => x.id === q.appointmentId) : null;
      q.visitId = a ? a.visitId : nextVisitId(db);
      changed = true;
    }
    if (q.checkedInAt == null) { q.checkedInAt = q.createdAt; changed = true; }
  });
  return changed;
}
function migrateDashEntities(db) {
  let changed = false;
  (db.transactions || []).forEach(t => { if (t.details && t.details.includes('&mdash;')) { t.details = t.details.split('&mdash;').join('—'); changed = true; } });
  return changed;
}
function migrateConfidentialAccess(db) {
  let changed = false;
  (db.users || []).forEach(u => { if (u.confidentialAccess == null) { u.confidentialAccess = (u.id === 'u2'); changed = true; } });
  return changed;
}

function freshState() {
  return {
    users: [],
    services: DEFAULT_SERVICES.map(s => ({ ...s, requirements: [...s.requirements] })),
    transactions: [], appointments: [], chats: [],
    activityLog: [], queues: [], queueCounters: {}, visitorLog: [], visitCounter: 0,
    systemSettings: {
      orgName: 'Office of Student Services', supportEmail: 'oss@university.edu.ph',
      supportPhone: '0917-000-0000', timezone: 'Asia/Manila', maintenanceMode: false,
      autoCloseChats: false, sessionTimeout: 30, queuePrefixStudent: 'A', queuePrefixGuest: 'G',
      gracePeriodMinutes: DEFAULT_GRACE_MINUTES, noShowThresholdMinutes: DEFAULT_NOSHOW_MINUTES,
    },
  };
}
function mkLog(user, role, action, ts) { return { id: uid('L'), user, role, action, ts: ts || new Date() }; }
const DATE_FIELDS = ['createdAt', 'updatedAt', 'calledAt', 'servingAt', 'completedAt', 'recalledAt', 'transferredAt', 'checkedInAt', 'scheduledAt', 'skippedAt', 'cancelledAt', 'startedAt', 'escalatedAt', 'submittedAt', 'ts', 'timeIn', 'timeOut'];
function reviveDates(obj) {
  if (Array.isArray(obj)) { obj.forEach(reviveDates); return obj; }
  if (obj && typeof obj === 'object') {
    Object.keys(obj).forEach(k => { if (DATE_FIELDS.includes(k) && obj[k]) obj[k] = new Date(obj[k]); else reviveDates(obj[k]); });
  }
  return obj;
}
function loadDB() {
  const raw = localStorage.getItem(DB_KEY);
  if (!raw) { const s = freshState(); localStorage.setItem(DB_KEY, JSON.stringify(s)); return s; }
  try {
    const p = reviveDates(JSON.parse(raw));
    p.visitorLog = p.visitorLog || [];
    p.appointments = p.appointments || [];
    if (p.visitCounter == null) p.visitCounter = 0;
    if (p.systemSettings.gracePeriodMinutes == null) p.systemSettings.gracePeriodMinutes = DEFAULT_GRACE_MINUTES;
    if (p.systemSettings.noShowThresholdMinutes == null) p.systemSettings.noShowThresholdMinutes = DEFAULT_NOSHOW_MINUTES;
    const changed = [migrateVisitIds(p), migrateLegacyVisitIds(p), migrateDashEntities(p), migrateConfidentialAccess(p)].some(Boolean);
    if (changed) localStorage.setItem(DB_KEY, JSON.stringify(p));
    return p;
  } catch (e) {
    try { localStorage.setItem(DB_KEY + '_backup_' + Date.now(), raw); } catch (_) { }
    const s = freshState(); localStorage.setItem(DB_KEY, JSON.stringify(s)); return s;
  }
}
function saveDB(s) { localStorage.setItem(DB_KEY, JSON.stringify(s)); }
function loadSession() { try { return JSON.parse(sessionStorage.getItem('ossuniserve_session') || '{}'); } catch (e) { return {}; } }
function saveSession(o) { sessionStorage.setItem('ossuniserve_session', JSON.stringify(o)); }

function inferCategory(action) {
  const a = String(action || '').toLowerCase();
  if (/confidential/.test(a)) return 'Confidential';
  if (/logged (in|out)|login|logout/.test(a)) return 'Authentication';
  if (/setting/.test(a)) return 'Settings';
  if (/export|reset|backup|demo/.test(a)) return 'Data';
  if (/account|profile|password/.test(a)) return 'Accounts';
  if (/no-show|appointment/.test(a)) return 'Appointments';
  if (/queue|called|began|skipped|recalled|cancelled|checked in|joined|transferred|completed visit/.test(a)) return 'Queue';
  if (/transaction|printed|incident|scholarship|escalation|service/.test(a)) return 'Transactions';
  return 'System';
}
function h53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
function auditDigest(e) { return h53(JSON.stringify([e.prev || '', e.id, e.user, e.role, e.action, new Date(e.ts).toISOString(), e.category || '', e.target || '', e.changes || []])).toString(16).padStart(14, '0'); }
function sealEntry(e, prevHash) { e.prev = prevHash || ''; e.hash = auditDigest(e); }
function sealPending(db) {
  const log = db.activityLog;
  let changed = false;
  for (let i = log.length - 1; i >= 0; i--) {
    if (!log[i].hash) { const older = log[i + 1]; sealEntry(log[i], (older && older.hash) || ''); log[i].sealedLate = true; changed = true; }
  }
  if (changed && log[0]) db.auditHead = { hash: log[0].hash };
  return changed;
}
function logActivity(db, user, action, extra) {
  if (!user) return;
  sealPending(db);
  const e = mkLog(user.fullName, user.role, action, new Date());
  e.userId = user.id || null;
  e.category = (extra && extra.category) || inferCategory(action);
  e.target = (extra && extra.target) || null;
  e.changes = (extra && extra.changes) || [];
  sealEntry(e, (db.activityLog[0] && db.activityLog[0].hash) || '');
  db.activityLog.unshift(e);
  if (typeof UniServeUX !== 'undefined') UniServeUX.auditRecord(e);
  db.auditHead = { hash: e.hash };
  if (db.activityLog.length > AUDIT_MAX_ENTRIES) db.activityLog.length = AUDIT_MAX_ENTRIES;
}

function queueRef(q) { return q.number || q.visitId; }
function isDue(q, now = new Date()) { return q.source !== 'Appointment' || !q.scheduledAt || new Date(q.scheduledAt) <= now; }
function queueRank(q, now) {
  if (q.source === 'Appointment') return isDue(q, now) ? ((q.isSenior || q.isPWD) ? -1 : 1) : 3;
  return (q.isSenior || q.isPWD) ? -1 : 2;
}
function queueSortKey(q) { return new Date(q.queueEnteredAt || (q.source === 'Appointment' && q.scheduledAt ? q.scheduledAt : (q.checkedInAt || q.createdAt))); }
function waitingQueueSorted(db) {
  const now = new Date();
  return db.queues.filter(q => q.status === 'Waiting').sort((a, b) => queueRank(a, now) - queueRank(b, now) || queueSortKey(a) - queueSortKey(b));
}
function servingQueueEntries(db) {
  return db.queues.filter(q => q.status === 'Serving' || q.status === 'Called').sort((a, b) => new Date(a.calledAt || 0) - new Date(b.calledAt || 0));
}

function findService(db, key) { return db.services.find(x => x.key === key) || db.services.find(x => x.label === key); }
function serviceLabel(db, key) { const s = db.services.find(x => x.key === key); return s ? s.label : key; }

function icon(name, size = 17) {
  const p = {
    checkin: 'M9 12l2 2 4-4M5 4h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z',
    calendar: 'M8 2v4M16 2v4M3 9h18M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z',
    folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z',
    alert: 'M12 3l9 16H3l9-16zM12 10v4M12 17.5v.01',
    cap: 'M12 3l10 5-10 5L2 8l10-5zM6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5',
    chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    users: 'M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M13 7a4 4 0 11-8 0 4 4 0 018 0M23 21v-2a4 4 0 00-3-3.87M17 3.13a4 4 0 010 7.75',
    lock: 'M5 11h14v9H5v-9zM8 11V7a4 4 0 118 0v4',
    idcard: 'M3 5h18v14H3V5zm4 4h.01M7 15h6M14 9h6M14 12h6',
    x: 'M18 6L6 18M6 6l12 12',
    check: 'M20 6L9 17l-5-5',
    chat: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
    home: 'M3 12l9-9 9 9M5 10v10h14V10',
    log: 'M4 4h16v16H4V4zM8 8h8M8 12h8M8 16h5',
    eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 100-6 3 3 0 000 6z',
    eyeoff: 'M3 9c2 4 5 6 9 6s7-2 9-6M5 12l-2 3M9 14.5l-1 3.5M15 14.5l1 3.5M19 12l2 3',
    mail: 'M4 5h16a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1zM3 6l9 7 9-7',
  }[name] || 'M12 2v20';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p.split('M').filter(Boolean).map(seg => `<path d="M${seg}"/>`).join('')}</svg>`;
}
function setTheme(t) {
  localStorage.setItem('ossuniserve_theme', t);
  document.documentElement.setAttribute('data-theme', t);
  document.querySelectorAll('[data-theme-btn]').forEach(b => b.classList.toggle('active', b.dataset.themeBtn === t));
}
setTheme(localStorage.getItem('ossuniserve_theme') || 'light');
document.getElementById('yearNow').textContent = new Date().getFullYear();

const sessionNotice = sessionStorage.getItem('ossuniserve_notice');
if (sessionNotice) { sessionStorage.removeItem('ossuniserve_notice'); toast(escapeHtml(sessionNotice), 'err'); }

(function redirectIfAlreadyLoggedIn() {
  const sess = loadSession();
  const sid = sess && sess.currentUser && sess.currentUser.id;
  if (!sid) return;
  if (!sess.token) { sessionStorage.removeItem('ossuniserve_session'); return; }
  let user = null;
  try { user = loadDB().users.find(u => u.id === sid); } catch (e) { user = null; }
  if (!user || !user.active) { sessionStorage.removeItem('ossuniserve_session'); return; }
  if (user.role === 'SUPER_ADMIN') location.href = '../Super Admin/superadmin.html';
  else if (user.role === 'ADMIN') location.href = '../Admin/admin.html';
  else sessionStorage.removeItem('ossuniserve_session');
})();

function applyPortalAvailability() {
  const schedule = document.getElementById('contactOfficeHours'); if (schedule) schedule.innerHTML = contactHoursHtml();
  const db = loadDB(), maint = !!db.systemSettings.maintenanceMode, open = isOfficeHours();
  const maintBanner = document.getElementById('maintBanner');
  if (maintBanner) maintBanner.hidden = !maint;
  document.querySelectorAll('a[href*="user.html"]').forEach(a => {
    a.classList.remove('is-disabled');
    a.removeAttribute('aria-disabled');
    a.onclick = null;
  });
}

function showScreen(id) {
  toggleNav(false);
  stopPdPolling();
  ['landing', 'loginScreen', 'publicDisplay'].forEach(s => document.getElementById(s).hidden = true);
  document.getElementById(id).hidden = false;
  window.scrollTo(0, 0);
  if (id === 'landing') renderLandingLive();
}
function showLanding() { showScreen('landing'); }
function showLogin() {
  showScreen('loginScreen');
  LoginTurnstile.init();
  document.getElementById('loginErr').hidden = true;
  clearLoginFieldErrors();
  const savedUser = localStorage.getItem('ossuniserve_remember_user');
  document.getElementById('loginUser').value = savedUser || '';
  document.getElementById('loginPass').value = '';
  document.getElementById('loginPass').type = 'password';
  const rememberBox = document.getElementById('loginRemember');
  if (rememberBox) rememberBox.checked = !!savedUser;
  const btn = document.getElementById('loginPassToggle');
  if (btn) { btn.innerHTML = profilePasswordEye(true); btn.setAttribute('aria-label', 'Show password'); btn.setAttribute('aria-pressed', 'false'); }
}
function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  btn.innerHTML = profilePasswordEye(!isHidden);
  btn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
  btn.setAttribute('aria-pressed', String(isHidden));
}
let loginPending = false;
function clearLoginFieldErrors() {
  ['loginUser','loginPass'].forEach(id=>{
    document.getElementById(id).removeAttribute('aria-invalid');
    document.getElementById(id+'Error').hidden=true;
  });
}
async function doLogin() {
  if (loginPending) return;
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value;
  const remember = document.getElementById('loginRemember')?.checked;
  const errBox = document.getElementById('loginErr');
  const db = loadDB();
  const uLower = u.toLowerCase();
  errBox.hidden = true;
  clearLoginFieldErrors();
  if (!u || !p) {
    [['loginUser',u,'Enter your username or email.'],['loginPass',p,'Enter your password.']].forEach(([id,value,message])=>{
      if(value)return;
      document.getElementById(id).setAttribute('aria-invalid','true');
      const error=document.getElementById(id+'Error');error.textContent=message;error.hidden=false;
    });
    document.getElementById(!u?'loginUser':'loginPass').focus();
    return;
  }
  let user, token;
  loginPending = true;
  const signIn = document.getElementById('staffSignIn');
  if (signIn) { signIn.disabled = true; signIn.textContent = 'Signing in...'; }
  try {
    const turnstileToken=await LoginTurnstile.getToken();
    const response = await fetch((globalThis.UniServeConfig?.apiBase||'http://127.0.0.1:8000/api')+'/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ username: u, password: p,turnstileToken })
    });
    const result = await response.json();
    if(response.status===429)throw new Error('Too many sign-in attempts. Please wait '+(response.headers.get('Retry-After')||60)+' seconds, then try again.');
    if (!response.ok) throw new Error(response.status >= 500 ? 'Sign in is temporarily unavailable. Please try again later.' : result.message || 'Unable to sign in. Check your username and password, then try again.');
    user = result.user;
    token = result.token;
    if (!user || !['ADMIN', 'SUPER_ADMIN'].includes(user.role) || !token) throw new Error('Invalid login response.');
    db.users = db.users.filter(x => x.role !== 'SUPER_ADMIN' || x.id === user.id);
    const index = db.users.findIndex(x => x.id === user.id);
    if (index >= 0) db.users[index] = user;
    else db.users.push(user);
  } catch (error) {
    errBox.textContent = error instanceof TypeError || error instanceof SyntaxError ? 'Unable to connect. Check your connection and try again.' : error.message;
    errBox.hidden = false;
    return;
  } finally {
    loginPending = false;
    LoginTurnstile.reset();
    if (signIn) { signIn.disabled = false; signIn.textContent = 'Sign In'; }
  }
  if (remember) {
    localStorage.setItem('ossuniserve_remember_user', u);
    if (window.PasswordCredential && navigator.credentials?.store) {
      try { await navigator.credentials.store(new PasswordCredential({id:u,password:p,name:user.fullName||u})); }
      catch (_) { /* Browser credential saving must not block sign-in. */ }
    }
  }
  else localStorage.removeItem('ossuniserve_remember_user');
  logActivity(db, user, 'Logged in', { category: 'Authentication' });
  saveDB(db);
  saveSession({ currentUser: user, token });
  location.href = user.role === 'SUPER_ADMIN' ? '../Super Admin/superadmin.html' : '../Admin/admin.html';
}
// The login form handles Enter through its native submit event.


function showForgotPassword() {
  openModal('Forgot Password', `
    <div class="fp-hero">
      <span class="fp-ic">${icon('mail', 26)}</span>
      <p>Enter your staff account email. We will send a code to reset your password.</p>
    </div>
    <div id="fpErr" class="err-box" hidden></div>
    <div class="field" style="margin-bottom:0;">
      <label for="fpEmail">Email</label>
      <div class="input-ic">${icon('mail', 18)}<input id="fpEmail" type="email" placeholder="you@gmail.com" autocomplete="email"></div>
    </div>
    <div id="fpResult" hidden></div>`, [
    { label: 'Cancel', cls: 'btn-ghost', action: closeModal },
    { label: 'Send code', cls: 'btn-primary', action: submitForgotPassword },
  ]);
  setTimeout(() => {
    const input = document.getElementById('fpEmail');
    if (input) { input.focus(); input.addEventListener('keydown', e => { if (e.key === 'Enter') submitForgotPassword(); }); const bind=()=>window.CodeCooldown?.bind(document.getElementById('modalBtn1'),'staff:'+input.value.trim(),'Send code');input.addEventListener('input',bind);bind(); }
  }, 50);
}
let staffResetBusy=false;
async function staffResetRequest(path,data){const response=await fetch((globalThis.UniServeConfig?.apiBase||'http://127.0.0.1:8000/api')+path,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(15000)});const result=await response.json();if(!response.ok)throw Error(Object.values(result.errors||{}).flat().join(' ')||result.message||'Please try again.');return result;}
async function submitForgotPassword() {
 if(staffResetBusy)return;const input=document.getElementById('fpEmail'),err=document.getElementById('fpErr');
 if(!input.value.trim()||!input.checkValidity()){err.textContent='Enter your staff account email.';err.hidden=false;return;}
 const email=input.value.trim(),key='staff:'+email,button=document.getElementById('modalBtn1');
 if(window.CodeCooldown?.remaining(key)){window.CodeCooldown.bind(button,key,'Send code');return;}
 window.CodeCooldown?.unbind(button);
 staffResetBusy=true;err.hidden=true;button.disabled=true;button.textContent='Sending…';
 try{const result=await staffResetRequest('/password/reset-code',{email});window.CodeCooldown?.start(key);showStaffResetForm(result.challengeId,result.message);const resend=document.createElement('button');resend.type='button';resend.className='btn btn-ghost btn-sm resend-text';resend.onclick=()=>{if(!window.CodeCooldown?.remaining(key)){showForgotPassword();document.getElementById('fpEmail').value=email;submitForgotPassword();}};const resendRow=document.createElement('div');resendRow.className='staff-reset-resend';resendRow.appendChild(resend);document.querySelector('.staff-reset-form').appendChild(resendRow);window.CodeCooldown?.bind(resend,key);}catch(e){err.textContent=e.message;err.hidden=false;}finally{staffResetBusy=false;if(button.isConnected){button.disabled=false;button.textContent='Send code';}}
}
function showStaffResetForm(challengeId,message){
 openModal('Verify your email',`<div class="staff-reset-form"><p class="field-hint">${escapeHtml(message)}</p><div id="fpErr" class="err-box" hidden></div><div class="field"><label class="verification-code-label" for="fpCode">Verification code</label><input id="fpCode" class="verification-code-input" oninput="this.value=this.value.replace(/[^0-9]/g,'')" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000"></div></div>`,[{label:'Back',cls:'btn-ghost',action:showForgotPassword},{label:'Verify',cls:'btn-primary',action:async()=>{
  if(staffResetBusy)return;const err=document.getElementById('fpErr'),code=document.getElementById('fpCode').value.trim(),button=document.getElementById('modalBtn1');
  staffResetBusy=true;err.hidden=true;button.disabled=true;
  try{await staffResetRequest('/password/verify-reset-code',{challengeId,code});showStaffNewPasswordForm(challengeId,code);}catch(e){err.textContent=e.message;err.hidden=false;}finally{staffResetBusy=false;if(button.isConnected)button.disabled=false;}
 }}]);
}
function showStaffNewPasswordForm(challengeId,code){
 openModal('Reset password',`<div class="staff-reset-form"><p class="field-hint">Email verified. Choose your new password.</p><div id="fpErr" class="err-box" hidden></div><div class="field"><label for="fpPass">New password</label><div class="profile-password-input"><input id="fpPass" type="password" autocomplete="new-password" aria-describedby="fpPasswordHint"><button type="button" class="profile-pass-toggle" aria-label="Show password" onclick="toggleProfilePassword('fpPass',this)">${profilePasswordEye(true)}</button></div><p id="fpPasswordHint" class="field-hint" aria-live="polite">At least 12 characters with uppercase and lowercase letters, a number, and a special character.</p></div><div class="field"><label for="fpPass2">Confirm new password</label><div class="profile-password-input"><input id="fpPass2" type="password" autocomplete="new-password"><button type="button" class="profile-pass-toggle" aria-label="Show password" onclick="toggleProfilePassword('fpPass2',this)">${profilePasswordEye(true)}</button></div></div></div>`,[{label:'Back',cls:'btn-ghost',action:()=>showStaffResetForm(challengeId,'Enter the code from your email.')},{label:'Reset password',cls:'btn-primary',action:async()=>{if(staffResetBusy)return;const err=document.getElementById('fpErr');staffResetBusy=true;try{await staffResetRequest('/password/reset',{challengeId,code,password:document.getElementById('fpPass').value,password_confirmation:document.getElementById('fpPass2').value});closeModal();toast('Password updated. Sign in with your new password.','ok');}catch(e){err.textContent=e.message;err.hidden=false;}finally{staffResetBusy=false;}}}]);
}


function openPublicDisplay() {
  pdCalledIds = null;
  pdRecallStamps = {};
  showScreen('publicDisplay');
  startPdPolling();
}
function startPdPolling() {
  stopPdPolling();
  renderPublicDisplay();
  let lastRefresh = Date.now();
  pdTimer = setInterval(() => {
    // Cutoff can change with the clock even when no queue event is broadcast.
    if (!window.UniServeRealtime?.connected || Date.now() - lastRefresh >= 15000) {
      lastRefresh = Date.now();
      renderPublicDisplay();
    }
  }, 3000);
}
function stopPdPolling() { if (pdTimer) { clearInterval(pdTimer); pdTimer = null; } }
document.addEventListener('visibilitychange', () => {
  const board = document.getElementById('publicDisplay');
  if (!board || board.hidden) return;
  if (document.hidden) stopPdPolling(); else startPdPolling();
});

function togglePdVoice() {
  pdVoice = !pdVoice;
  if (pdVoice && isOfficeHours() && !loadDB().systemSettings.maintenanceMode && 'speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance('Voice announcements on'));
  renderPublicDisplay();
}
function spokenRef(q) {
  if (q.number) return 'Queue number ' + String(q.number).replace('-', ' ').replace(/\d/g, d => d + ' ');
  return 'Visit I D ' + String(q.visitId || '').replace(/^VIS-/, '').replace(/-/g, '').split('').join(' ');
}
function speakCall(q) {
  if (!pdVoice || !isOfficeHours() || loadDB().systemSettings.maintenanceMode || !('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(`${spokenRef(q)}, please proceed to ${q.assignedAdminName || 'the counter'}.`);
  u.rate = 0.9;
  speechSynthesis.speak(u);
}
function pdSourceTag(q) {
  if (q.isSenior || q.isPWD) return { cls: 'priority', txt: 'Priority' };
  if (q.source === 'Appointment') return { cls: 'appt', txt: 'Appointment' };
  return { cls: 'walk', txt: 'Walk-in' };
}
const refClass = q => (q.number ? '' : ' is-id');

function renderPublicDisplay() {
  const el = document.getElementById('publicDisplayContent');
  if (!el) return;
  const db = loadDB();
  const called = db.queues.filter(q => q.status === 'Called').sort((a, b) => new Date(a.calledAt || 0) - new Date(b.calledAt || 0));
  const serving = db.queues.filter(q => q.status === 'Serving').sort((a, b) => new Date(a.servingAt || 0) - new Date(b.servingAt || 0));
  const waitingAll = waitingQueueSorted(db);
  const callable = waitingAll.filter(q => isDue(q)).length;
  const waiting = waitingAll.slice(0, 6);
  const more = waitingAll.length - waiting.length;
  const availability = OfficeCalendar.status();
  const maintenance = !!db.systemSettings.maintenanceMode;
  const open = availability.open && !maintenance;
  const intake = window.UniServeWalkInCapacity;
  const intakeClosed = open && intake?.accepting === false;
  const reopening = maintenance ? 'To be announced' : availability.lunch ? OfficeCalendar.clock(OfficeCalendar.get().lunch.end) : availability.nextLabel;
  if (!open && 'speechSynthesis' in window) window.speechSynthesis.cancel();

  if (open && pdCalledIds) called.filter(q => !pdCalledIds.has(q.id)).forEach(speakCall);
  called.forEach(q => {
    const stamp = q.recalledAt ? new Date(q.recalledAt).getTime() : 0;
    if (open && pdCalledIds && pdRecallStamps[q.id] !== undefined && pdRecallStamps[q.id] !== stamp) speakCall(q);
    pdRecallStamps[q.id] = stamp;
  });
  pdCalledIds = new Set(called.map(q => q.id));

  el.innerHTML = `
    <div class="qd-bar">
      <div class="qd-bar-item qd-state"><span class="qd-dot ${open ? 'open' : 'closed'}" aria-hidden="true"></span><b>${open ? 'Office open' : 'Office closed'}</b></div>
      <div class="qd-bar-item"><span class="qd-bar-lbl">Waiting</span><b>${waitingAll.length}</b></div>
      <div class="qd-bar-item ${open ? '' : 'qd-reopening'}"><span class="qd-bar-lbl">${open ? 'Estimated wait' : availability.lunch ? 'Back at' : 'Reopens'}</span><b>${open ? (callable ? (Number.isFinite(intake?.waitEstimates?.[waitingAll[0]?.id]) ? fmtWaitDuration(intake.waitEstimates[waitingAll[0].id]) : 'Unavailable') : 'None') : escapeHtml(reopening)}</b></div>
      <div class="qd-bar-item qd-bar-end">
        <span class="qd-clock">${fmtTime(new Date())}</span>
        <button class="qd-voice ${pdVoice ? 'on' : ''}" onclick="togglePdVoice()" aria-pressed="${pdVoice}" ${open ? '' : 'disabled'}>Voice announcements: ${open ? (pdVoice ? 'On' : 'Off') : 'Paused'}</button>
      </div>
    </div>
    ${!open ? `<div class="qd-closed ${maintenance || availability.lunch ? 'warn' : 'danger'}" role="status"><strong>${maintenance ? 'Closed for maintenance' : availability.lunch ? 'Lunch break' : 'Office closed'}</strong>${maintenance ? '<span>Service and announcements are paused. Existing visits are saved.</span>' : `<span>${escapeHtml(availability.reason)}</span><b>${(availability.lunch ? 'Back at ' : 'Reopens ') + escapeHtml(reopening)}</b><small>Existing visits remain recorded. Service and call announcements are paused.</small>`}</div>` : ''}
    ${open ? `<div class="qd-closed ${intakeClosed ? 'warn' : intake?.accepting === true ? 'success' : 'warn'}" role="status"><strong>${intakeClosed ? 'Walk-in intake closed' : intake?.accepting === true ? 'Walk-ins available' : 'Walk-in intake status unavailable'}</strong><span>${intakeClosed ? 'Existing visits are still being served. New walk-ins are no longer accepted today.' : intake?.accepting === true ? (intake.override ? 'Additional walk-ins are allowed today by the Head Admin.' : 'Intake may close early when the queue reaches today’s service capacity.') : 'Check with the OSS counter before starting a walk-in.'}</span>${intake?.closedTime ? `<small>Intake closed at ${escapeHtml(intake.closedTime)}.</small>` : intake?.scheduledCutoff && intake.manualCutoffTime ? `<small>Scheduled walk-in cutoff: ${escapeHtml(intake.manualCutoffTime)}.</small>` : ''}${intake?.cutoff ? `<small>Normal walk-in cutoff: ${escapeHtml(intake.cutoff)}</small>` : ''}${intakeClosed ? '<small>You can still book an appointment or check in for your scheduled appointment.</small>' : ''}</div>` : ''}
    <section class="qd-call ${open && called.length ? 'active' : ''}" ${!open && !called.length ? 'hidden' : ''} aria-live="${open ? 'assertive' : 'off'}" aria-label="Now calling">
      <h2 class="qd-label">${open ? 'Now calling' : 'Calling paused'}</h2>
      ${called.length ? `
        <div class="qd-call-list ${called.length > 1 ? 'multi' : ''}">
          ${called.map(q => `
            <div class="qd-call-card">
              <div class="qd-call-num${refClass(q)}">${escapeHtml(queueRef(q))}</div>
              <div class="qd-call-go"><span>${open ? 'Please proceed to' : 'Assigned counter � service paused'}</span><b>${escapeHtml(q.assignedAdminName || 'the OSS counter')}</b></div>
            </div>`).join('')}
        </div>`
      : `<p class="qd-call-idle">${open ? 'No number is being called at the moment.' : 'Service is paused.'}<small>${open ? 'Your number will appear here when it is your turn.' : 'Please wait until the office reopens.'}</small></p>`}
    </section>
    <div class="qd-cols">
      <section class="qd-panel" aria-label="Now serving">
        <h2 class="qd-label">Now serving ${open ? '' : '<span class="qd-paused">Service paused</span>'}</h2>
        ${serving.length ? `
        <ul class="qd-serving">
          <li class="qd-head"><span>Counter</span><span>Number</span></li>
          ${serving.map(q => `<li><span class="qd-serving-counter">${escapeHtml(q.assignedAdminName || 'OSS Counter')}</span><span class="qd-serving-num${refClass(q)}">${escapeHtml(queueRef(q))}</span></li>`).join('')}
        </ul>` : `<p class="qd-empty">No one is at the counter at the moment.</p>`}
      </section>
      <section class="qd-panel" aria-label="Waiting">
        <h2 class="qd-label">Waiting</h2>
        ${waiting.length ? `
        <ol class="qd-next">
          <li class="qd-head"><span>Order</span><span>Number</span><span>Type</span><span class="qd-eta">Estimated wait</span></li>
          ${waiting.map((q, i) => {
            const tag = pdSourceTag(q);
            const eta = !open ? 'Paused' : !isDue(q) ? `At ${fmtTime(q.scheduledAt)}` : (Number.isFinite(intake?.waitEstimates?.[q.id]) ? (intake.waitEstimates[q.id] === 0 ? 'Shortly' : fmtWaitDuration(intake.waitEstimates[q.id])) : 'Unavailable');
            return `<li class="${open && i === 0 ? 'first' : ''}">
              <span class="qd-pos">${open && i === 0 ? 'Next' : i + 1}</span>
              <span class="qd-next-num${refClass(q)}">${escapeHtml(queueRef(q))}</span>
              <span class="qd-tag ${tag.cls}">${tag.txt}</span>
              <span class="qd-eta">${eta}</span>
            </li>`;
          }).join('')}
        </ol>
        ${more > 0 ? `<p class="qd-more">and ${more} more waiting</p>` : ''}`
        : `<p class="qd-empty">${open ? (intakeClosed ? 'No one is waiting. Walk-in intake is closed for today.' : intake?.accepting === true ? 'No one is waiting. You may proceed to the counter.' : 'No one is waiting. Check walk-in availability with the OSS counter.') : 'No visits are waiting. New visits resume when the office opens.'}</p>`}
      </section>
    </div>
    <aside class="qd-help" ${!open ? 'hidden' : ''} aria-label="How to use this board">
      <ol class="qd-steps">
        <li><span class="qd-step-n">1</span><p>Find your number or Visit ID on your pass.</p></li>
        <li><span class="qd-step-n">2</span><p>Wait for it to appear under <b>Now calling</b>.</p></li>
        <li><span class="qd-step-n">3</span><p>Proceed to the counter shown beside it.</p></li>
      </ol>
      <ul class="qd-legend">
        <li><b>Priority</b><span>Senior citizens and persons with disabilities receive priority service.</span></li>
        <li><b>Appointment</b><span>Called when the scheduled time arrives, before walk-ins.</span></li>
        <li><b>Walk-in</b><span>First come, first served.</span></li>
      </ul>
      <p class="qd-foot">${open ? 'Lost your pass? Open <b>Check My Visit</b> on your phone.' : 'Start Visit and Check My Visit resume when the office reopens.'}</p>
    </aside>`;
}

function renderOfficeStatus() {
  const el = document.getElementById('officeStatus');
  if (!el) return;
  const db = loadDB();
  const maint = !!db.systemSettings.maintenanceMode;
  const open = isOfficeHours() && !maint;
  const waitingAll = waitingQueueSorted(db);
  const callable = waitingAll.filter(q => isDue(q)).length;
  const estimate = window.UniServeWalkInCapacity?.waitEstimates?.[waitingAll[0]?.id];
  const waitTxt = callable === 0 ? 'No wait' : Number.isFinite(estimate) ? fmtWaitDuration(estimate) : 'Unavailable';
  const serving = servingQueueEntries(db);
  const nowServing = serving.length ? serving.slice(0, 2).map(queueRef).join(', ') : '—';
  const title = open ? 'Open now' : 'Closed';
  el.dataset.officeOpen = String(open);
  const sub = maint ? 'The visitor portal is temporarily unavailable' : (open ? 'Office hours follow the calendar' : OfficeCalendar.status().lunch ? escapeHtml(OfficeCalendar.status().message) : 'Next opening: <span class="status-next-opening">' + escapeHtml(OfficeCalendar.status().nextLabel) + '</span>');
  el.innerHTML = `
    <div class="status-cell status-main">
      <div><div class="status-title">${title}</div><div class="status-sub">${sub}</div></div>
    </div>
    <div class="status-cell"><div class="status-num">${waitingAll.length}</div><div class="status-lbl">Waiting now</div></div>
    <div class="status-cell"><div class="status-num">${waitTxt}</div><div class="status-lbl">Estimated wait</div></div>
    <div class="status-cell"><div class="status-num${nowServing.length > 9 ? ' long' : ''}">${escapeHtml(nowServing)}</div><div class="status-lbl">Now serving</div></div>`;
}

function renderServicesPreview() {
  const grid = document.getElementById('svcPreviewGrid');
  if (!grid) return;
  const db = loadDB();
  const q = (document.getElementById('svcFilter')?.value || '').trim().toLowerCase();
  const list = db.services.filter(s => !q
    || s.label.toLowerCase().includes(q)
    || (s.desc || '').toLowerCase().includes(q)
    || (s.requirements || []).some(r => r.toLowerCase().includes(q)));
  grid.innerHTML = list.length ? list.map(s => `
    <a class="svc-preview-card svc-preview-link" href="../User/user.html?service=${encodeURIComponent(s.key)}" aria-label="Start a visit for ${escapeHtml(s.label)}">
      <div class="svc-preview-head">
        <span class="svc-preview-ic">${icon(s.icon || 'home', 22)}</span>
        <div><h3>${escapeHtml(s.label)}</h3><div class="desc">${escapeHtml(s.desc || '')}</div></div>
      </div>
      <div class="svc-bring">
        <div class="svc-bring-title">What to bring</div>
        ${s.requirements && s.requirements.length
          ? `<ul>${s.requirements.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
          : `<div class="muted" style="font-size:.86rem;">No documents required.</div>`}
      </div>
    </a>`).join('')
    : `<div class="svc-empty">No service matches &ldquo;${escapeHtml(q)}&rdquo;. Try another word.</div>`;
}

const STARS = n => '&#9733;'.repeat(n) + '&#9734;'.repeat(5 - n);
let landingFeedbackSummary=null,landingFeedbackLoading=false,landingFeedbackFetchedAt=0;
async function refreshLandingFeedback(){
 if(landingFeedbackLoading||Date.now()-landingFeedbackFetchedAt<30000)return;landingFeedbackLoading=true;
 try{const response=await fetch((globalThis.UniServeConfig?.apiBase||'http://127.0.0.1:8000/api')+'/public-feedback',{headers:{Accept:"application/json"},signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error("Unavailable");landingFeedbackSummary=await response.json();landingFeedbackFetchedAt=Date.now();renderFeedbackSection();}
 catch(_){const el=document.getElementById("feedbackBody");if(el&&!landingFeedbackSummary)el.innerHTML='<div class="fb-empty">Feedback is temporarily unavailable.</div>';}
 finally{landingFeedbackLoading=false;}
}
function renderFeedbackSection() {
  const el = document.getElementById('feedbackBody');
  if (!el) return;
  if(!landingFeedbackSummary){el.innerHTML='<div class="fb-empty">Loading feedback...</div>';refreshLandingFeedback();return;}
  const n=landingFeedbackSummary.total;
  if(!n){el.innerHTML='<div class="fb-empty">No feedback yet. Ratings from completed visits will appear here.</div>';return;}
  const avg=landingFeedbackSummary.average,satisfied=landingFeedbackSummary.satisfied,dist=landingFeedbackSummary.distribution;
  el.innerHTML = `
    <div class="fb-wrap">
      <div class="fb-top">
        <div class="fb-score">
          <div class="fb-score-val">${avg.toFixed(1)}</div>
          <div class="fb-score-stars" aria-hidden="true">${STARS(Math.round(avg))}</div>
          <div class="fb-score-sub">${satisfied}% satisfied &middot; ${n} ${n === 1 ? 'response' : 'responses'}</div>
        </div>
        <div class="fb-bars">${dist.map(d => `
          <div class="fb-bar-row"><span class="fb-bar-lbl">${d.s} &#9733;</span><span class="fb-bar-track"><span class="fb-bar-fill" style="width:${Math.round(d.count / n * 100)}%"></span></span><span class="fb-bar-n">${d.count}</span></div>`).join('')}
        </div>
      </div>

    </div>`;
}

function renderLandingInfo() {
  const s = loadDB().systemSettings;
  const setText = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = v; };
  setText('faqGrace', Number(s.gracePeriodMinutes) || DEFAULT_GRACE_MINUTES);
  setText('faqNoShow', Number(s.noShowThresholdMinutes) || DEFAULT_NOSHOW_MINUTES);
  setText('contactOrg', s.orgName || 'Office of Student Services');
  const email = document.getElementById('contactEmail');
  if (email) { email.textContent = s.supportEmail || '—'; email.href = s.supportEmail ? `mailto:${s.supportEmail}` : '#'; }
  const phone = document.getElementById('contactPhone');
  if (phone) { phone.textContent = s.supportPhone || '—'; phone.href = s.supportPhone ? `tel:${String(s.supportPhone).replace(/[^\d+]/g, '')}` : '#'; }
}

function renderLandingLive() {
  applyPortalAvailability();
  renderOfficeStatus();
  renderServicesPreview();
  refreshLandingFeedback();
  renderFeedbackSection();
  renderLandingInfo();
}

function toggleNav(force) {
  const actions = document.getElementById('navActions');
  const btn = document.getElementById('navToggle');
  if (!actions || !btn) return;
  const open = typeof force === 'boolean' ? force : !actions.classList.contains('open');
  actions.classList.toggle('open', open);
  btn.setAttribute('aria-expanded', String(open));
  btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  btn.innerHTML = open ? '&times;' : '&#9776;';
}
document.querySelectorAll('#navActions a').forEach(a => a.addEventListener('click', () => toggleNav(false)));

renderLandingLive();
setInterval(() => {
  if (document.hidden || document.getElementById('landing').hidden) return;
  renderOfficeStatus();
  applyPortalAvailability();
}, 20000);
window.addEventListener('storage', e => { if (e.key === DB_KEY) renderLandingLive(); });

(function initScrollReveal() {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const targets = document.querySelectorAll('.step, .feat-card, .contact-card, .faq-item');
  if (!targets.length) return;
  if (prefersReducedMotion || !('IntersectionObserver' in window)) {
    targets.forEach(el => el.classList.add('in-view'));
    return;
  }
  targets.forEach(el => el.classList.add('reveal'));
  const io = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const siblings = Array.from(el.parentElement.children).filter(c => c.classList.contains('reveal'));
      el.style.transitionDelay = `${Math.min(siblings.indexOf(el), 5) * 60}ms`;
      el.classList.add('in-view');
      io.unobserve(el);
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
  targets.forEach(el => io.observe(el));
})();

(function initNavScrollSpy() {
  const navLinks = Array.from(document.querySelectorAll('.nav-link[href^="#"]'));
  if (!navLinks.length) return;
  const sections = navLinks.map(a => ({ link: a, el: document.querySelector(a.getAttribute('href')) })).filter(s => s.el);
  if (!sections.length) return;
  const navEl = document.querySelector('.landing-nav');
  let ticking = false;
  function updateActive() {
    ticking = false;
    const probeY = window.scrollY + (navEl ? navEl.offsetHeight : 0) + 40;
    const atBottom = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
    let current = null;
    sections.forEach(s => { if (s.el.offsetTop <= probeY) current = s; });
    if (atBottom) current = sections[sections.length - 1];
    navLinks.forEach(a => a.classList.remove('active'));
    if (current) current.link.classList.add('active');
  }
  function onScroll() {
    if (!ticking) { window.requestAnimationFrame(updateActive); ticking = true; }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  updateActive();
})();

window.addEventListener('office-calendar-change', () => { applyPortalAvailability(); renderOfficeStatus(); if (!document.getElementById('publicDisplay').hidden) renderPublicDisplay(); });

function contactHoursHtml() {
  const cfg = OfficeCalendar.get(), names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], groups = [];
  for (const i of [1,2,3,4,5,6,0]) {
    const day = cfg.weekly[i], key = day.open ? day.start + '-' + day.end : 'closed';
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.days.push(names[i]);
    else groups.push({key,days:[names[i]],day});
  }
  const rows = groups.map(g => {
    const label = g.days.length > 1 ? g.days[0] + '\u2013' + g.days[g.days.length-1] : g.days[0];
    const hours = g.day.open ? OfficeCalendar.clock(g.day.start).replace(':00', '') + ' \u2013 ' + OfficeCalendar.clock(g.day.end).replace(':00', '') : 'Closed';
    return '<div class="office-hours-row"><dt>'+escapeHtml(label)+'</dt><dd>'+escapeHtml(hours)+'</dd></div>';
  });
  if (cfg.lunch.enabled) rows.push('<div class="office-hours-row office-hours-lunch"><dt>Lunch</dt><dd>'+escapeHtml(OfficeCalendar.clock(cfg.lunch.start).replace(':00', '')+' \u2013 '+OfficeCalendar.clock(cfg.lunch.end).replace(':00', ''))+'</dd></div>');
  return '<dl>'+rows.join('')+'</dl>';
}


// Keep the mobile menu control inside the hero even when notices appear.
(function(){
 const button=document.getElementById('navToggle'),hero=document.querySelector('#landing .hero');
 if(!button||!hero)return;
 const originalParent=button.parentNode,originalNext=button.nextSibling,media=matchMedia('(max-width:600px)');
 function place(){if(media.matches)hero.prepend(button);else originalParent.insertBefore(button,originalNext);}
 media.addEventListener('change',place);place();
})();
