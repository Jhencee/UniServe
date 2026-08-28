const DB_KEY = 'ossuniserve_db_v1';
const ROLES = { SUPER_ADMIN: { label: 'Super Admin' }, ADMIN: { label: 'Admin' } };
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

/* ---------------- id / date helpers ---------------- */
function uid(p) {
  const c = (Number(localStorage.getItem(DB_KEY + '_uidc')) || 1000) + 1;
  localStorage.setItem(DB_KEY + '_uidc', c);
  return p + c;
}
const pad2 = n => String(n).padStart(2, '0');
const fmtDate = d => { d = new Date(d); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const fmtTime = d => { d = new Date(d); let h = d.getHours(), m = pad2(d.getMinutes()), ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${m} ${ap}`; };
const fmtDateTime = d => `${fmtDate(d)} &middot; ${fmtTime(d)}`;
const today = () => fmtDate(new Date());
function escapeHtml(s) { if (s == null) return ''; return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ---------------- seed / persistence ---------------- */
function freshState() {
  return {
    users: [
      { id: 'u1', username: 'admin', password: 'admin123', fullName: 'System Administrator', role: 'SUPER_ADMIN', active: true },
      { id: 'u2', username: 'oss.admin', password: '1234', fullName: 'Maria Santos', role: 'ADMIN', active: true },
      { id: 'u3', username: 'oss.admin2', password: '1234', fullName: 'Dr. Ramon Cruz', role: 'ADMIN', active: true },
    ],
    services: DEFAULT_SERVICES.map(s => ({ ...s, requirements: [...s.requirements] })),
    transactions: [], appointments: [], incidents: [], scholarships: [], chats: [],
    activityLog: [], queues: [], queueCounters: {},
    systemSettings: { orgName: 'Office of Student Services', supportEmail: 'oss@university.edu.ph', supportPhone: '0917-000-0000', timezone: 'Asia/Manila', maintenanceMode: false, autoCloseChats: false, sessionTimeout: 30, queuePrefixStudent: 'A', queuePrefixGuest: 'G' },
  };
}
function mkLog(user, role, action, ts) { return { id: uid('L'), user, role, action, ts: ts || new Date() }; }
function mkTxn(o) { return { id: uid('T'), code: randCode('OSS'), status: 'Pending', ...o, updatedAt: o.createdAt || new Date() }; }
function mkAppt(o) { return { id: uid('A'), code: randCode('APT'), ...o }; }
function mkIncident(o) { return { id: uid('IR'), code: randCode('INC'), actions: '', sensitive: true, ...o }; }
function mkScholarship(o) { return { id: uid('SCH'), ...o }; }
function mkChat(o) { return { id: uid('CH'), code: randCode('CHT'), status: 'Open', messages: [], staffUnread: 0, visitorUnread: 0, ...o }; }
const randCode = (prefix) => { const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)]; return `${prefix}-${s}`; };
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
function seedDemoData(s) {
  const t = s.transactions;
  t.push(mkTxn({ name: 'Jomar Ibanez', type: 'Student', idNumber: '2021-04123', section: 'BSIT-3A', service: 'good_moral', details: 'For scholarship application', status: 'Completed', createdAt: daysAgo(1) }));
  t.push(mkTxn({ name: 'Carla Dizon', type: 'Student', idNumber: '2022-01187', section: 'BSED-2B', service: 'student_id', details: 'Lost ID, requesting replacement', status: 'Processing', createdAt: daysAgo(0) }));
  t.push(mkTxn({ name: 'Enzo Marasigan', type: 'Student', idNumber: '2020-09982', section: 'BSCE-4A', service: 'excuse_letter', details: 'Absence due to medical appointment', status: 'Approved', createdAt: daysAgo(0) }));
  t.push(mkTxn({ name: 'Rhea Villaflor', type: 'Student', idNumber: '2021-11045', section: 'BSBA-3C', service: 'offcampus', details: 'Immersion at City Hall - Aug 20', status: 'Pending', createdAt: daysAgo(0) }));
  t.push(mkTxn({ name: 'Kite Society', type: 'Student', idNumber: 'ORG-0012', section: 'Org', service: 'orgevent', details: 'General Assembly, Aug 25', status: 'Approved', createdAt: daysAgo(2) }));
  t.push(mkTxn({ name: "Men's Basketball Team", type: 'Student', idNumber: 'SPORTS-04', section: 'Athletics', service: 'sportsevent', details: 'Away game vs. Rival College', status: 'Pending', createdAt: daysAgo(0) }));
  t.push(mkTxn({ name: 'Noah Buenaflor', type: 'Student', idNumber: '2019-07765', section: 'BSA-4B', service: 'lost_document', details: 'Lost TOR copy', status: 'Completed', createdAt: daysAgo(3) }));
  t.push(mkTxn({ name: 'Divine Aquino', type: 'Student', idNumber: '2022-05678', section: 'BSN-1A', service: 'scholarship_txn', details: 'Financial Assistance Grant renewal', status: 'Pending', createdAt: daysAgo(1) }));
  t.push(mkTxn({ name: 'Kite Society', type: 'Student', idNumber: 'ORG-0012', section: 'Org', service: 'activity_approval', details: 'Approval for General Assembly venue', status: 'Approved', createdAt: daysAgo(2) }));

  const a = s.appointments;
  a.push(mkAppt({ name: 'Liza Fernandez', type: 'Guest', contact: '0917-555-0199', service: 'Parent Consultation', date: today(), time: '10:00 AM', status: 'Booked' }));
  a.push(mkAppt({ name: 'Marco Villareal', type: 'Student', idNumber: '2021-03321', contact: '0928-555-0142', service: 'Scholarship Inquiry', date: today(), time: '2:00 PM', status: 'Booked' }));
  a.push(mkAppt({ name: 'Grace Uy', type: 'Guest', contact: '0995-555-0177', service: 'Vendor Coordination', date: fmtDate(daysAgo(-1)), time: '9:30 AM', status: 'Booked' }));

  const inc = s.incidents;
  inc.push(mkIncident({ reporter: 'Maria Santos', involved: '2021-08871 &middot; J. Delacruz', description: 'Minor altercation reported near the covered court during break time.', status: 'Under Review', createdAt: daysAgo(1) }));
  inc.push(mkIncident({ reporter: 'Dr. Ramon Cruz', involved: '2020-02234 &middot; A. Manlapig', description: 'Repeated tardiness flagged by class adviser, referred for counseling.', status: 'Resolved', createdAt: daysAgo(5) }));

  const sc = s.scholarships;
  sc.push(mkScholarship({ name: 'Jomar Ibanez', idNumber: '2021-04123', program: 'Academic Scholarship', doc: 'Grade Report + Good Moral', status: 'Approved', createdAt: daysAgo(6) }));
  sc.push(mkScholarship({ name: 'Divine Aquino', idNumber: '2022-05678', program: 'Financial Assistance Grant', doc: 'Certificate of Indigency', status: 'Pending', createdAt: daysAgo(1) }));

  const c1 = mkChat({ visitorName: 'Divine Aquino', visitorType: 'Student', contact: '0917-555-0212', status: 'Open', createdAt: daysAgo(0), updatedAt: daysAgo(0) });
  c1.messages.push({ id: uid('MSG'), sender: 'visitor', senderName: 'Divine Aquino', text: 'Hi, may I ask about the status of my scholarship application?', ts: daysAgo(0) });
  c1.staffUnread = 1;
  s.chats.push(c1);

  const c2 = mkChat({ visitorName: 'Grace Uy', visitorType: 'Guest', contact: '0995-555-0177', status: 'Open', createdAt: daysAgo(1), updatedAt: daysAgo(1) });
  c2.messages.push({ id: uid('MSG'), sender: 'visitor', senderName: 'Grace Uy', text: 'Good day, can I confirm our vendor coordination meeting time tomorrow?', ts: daysAgo(1) });
  c2.messages.push({ id: uid('MSG'), sender: 'staff', senderName: 'Maria Santos', text: 'Yes, 9:30 AM at the OSS front desk. See you then!', ts: daysAgo(1) });
  s.chats.push(c2);
}

const DATE_FIELDS = ['createdAt', 'updatedAt', 'calledAt', 'servingAt', 'completedAt', 'recalledAt', 'transferredAt', 'ts'];
function reviveDates(obj) {
  if (Array.isArray(obj)) { obj.forEach(reviveDates); return obj; }
  if (obj && typeof obj === 'object') { Object.keys(obj).forEach(k => { if (DATE_FIELDS.includes(k) && obj[k]) obj[k] = new Date(obj[k]); else reviveDates(obj[k]); }); }
  return obj;
}
function loadDB() {
  const raw = localStorage.getItem(DB_KEY);
  if (!raw) { const s = freshState(); localStorage.setItem(DB_KEY, JSON.stringify(s)); return s; }
  try { return reviveDates(JSON.parse(raw)); }
  catch (e) { const s = freshState(); localStorage.setItem(DB_KEY, JSON.stringify(s)); return s; }
}
function saveDB(s) { localStorage.setItem(DB_KEY, JSON.stringify(s)); }
function loadSession() { try { return JSON.parse(sessionStorage.getItem('ossuniserve_session') || '{}'); } catch (e) { return {}; } }
function saveSession(obj) { sessionStorage.setItem('ossuniserve_session', JSON.stringify(obj)); }
function logActivity(db, currentUser, action) { if (!currentUser) return; db.activityLog.unshift(mkLog(currentUser.fullName, currentUser.role, action, new Date())); }

/* ---------------- queue stats (dashboard widget only) ---------------- */
function todaysQueue(db) { const t = today(); return db.queues.filter(q => fmtDate(q.createdAt) === t); }
function waitingQueueSorted(db) { const rank = { Priority: 0, Appointment: 1, 'Walk-in': 2 }; return db.queues.filter(q => q.status === 'Waiting').sort((a, b) => (rank[a.source] ?? 2) - (rank[b.source] ?? 2) || (new Date(a.createdAt) - new Date(b.createdAt))); }
function queueStats(db) {
  const list = todaysQueue(db);
  const waiting = list.filter(q => q.status === 'Waiting').length;
  const serving = list.filter(q => q.status === 'Serving' || q.status === 'Called').length;
  const completed = list.filter(q => q.status === 'Completed');
  let avgWaitMin = null;
  const withWait = completed.filter(q => q.calledAt);
  if (withWait.length) { const totalMs = withWait.reduce((s, q) => s + (new Date(q.calledAt) - new Date(q.createdAt)), 0); avgWaitMin = Math.round((totalMs / withWait.length) / 60000); }
  const next = waitingQueueSorted(db)[0] || null;
  return { waiting, serving, completedToday: completed.length, avgWaitMin, next };
}
function serviceLabel(db, key) { const s = db.services.find(x => x.key === key); return s ? s.label : key; }

/* ---------------- icons / crest / toast / modal / theme ---------------- */
function icon(name, size = 17) {
  const p = {
    dashboard: 'M4 13h6V4H4v9zm0 7h6v-5H4v5zm10 0h6V11h-6v9zm0-16v5h6V4h-6z',
    folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z',
    chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    log: 'M4 6h16M4 12h16M4 18h10',
    users: 'M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M13 7a4 4 0 11-8 0 4 4 0 018 0M23 21v-2a4 4 0 00-3-3.87M17 3.13a4 4 0 010 7.75',
    lock: 'M5 11h14v9H5v-9zM8 11V7a4 4 0 118 0v4',
    check: 'M20 6L9 17l-5-5',
    x: 'M18 6L6 18M6 6l12 12',
    gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z',
    userc: 'M12 12a5 5 0 100-10 5 5 0 000 10zM3 21a9 9 0 0118 0',
    download: 'M12 3v12M6 11l6 6 6-6M5 21h14',
    trash: 'M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m2 0v14a1 1 0 01-1 1H7a1 1 0 01-1-1V6h12z',
    plus: 'M12 5v14M5 12h14',
    search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35',
    print: 'M6 9V2h12v7M6 18H4a1 1 0 01-1-1v-6a1 1 0 011-1h16a1 1 0 011 1v6a1 1 0 01-1 1h-2M6 14h12v8H6v-8z',
    ticket: 'M4 8a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2a2 2 0 000-4V8zM10 6v2M10 11v2M10 16v2',
  }[name] || 'M12 2v20';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p.split('M').filter(Boolean).map(seg => `<path d="M${seg}"/>`).join('')}</svg>`;
}
function crestSVG(size = 40) {
  return `<img src="pup.jpg" alt="PUP logo" style="width:${size}px;height:${size}px;object-fit:contain;">`;
}
function toast(msg, type = 'ok') {
  const wrap = document.getElementById('toastWrap');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${icon(type === 'err' ? 'x' : 'check', 15)} ${msg}`;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
function openModal(title, bodyHtml, buttons) {
  closeModal();
  const wrap = document.createElement('div');
  wrap.className = 'overlay'; wrap.id = 'activeModal';
  wrap.innerHTML = `<div class="modal"><div class="modal-head"><h3>${title}</h3><button class="close-x" id="modalCloseX">${icon('x', 18)}</button></div><div class="modal-body">${bodyHtml}</div><div class="modal-foot">${buttons.map((b, i) => `<button class="btn ${b.cls} btn-sm" id="modalBtn${i}">${b.label}</button>`).join('')}</div></div>`;
  document.body.appendChild(wrap);
  buttons.forEach((b, i) => document.getElementById(`modalBtn${i}`).onclick = b.action);
  document.getElementById('modalCloseX').onclick = closeModal;
  wrap.addEventListener('click', e => { if (e.target === wrap) closeModal(); });
}
function closeModal() { const m = document.getElementById('activeModal'); if (m) m.remove(); }
function setTheme(t) { localStorage.setItem('ossuniserve_theme', t); document.documentElement.setAttribute('data-theme', t); document.querySelectorAll('[data-theme-btn]').forEach(b => b.classList.toggle('active', b.dataset.themeBtn === t)); }
setTheme(localStorage.getItem('ossuniserve_theme') || 'light');

/* =========================================================================
   AUTH GUARD — this page is Super Admin-only.
========================================================================= */
let currentUser = null;
(function guard() {
  const sess = loadSession();
  const db = loadDB();
  const fresh = sess.currentUser ? db.users.find(u => u.id === sess.currentUser.id) : null;
  if (!fresh || fresh.role !== 'SUPER_ADMIN' || !fresh.active) {
    location.href = '../Landing/landing.html';
    throw new Error('OSS UniServe: not an authorized Super Admin session — redirecting to login.');
  }
  currentUser = fresh;
})();
function doLogout() {
  const db = loadDB();
  logActivity(db, currentUser, 'Logged out');
  saveDB(db);
  sessionStorage.removeItem('ossuniserve_session');
  location.href = '../Landing/landing.html';
}

/* =========================================================================
   NAV — Super Admin is system maintenance only: no service modules.
========================================================================= */
const NAV = [
  { key: 'dashboard', label: 'Dashboard', ic: 'dashboard' },
  { key: 'reports', label: 'Reports', ic: 'chart' },
  { key: 'activitylog', label: 'Activity Log', ic: 'log' },
  { key: 'users', label: 'User Management', ic: 'users' },
  { key: 'settings', label: 'System Settings', ic: 'gear' },
  { key: 'backup', label: 'Backup & Data', ic: 'download' },
  { key: 'profile', label: 'My Profile', ic: 'userc' },
];
const TITLES = {
  dashboard: ['Dashboard', "Overview of today's activity"],
  reports: ['Reports', 'Generate printable office reports'],
  activitylog: ['Activity Log', 'System-wide audit trail &mdash; Super Admin only'],
  users: ['User Management', 'Manage staff accounts and roles &mdash; Super Admin only'],
  settings: ['System Settings', 'Office details, defaults & maintenance mode &mdash; Super Admin only'],
  backup: ['Backup & Data', 'Export system data and manage the demo dataset &mdash; Super Admin only'],
  profile: ['My Profile', 'Manage your account details'],
};

document.getElementById('crestSlotD').innerHTML = crestSVG(34);
document.getElementById('avatarInit').textContent = currentUser.fullName.split(' ').map(s => s[0]).slice(0, 2).join('');
document.getElementById('userNameLbl').textContent = currentUser.fullName;
document.getElementById('userRoleLbl').textContent = ROLES[currentUser.role].label;

function tickClock() { const d = new Date(); const lbl = document.getElementById('clockLbl'); if (lbl) lbl.textContent = `${fmtDate(d)}  ${fmtTime(d)}`; }
setInterval(tickClock, 1000 * 20); tickClock();

let state_view = 'dashboard';

function renderSidebar() {
  const list = document.getElementById('navList');
  list.innerHTML = NAV.map(n => `<li><button class="nav-item ${state_view === n.key ? 'active' : ''}" onclick="navigate('${n.key}')">${icon(n.ic)}<span>${n.label}</span></button></li>`).join('');
}
function navigate(key) {
  if (!TITLES[key]) key = 'dashboard';
  state_view = key;
  document.getElementById('pageTitle').textContent = TITLES[key][0];
  document.getElementById('pageSub').innerHTML = TITLES[key][1];
  renderSidebar();
  document.getElementById('sidebar').classList.remove('open');
  const renderers = { dashboard: renderDashboard, reports: renderReports, activitylog: renderActivityLog, users: renderUsers, settings: renderSettings, backup: renderBackup, profile: renderProfile };
  renderers[key]();
}
function statusPill(status) {
  const map = { Pending: 'pill-warn', Processing: 'pill-info', Approved: 'pill-ok', Completed: 'pill-ok', Rejected: 'pill-danger', Booked: 'pill-info', 'Checked-in': 'pill-gold', Cancelled: 'pill-danger', 'Under Review': 'pill-warn', Resolved: 'pill-ok', Open: 'pill-info', Closed: 'pill-danger' };
  return `<span class="pill ${map[status] || 'pill-info'}">${status}</span>`;
}

/* =========================================================================
   DASHBOARD — system-wide overview (no service-module widgets, since
   Admin owns day-to-day service work; this is the maintenance view).
========================================================================= */
function renderDashboard() {
  const db = loadDB();
  const t = today();
  const todaysTxn = db.transactions.filter(x => fmtDate(x.createdAt) === t);
  const pending = db.transactions.filter(x => x.status === 'Pending').length;
  const todaysAppt = db.appointments.filter(x => x.date === t);
  const qs = queueStats(db);
  const recent = [...db.transactions].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  const upcoming = db.appointments.filter(a => a.status === 'Booked').slice(0, 5);

  document.getElementById('content').innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="lbl">Today's Transactions</div><div class="val">${todaysTxn.length}</div><div class="sub">across all services</div></div>
      <div class="stat-card"><div class="lbl">Pending Requests</div><div class="val">${pending}</div><div class="sub">awaiting processing</div></div>
      <div class="stat-card"><div class="lbl">Today's Appointments</div><div class="val">${todaysAppt.length}</div><div class="sub">booked visits</div></div>
      <div class="stat-card"><div class="lbl">Staff Accounts</div><div class="val">${db.users.length}</div><div class="sub">${db.users.filter(u => u.active).length} active</div></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><h3>Recent Transactions</h3><div class="desc">Latest requests logged across the office</div></div></div>
        <div class="table-wrap"><table><thead><tr><th>Code</th><th>Requestor</th><th>Service</th><th>Status</th><th>Logged</th></tr></thead>
          <tbody>${recent.length ? recent.map(r => `<tr><td class="mono">${r.code}</td><td>${escapeHtml(r.name)}</td><td>${serviceLabel(db, r.service)}</td><td>${statusPill(r.status)}</td><td class="muted">${fmtDateTime(r.createdAt)}</td></tr>`).join('') : `<tr class="empty-row"><td colspan="5">No transactions yet.</td></tr>`}</tbody>
        </table></div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Upcoming Appointments</h3><div class="desc">Booked visits</div></div></div>
        <div class="table-wrap"><table><thead><tr><th>Visitor</th><th>Date</th></tr></thead>
          <tbody>${upcoming.length ? upcoming.map(a => `<tr><td>${escapeHtml(a.name)}<div class="muted" style="font-size:.72rem;">${a.service}</div></td><td class="muted">${a.date}<br><span class="mono" style="font-size:.72rem;">${a.time}</span></td></tr>`).join('') : `<tr class="empty-row"><td colspan="2">No upcoming appointments.</td></tr>`}</tbody>
        </table></div>
      </div>
    </div>
    <div class="card" style="margin-top:18px;">
      <div class="card-head"><div><h3>Live Queue</h3><div class="desc">Read-only overview &mdash; queue is managed by OSS Admin</div></div></div>
      <div class="card-pad"><div class="stat-grid" style="margin-bottom:0;">
        <div class="stat-card"><div class="lbl">Currently Waiting</div><div class="val">${qs.waiting}</div></div>
        <div class="stat-card"><div class="lbl">Currently Serving</div><div class="val">${qs.serving}</div></div>
        <div class="stat-card"><div class="lbl">Next Number</div><div class="val" style="font-size:1.4rem;">${qs.next ? qs.next.number : '&mdash;'}</div></div>
        <div class="stat-card"><div class="lbl">Average Wait</div><div class="val">${qs.avgWaitMin == null ? '&mdash;' : qs.avgWaitMin + 'm'}</div></div>
      </div></div>
    </div>
  `;
}

/* =========================================================================
   REPORTS
========================================================================= */
let reportPeriod = 'Daily';
function renderReports() {
  document.getElementById('content').innerHTML = `
    <div class="card card-pad no-print">
      <div class="subnav"><button class="active" onclick="setReportPeriod('Daily',this)">Daily</button><button onclick="setReportPeriod('Weekly',this)">Weekly</button><button onclick="setReportPeriod('Monthly',this)">Monthly</button><button onclick="setReportPeriod('Quarterly',this)">Quarterly</button></div>
      <button class="btn btn-primary btn-sm" onclick="window.print()">${icon('print', 14)} Print Report</button>
    </div>
    <div class="card card-pad" id="printArea" style="margin-top:16px;">
      <div class="report-header"><span class="crest">${crestSVG(46)}</span><div class="t"><small>Office of Student Services</small><h2 id="repTitle">Daily Transaction Report</h2></div></div>
      <div class="report-meta"><span id="repPeriodLbl"></span><span id="repGenLbl"></span></div>
      <div id="repBody"></div>
    </div>
  `;
  buildReport();
}
function setReportPeriod(p, el) { reportPeriod = p; document.querySelectorAll('.subnav button').forEach(b => b.classList.remove('active')); el.classList.add('active'); buildReport(); }
function periodStart(p) { const d = new Date(); if (p === 'Daily') { d.setHours(0, 0, 0, 0); } else if (p === 'Weekly') { d.setDate(d.getDate() - 7); } else if (p === 'Monthly') { d.setDate(d.getDate() - 30); } else { d.setDate(d.getDate() - 90); } return d; }
function buildReport() {
  const db = loadDB();
  document.getElementById('repTitle').textContent = `${reportPeriod} Transaction Report`;
  const start = periodStart(reportPeriod);
  document.getElementById('repPeriodLbl').textContent = `Period: ${fmtDate(start)} to ${today()}`;
  document.getElementById('repGenLbl').textContent = `Generated: ${fmtDateTime(new Date())} by ${currentUser.fullName}`;
  const txns = db.transactions.filter(t => t.createdAt >= start);
  const appts = db.appointments.filter(a => new Date(a.date) >= new Date(fmtDate(start)));
  const counts = {}; db.services.forEach(s => counts[s.key] = 0);
  txns.forEach(t => { counts[t.service] = (counts[t.service] || 0) + 1; });
  document.getElementById('repBody').innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="lbl">Total Transactions</div><div class="val">${txns.length}</div></div>
      <div class="stat-card"><div class="lbl">Appointments Booked</div><div class="val">${appts.length}</div></div>
      <div class="stat-card"><div class="lbl">Completed</div><div class="val">${txns.filter(t => t.status === 'Completed').length}</div></div>
      <div class="stat-card"><div class="lbl">Pending</div><div class="val">${txns.filter(t => t.status === 'Pending').length}</div></div>
    </div>
    <h3 style="font-size:.95rem; margin-bottom:10px;">Breakdown by Service</h3>
    <div class="table-wrap"><table><thead><tr><th>Service</th><th>Count</th></tr></thead><tbody>${db.services.map(s => `<tr><td>${s.label}</td><td>${counts[s.key] || 0}</td></tr>`).join('')}</tbody></table></div>
  `;
}

/* =========================================================================
   ACTIVITY LOG
========================================================================= */
function renderActivityLog() {
  document.getElementById('content').innerHTML = `
    <div class="card">
      <div class="card-head"><div><h3>Activity Log <span class="badge-role">${icon('lock', 12)} Super Admin</span></h3><div class="desc">Login records and system actions</div></div>
        <div class="search-box">${icon('search', 15)}<input id="logSearch" placeholder="Search user or action" oninput="renderLogTable()"></div></div>
      <div class="table-wrap"><table><thead><tr><th>User</th><th>Role</th><th>Action</th><th>Timestamp</th></tr></thead><tbody id="logBody"></tbody></table></div>
    </div>
  `;
  renderLogTable();
}
function renderLogTable() {
  const db = loadDB();
  const q = (document.getElementById('logSearch')?.value || '').toLowerCase();
  let rows = [...db.activityLog];
  if (q) rows = rows.filter(r => r.user.toLowerCase().includes(q) || r.action.toLowerCase().includes(q));
  document.getElementById('logBody').innerHTML = rows.length ? rows.map(r => `<tr><td>${r.user}</td><td><span class="badge-role">${ROLES[r.role]?.label || r.role}</span></td><td>${r.action}</td><td class="muted mono">${fmtDateTime(r.ts)}</td></tr>`).join('') : `<tr class="empty-row"><td colspan="4">No activity recorded.</td></tr>`;
}

/* =========================================================================
   USER MANAGEMENT
========================================================================= */
function renderUsers() {
  document.getElementById('content').innerHTML = `
    <div class="card">
      <div class="card-head"><div><h3>Staff Accounts</h3><div class="desc">Manage roles and access to OSS UniServe &mdash; Super Admin only</div></div>
        <button class="btn btn-primary btn-sm" onclick="openUserForm()">${icon('plus', 14)} Add User</button></div>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody id="userBody"></tbody></table></div>
    </div>
  `;
  renderUserTable();
}
function renderUserTable() {
  const db = loadDB();
  document.getElementById('userBody').innerHTML = db.users.map(u => `<tr>
    <td>${u.fullName}</td><td class="mono">${u.username}</td><td><span class="badge-role">${ROLES[u.role].label}</span></td>
    <td>${u.active ? '<span class="pill pill-ok">Active</span>' : '<span class="pill pill-danger">Disabled</span>'}</td>
    <td style="display:flex; gap:6px;"><button class="icon-btn" title="Toggle status" onclick="toggleUser('${u.id}')">${icon(u.active ? 'lock' : 'check', 14)}</button>${u.id !== 'u1' ? `<button class="icon-btn" title="Remove" onclick="deleteUser('${u.id}')">${icon('trash', 14)}</button>` : ''}</td>
  </tr>`).join('');
}
function toggleUser(id) {
  const db = loadDB();
  const u = db.users.find(x => x.id === id);
  u.active = !u.active;
  logActivity(db, currentUser, `${u.active ? 'Activated' : 'Deactivated'} account ${u.username}`);
  saveDB(db);
  renderUserTable();
}
function deleteUser(id) {
  const db = loadDB();
  const u = db.users.find(x => x.id === id);
  if (!confirm(`Remove account "${u.username}"?`)) return;
  db.users = db.users.filter(x => x.id !== id);
  logActivity(db, currentUser, `Removed account ${u.username}`);
  saveDB(db);
  renderUserTable();
}
function openUserForm() {
  openModal('Add Staff Account', `
    <div class="field"><label>Full Name</label><input id="mUsName"></div>
    <div class="form-row"><div class="field"><label>Username</label><input id="mUsUser"></div><div class="field"><label>Password</label><input id="mUsPass" type="text" value="1234"></div></div>
    <div class="field"><label>Role</label><select id="mUsRole">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></div>
  `, [{ label: 'Cancel', cls: 'btn-ghost', action: closeModal },
  {
    label: 'Create Account', cls: 'btn-primary', action: () => {
      const name = document.getElementById('mUsName').value.trim();
      const user = document.getElementById('mUsUser').value.trim();
      if (!name || !user) { toast('Name and username are required.', 'err'); return; }
      const db = loadDB();
      if (db.users.some(u => u.username.toLowerCase() === user.toLowerCase())) { toast('Username already exists.', 'err'); return; }
      db.users.push({ id: uid('u'), username: user, password: document.getElementById('mUsPass').value || '1234', fullName: name, role: document.getElementById('mUsRole').value, active: true });
      logActivity(db, currentUser, `Created account ${user}`);
      saveDB(db);
      closeModal(); renderUserTable(); toast('Account created.', 'ok');
    }
  }]);
}

/* =========================================================================
   SYSTEM SETTINGS
========================================================================= */
function renderSettings() {
  const db = loadDB();
  const s = db.systemSettings;
  document.getElementById('content').innerHTML = `
    <div class="card">
      <div class="settings-block">
        <h4>Office Details</h4>
        <div class="desc-txt">Shown on printed reports, visitor passes and the landing page.</div>
        <div class="field"><label>Organization Name</label><input id="stOrg" value="${escapeHtml(s.orgName)}"></div>
        <div class="form-row"><div class="field"><label>Support Email</label><input id="stEmail" value="${escapeHtml(s.supportEmail)}"></div><div class="field"><label>Support Phone</label><input id="stPhone" value="${escapeHtml(s.supportPhone)}"></div></div>
        <div class="field"><label>Timezone</label><select id="stTz">${['Asia/Manila', 'Asia/Singapore', 'Asia/Hong_Kong', 'UTC'].map(tz => `<option ${s.timezone === tz ? 'selected' : ''}>${tz}</option>`).join('')}</select></div>
      </div>
      <div class="settings-block">
        <h4>Queue Numbers</h4>
        <div class="desc-txt">Prefixes used when generating a queue number at the Visitor Portal / OSS QR entry point.</div>
        <div class="form-row"><div class="field"><label>Student Prefix</label><input id="stQPrefixStudent" maxlength="2" value="${escapeHtml(s.queuePrefixStudent || 'A')}"></div><div class="field"><label>Guest Prefix</label><input id="stQPrefixGuest" maxlength="2" value="${escapeHtml(s.queuePrefixGuest || 'G')}"></div></div>
      </div>
      <div class="settings-block">
        <h4>Session &amp; Access</h4>
        <div class="desc-txt">Applies to staff sessions across Admin and Super Admin accounts.</div>
        <div class="field"><label>Session Timeout (minutes)</label><input id="stTimeout" type="number" min="5" max="180" value="${s.sessionTimeout}"></div>
      </div>
      <div class="settings-block">
        <h4>System Maintenance</h4>
        <div class="desc-txt">Temporarily restrict visitor-facing access while the office performs maintenance.</div>
        <div class="switch-row"><div><div class="lbl">Maintenance Mode</div><div class="sub">Visitor Portal shows a closed notice; staff login stays available</div></div><label class="switch"><input type="checkbox" id="stMaint" ${s.maintenanceMode ? 'checked' : ''}><span class="track"></span></label></div>
        <div class="switch-row"><div><div class="lbl">Auto-close inactive chats</div><div class="sub">Automatically mark chats with no reply after 7 days as Closed</div></div><label class="switch"><input type="checkbox" id="stAutoClose" ${s.autoCloseChats ? 'checked' : ''}><span class="track"></span></label></div>
      </div>
      <div class="modal-foot" style="border-top:1px solid var(--border);"><button class="btn btn-primary" onclick="saveSettings()">Save Settings</button></div>
    </div>
  `;
}
function saveSettings() {
  const db = loadDB();
  const s = db.systemSettings;
  s.orgName = document.getElementById('stOrg').value.trim() || s.orgName;
  s.supportEmail = document.getElementById('stEmail').value.trim();
  s.supportPhone = document.getElementById('stPhone').value.trim();
  s.timezone = document.getElementById('stTz').value;
  s.sessionTimeout = Number(document.getElementById('stTimeout').value) || 30;
  s.maintenanceMode = document.getElementById('stMaint').checked;
  s.autoCloseChats = document.getElementById('stAutoClose').checked;
  s.queuePrefixStudent = (document.getElementById('stQPrefixStudent').value.trim() || 'A').toUpperCase().slice(0, 2);
  s.queuePrefixGuest = (document.getElementById('stQPrefixGuest').value.trim() || 'G').toUpperCase().slice(0, 2);
  logActivity(db, currentUser, 'Updated system settings');
  saveDB(db);
  toast('System settings saved.', 'ok');
}

/* =========================================================================
   BACKUP & DATA
========================================================================= */
function renderBackup() {
  const db = loadDB();
  document.getElementById('content').innerHTML = `
    <div class="card">
      <div class="settings-block">
        <h4>Export Data</h4>
        <div class="desc-txt">Download a snapshot of all transactions, appointments, incidents, scholarships, chats and services as JSON.</div>
        <button class="btn btn-primary btn-sm" onclick="exportAllData()">${icon('download', 14)} Export All Data (.json)</button>
      </div>
      <div class="settings-block">
        <h4>Storage Summary</h4>
        <div class="desc-txt">This is an in-memory prototype (persisted to your browser's local storage) &mdash; all data lives in this browser only.</div>
        <div class="kv"><span>Transactions</span><span>${db.transactions.length}</span></div>
        <div class="kv"><span>Appointments</span><span>${db.appointments.length}</span></div>
        <div class="kv"><span>Incident Reports</span><span>${db.incidents.length}</span></div>
        <div class="kv"><span>Scholarship Records</span><span>${db.scholarships.length}</span></div>
        <div class="kv"><span>Chat Conversations</span><span>${db.chats.length}</span></div>
        <div class="kv"><span>Queue Numbers Issued Today</span><span>${todaysQueue(db).length}</span></div>
        <div class="kv"><span>Services in Catalog</span><span>${db.services.length}</span></div>
        <div class="kv"><span>Staff Accounts</span><span>${db.users.length}</span></div>
      </div>
      <div class="settings-block">
        <h4>Reset Demo Data</h4>
        <div class="desc-txt">Clears all transactions, appointments, incidents, scholarships, chats and queue numbers, and reloads the original sample records. Staff accounts and the service catalog are kept.</div>
        <button class="btn btn-danger-o btn-sm" onclick="resetDemoData()">${icon('trash', 14)} Reset Demo Data</button>
      </div>
    </div>
  `;
}
function exportAllData() {
  const db = loadDB();
  const payload = { exportedAt: new Date().toISOString(), exportedBy: currentUser.fullName, systemSettings: db.systemSettings, services: db.services, transactions: db.transactions, appointments: db.appointments, incidents: db.incidents, scholarships: db.scholarships, chats: db.chats, queues: db.queues, activityLog: db.activityLog };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `oss-uniserve-export-${today()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  const db2 = loadDB();
  logActivity(db2, currentUser, 'Exported system data');
  saveDB(db2);
  toast('Export downloaded.', 'ok');
}
function resetDemoData() {
  if (!confirm('Reset all transactions, appointments, incidents, scholarships and chats? Staff accounts, services and the activity history are kept.')) return;
  const db = loadDB();
  const keptUsers = db.users, keptServices = db.services, keptSettings = db.systemSettings, keptLog = db.activityLog;
  const fresh = freshState();
  fresh.users = keptUsers; fresh.services = keptServices; fresh.systemSettings = keptSettings; fresh.activityLog = keptLog;
  seedDemoData(fresh);
  logActivity(fresh, currentUser, 'Reset demo dataset');
  saveDB(fresh);
  renderBackup();
  toast('Demo data reset.', 'ok');
}

/* =========================================================================
   PROFILE
========================================================================= */
function renderProfile() {
  const u = currentUser;
  const initials = u.fullName.split(' ').map(s => s[0]).slice(0, 2).join('');
  document.getElementById('content').innerHTML = `
    <div class="card" style="max-width:560px;">
      <div class="profile-head"><div class="profile-avatar">${initials}</div><div><div style="font-weight:700; font-size:1.05rem;">${escapeHtml(u.fullName)}</div><span class="badge-role">${ROLES[u.role].label}</span></div></div>
      <div class="card-pad">
        <div class="field"><label>Full Name</label><input id="pfName" value="${escapeHtml(u.fullName)}"></div>
        <div class="field"><label>Username</label><input id="pfUser" value="${escapeHtml(u.username)}"></div>
        <div class="divider"></div>
        <div class="field-hint" style="margin-bottom:10px;">Leave the password fields blank to keep your current password.</div>
        <div class="form-row"><div class="field"><label>New Password</label><input id="pfPass" type="password" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;"></div><div class="field"><label>Confirm New Password</label><input id="pfPass2" type="password" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;"></div></div>
        <button class="btn btn-primary btn-block" onclick="saveProfile()">Save Changes</button>
      </div>
    </div>
  `;
}
function saveProfile() {
  const name = document.getElementById('pfName').value.trim();
  const uname = document.getElementById('pfUser').value.trim();
  const pass = document.getElementById('pfPass').value;
  const pass2 = document.getElementById('pfPass2').value;
  if (!name || !uname) { toast('Name and username are required.', 'err'); return; }
  const db = loadDB();
  if (db.users.some(x => x.id !== currentUser.id && x.username.toLowerCase() === uname.toLowerCase())) { toast('That username is already taken.', 'err'); return; }
  if (pass || pass2) {
    if (pass.length < 4) { toast('Password should be at least 4 characters.', 'err'); return; }
    if (pass !== pass2) { toast('Passwords do not match.', 'err'); return; }
  }
  const u2 = db.users.find(x => x.id === currentUser.id);
  u2.fullName = name; u2.username = uname;
  if (pass) u2.password = pass;
  logActivity(db, currentUser, 'Updated own profile');
  saveDB(db);
  currentUser = u2;
  saveSession({ currentUser: u2 });
  document.getElementById('userNameLbl').textContent = u2.fullName;
  document.getElementById('avatarInit').textContent = u2.fullName.split(' ').map(s => s[0]).slice(0, 2).join('');
  renderProfile();
  toast('Profile updated.', 'ok');
}

/* ---- boot ---- */
renderSidebar();
navigate('dashboard');