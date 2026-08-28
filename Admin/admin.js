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
const ICON_CHOICES = ['cap', 'idcard', 'checkin', 'folder', 'alert', 'calendar', 'users', 'chart', 'home', 'chat', 'lock', 'log'];
const QUEUE_SOURCE_RANK = { Priority: 0, Appointment: 1, 'Walk-in': 2 };
const QUEUE_AVG_MINUTES = 4;

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
const randCode = (prefix) => { const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)]; return `${prefix}-${s}`; };
const slugify = s => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || uid('svc');
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
function mkTxn(o) { return { id: uid('T'), code: randCode('OSS'), status: 'Pending', ...o, updatedAt: o.createdAt || new Date() }; }
function mkAppt(o) { return { id: uid('A'), code: randCode('APT'), ...o }; }
function mkIncident(o) { return { id: uid('IR'), code: randCode('INC'), actions: '', sensitive: true, ...o }; }
function mkScholarship(o) { return { id: uid('SCH'), ...o }; }
function mkLog(user, role, action, ts) { return { id: uid('L'), user, role, action, ts: ts || new Date() }; }
function mkQueue(o) { return { id: uid('Q'), status: 'Waiting', createdAt: new Date(), calledAt: null, servingAt: null, completedAt: null, assignedAdminId: null, assignedAdminName: null, transactionId: null, appointmentId: null, recallCount: 0, ...o }; }

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

/* ---------------- queue logic ---------------- */
function queuePrefixFor(db, visitorType) { const s = db.systemSettings; if (visitorType === 'Guest') return (s.queuePrefixGuest || 'G').toUpperCase().slice(0, 2) || 'G'; return (s.queuePrefixStudent || 'A').toUpperCase().slice(0, 2) || 'A'; }
function nextQueueNumber(db, visitorType) { const prefix = queuePrefixFor(db, visitorType); const dayKey = today(); if (!db.queueCounters || db.queueCounters.dayKey !== dayKey) db.queueCounters = { dayKey }; const seq = (db.queueCounters[prefix] || 0) + 1; db.queueCounters[prefix] = seq; return { number: `${prefix}-${String(seq).padStart(3, '0')}`, prefix, seq }; }
function addToQueue(db, { visitorType, serviceKey, serviceLabel: svcLabelText, source, name, idNumber, contact, appointmentId }) {
    const { number, prefix, seq } = nextQueueNumber(db, visitorType);
    const entry = mkQueue({ number, prefix, seq, visitorType, serviceKey: serviceKey || null, serviceLabel: svcLabelText || (serviceKey ? serviceLabel(db, serviceKey) : 'General Concern'), source: source || 'Walk-in', name: name || '', idNumber: idNumber || '', contact: contact || '', appointmentId: appointmentId || null });
    db.queues.push(entry);
    return entry;
}
function findService(db, serviceKey) { return db.services.find(x => x.key === serviceKey) || db.services.find(x => x.label === serviceKey); }
function serviceLabel(db, key) { const s = db.services.find(x => x.key === key); return s ? s.label : key; }
function serviceQueueLabel(db, entry) { return entry.serviceLabel || (entry.serviceKey ? serviceLabel(db, entry.serviceKey) : 'General Concern'); }
function queueRank(q) { return (QUEUE_SOURCE_RANK[q.source] ?? 2); }
function waitingQueueSorted(db) { return db.queues.filter(q => q.status === 'Waiting').sort((a, b) => queueRank(a) - queueRank(b) || (new Date(a.createdAt) - new Date(b.createdAt))); }
function peopleAheadOf(db, entryId) { const list = waitingQueueSorted(db); const idx = list.findIndex(q => q.id === entryId); return idx < 0 ? 0 : idx; }
function servingQueueEntries(db) { return db.queues.filter(q => q.status === 'Serving' || q.status === 'Called').sort((a, b) => (new Date(a.calledAt || 0)) - (new Date(b.calledAt || 0))); }
function myQueueEntries(db, adminId) { return db.queues.filter(q => q.assignedAdminId === adminId && (q.status === 'Called' || q.status === 'Serving')); }
function todaysQueue(db) { const t = today(); return db.queues.filter(q => fmtDate(q.createdAt) === t); }
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
function callNextQueue(db, admin) {
    const list = waitingQueueSorted(db);
    if (!list.length) return null;
    const entry = list[0];
    entry.status = 'Called'; entry.assignedAdminId = admin.id; entry.assignedAdminName = admin.fullName; entry.calledAt = new Date(); entry.recallCount = 0;
    logActivity(db, admin, `Called queue number ${entry.number} (${serviceQueueLabel(db, entry)})`);
    return entry;
}
function beginServingQueue(db, id) { const q = db.queues.find(x => x.id === id); if (!q) return; q.status = 'Serving'; q.servingAt = new Date(); }
function completeQueue(db, id) { const q = db.queues.find(x => x.id === id); if (!q) return; q.status = 'Completed'; q.completedAt = new Date(); }
function skipQueue(db, id) { const q = db.queues.find(x => x.id === id); if (!q) return; q.status = 'Skipped'; }
function recallQueue(db, id) { const q = db.queues.find(x => x.id === id); if (!q) return; q.recallCount = (q.recallCount || 0) + 1; q.recalledAt = new Date(); }
function cancelQueue(db, id) { const q = db.queues.find(x => x.id === id); if (!q) return; q.status = 'Cancelled'; }
function transferQueue(db, id, newServiceKey) {
    const q = db.queues.find(x => x.id === id); if (!q) return;
    const svc = findService(db, newServiceKey);
    q.serviceKey = newServiceKey; q.serviceLabel = svc ? svc.label : newServiceKey; q.status = 'Waiting';
    q.assignedAdminId = null; q.assignedAdminName = null; q.calledAt = null; q.transferredAt = new Date();
}

/* ---------------- activity log / attachments ---------------- */
function logActivity(db, currentUser, action) { if (!currentUser) return; db.activityLog.unshift(mkLog(currentUser.fullName, currentUser.role, action, new Date())); }
function fmtFileSize(bytes) { if (bytes < 1024) return bytes + ' B'; if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'; return (bytes / (1024 * 1024)).toFixed(1) + ' MB'; }
function readFileAsDataURL(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve({ name: file.name, size: file.size, type: file.type, dataUrl: reader.result }); reader.onerror = reject; reader.readAsDataURL(file); }); }
async function readFilesAsAttachments(fileList) { const files = Array.from(fileList || []); return Promise.all(files.map(readFileAsDataURL)); }
function attachChip(att) { return `<a class="attach-chip" href="${att.dataUrl}" download="${escapeHtml(att.name)}" target="_blank">${icon('paperclip', 13)}<span class="fname">${escapeHtml(att.name)}</span><span class="fsize">${fmtFileSize(att.size)}</span></a>`; }
function attachListHtml(attachments, emptyText) { if (!attachments || !attachments.length) return `<div class="no-attach">${emptyText || 'No files uploaded.'}</div>`; return `<div class="attach-list">${attachments.map(attachChip).join('')}</div>`; }

/* ---------------- icons / crest / QR / toast / modal / theme ---------------- */
function icon(name, size = 17) {
    const p = {
        dashboard: 'M4 13h6V4H4v9zm0 7h6v-5H4v5zm10 0h6V11h-6v9zm0-16v5h6V4h-6z',
        checkin: 'M9 12l2 2 4-4M5 4h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z',
        calendar: 'M8 2v4M16 2v4M3 9h18M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z',
        folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z',
        alert: 'M12 3l9 16H3l9-16zM12 10v4M12 17.5v.01',
        cap: 'M12 3l10 5-10 5L2 8l10-5zM6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5',
        chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
        users: 'M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M13 7a4 4 0 11-8 0 4 4 0 018 0M23 21v-2a4 4 0 00-3-3.87M17 3.13a4 4 0 010 7.75',
        lock: 'M5 11h14v9H5v-9zM8 11V7a4 4 0 118 0v4',
        search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35',
        plus: 'M12 5v14M5 12h14',
        print: 'M6 9V2h12v7M6 18H4a1 1 0 01-1-1v-6a1 1 0 011-1h16a1 1 0 011 1v6a1 1 0 01-1 1h-2M6 14h12v8H6v-8z',
        edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z',
        trash: 'M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m2 0v14a1 1 0 01-1 1H7a1 1 0 01-1-1V6h12z',
        idcard: 'M3 5h18v14H3V5zm4 4h.01M7 15h6M14 9h6M14 12h6',
        x: 'M18 6L6 18M6 6l12 12',
        check: 'M20 6L9 17l-5-5',
        chat: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
        paperclip: 'M21 11.5V7a4 4 0 00-8 0v10a3 3 0 006 0V9',
        home: 'M3 12l9-9 9 9M5 10v10h14V10',
        userc: 'M12 12a5 5 0 100-10 5 5 0 000 10zM3 21a9 9 0 0118 0',
        ticket: 'M4 8a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2a2 2 0 000-4V8zM10 6v2M10 11v2M10 16v2',
        megaphone: 'M3 11v2a2 2 0 002 2h1l3 5 1-1-1-4h5l6 4V6l-6 4H6a2 2 0 00-2 2z',
        arrowright: 'M5 12h14M13 5l7 7-7 7',
        swap: 'M7 3l4 4-4 4M17 21l-4-4 4-4M3 7h11M21 17H10',
    }[name] || 'M12 2v20';
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p.split('M').filter(Boolean).map(seg => `<path d="M${seg}"/>`).join('')}</svg>`;
}
function crestSVG(size = 40) {
    return `<svg width="${size}" height="${size}" viewBox="0 0 64 64" fill="none">
    <path d="M32 4 L58 14 V30 C58 46 47 56 32 60 C17 56 6 46 6 30 V14 Z" fill="var(--maroon-800)" stroke="var(--gold-500)" stroke-width="2"/>
    <path d="M32 10 L52 18 V30 C52 43 44 51 32 54 C20 51 12 43 12 30 V18 Z" fill="none" stroke="var(--gold-500)" stroke-width="1"/>
    <text x="32" y="38" text-anchor="middle" font-family="Playfair Display, serif" font-weight="700" font-size="19" fill="var(--gold-400)">OSS</text>
  </svg>`;
}
function mockQR(code, cells = 7, size = 88) {
    let hash = 0; for (let i = 0; i < code.length; i++) { hash = (hash * 31 + code.charCodeAt(i)) >>> 0; }
    const cs = size / cells; let rects = '';
    for (let r = 0; r < cells; r++) { for (let c = 0; c < cells; c++) { const isFinder = (r < 2 && c < 2) || (r < 2 && c > cells - 3) || (r > cells - 3 && c < 2); let on; if (isFinder) { on = true; } else { hash = (hash * 1103515245 + 12345) >>> 0; on = (hash % 100) < 46; } if (on) rects += `<rect x="${c * cs}" y="${r * cs}" width="${cs}" height="${cs}" fill="#241512"/>`; } }
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${rects}</svg>`;
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
   AUTH GUARD — this page is Admin-only. No valid Admin session -> Landing.
========================================================================= */
let currentUser = null;
(function guard() {
    const sess = loadSession();
    const db = loadDB();
    const fresh = sess.currentUser ? db.users.find(u => u.id === sess.currentUser.id) : null;
    if (!fresh || fresh.role !== 'ADMIN' || !fresh.active) {
        location.href = '../Landing/landing.html';
        throw new Error('OSS UniServe: not an authorized Admin session — redirecting to login.');
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
   NAV — Admin handles every student-facing service end-to-end.
========================================================================= */
const NAV = [
    { key: 'dashboard', label: 'Dashboard', ic: 'dashboard' },
    { key: 'queue', label: 'Queue', ic: 'ticket' },
    { key: 'checkin', label: 'Check-In', ic: 'checkin' },
    { key: 'appointments', label: 'Appointments', ic: 'calendar' },
    { key: 'messages', label: 'Messages', ic: 'chat' },
    { key: 'transactions', label: 'Transactions', ic: 'folder' },
    { key: 'incidents', label: 'Incident Reports', ic: 'alert' },
    { key: 'scholarship', label: 'Scholarship', ic: 'cap' },
    { key: 'services', label: 'Manage Services', ic: 'plus' },
    { key: 'reports', label: 'Reports', ic: 'chart' },
    { key: 'profile', label: 'My Profile', ic: 'userc' },
];
const TITLES = {
    dashboard: ['Dashboard', "Overview of today's activity"],
    queue: ['Queue', "Today's active service line — call, serve and complete numbers. Checked-in appointments join automatically."],
    checkin: ['Check-In', 'Identify and log students or guests'],
    appointments: ['Appointments', 'Manage bookings and visitor passes'],
    messages: ['Messages', 'Chat conversations with students and guests'],
    transactions: ['Transactions', 'Student services and OSS requests'],
    incidents: ['Incident Reports', 'Confidential &mdash; handle with care'],
    scholarship: ['Scholarship', 'OSS admin-managed documentation'],
    services: ['Manage Services', 'Create and edit the services students & guests can request'],
    reports: ['Reports', 'Generate printable office reports'],
    profile: ['My Profile', 'Manage your account details'],
};

document.getElementById('avatarInit').textContent = currentUser.fullName.split(' ').map(s => s[0]).slice(0, 2).join('');
document.getElementById('userNameLbl').textContent = currentUser.fullName;
document.getElementById('userRoleLbl').textContent = ROLES[currentUser.role].label;

function tickClock() { const d = new Date(); const lbl = document.getElementById('clockLbl'); if (lbl) lbl.textContent = `${fmtDate(d)}  ${fmtTime(d)}`; }
setInterval(tickClock, 1000 * 20); tickClock();

let state_view = 'dashboard';
let txnServiceFilter = undefined;

function totalStaffUnread() { const db = loadDB(); return db.chats.reduce((s, c) => s + (c.staffUnread || 0), 0); }
function countTxnForService(db, key) { return db.transactions.filter(t => t.service === key).length; }

function renderSidebar() {
    const db = loadDB();
    const list = document.getElementById('navList');
    let html = '';
    NAV.forEach(n => {
        if (n.key === 'transactions') {
            html += `<div class="nav-section-label">Transactions</div>`;
            html += `<li><button class="nav-item ${state_view === 'transactions' && !txnServiceFilter ? 'active' : ''}" onclick="navigateTxnService(null)">${icon('folder')}<span>All Transactions</span></button></li>`;
            db.services.forEach(s => {
                const active = state_view === 'transactions' && txnServiceFilter === s.key;
                html += `<li><button class="nav-item nav-subitem ${active ? 'active' : ''}" onclick="navigateTxnService('${s.key}')">${icon(s.icon || 'folder', 14)}<span>${escapeHtml(s.label)}</span></button></li>`;
            });
            return;
        }
        const badge = n.key === 'messages' ? totalStaffUnread() : 0;
        html += `<li><button class="nav-item ${state_view === n.key ? 'active' : ''}" onclick="navigate('${n.key}')">${icon(n.ic)}<span>${n.label}</span>${badge ? `<span class="nav-badge">${badge}</span>` : ''}</button></li>`;
    });
    list.innerHTML = html;
}
function navigate(key) {
    if (!TITLES[key]) key = 'dashboard';
    if (key !== 'queue') stopAdminQueuePolling();
    if (key !== 'messages') activeStaffChatId = null;
    state_view = key;
    if (key !== 'transactions') txnServiceFilter = undefined;
    document.getElementById('pageTitle').textContent = TITLES[key][0];
    document.getElementById('pageSub').innerHTML = TITLES[key][1];
    renderSidebar();
    document.getElementById('sidebar').classList.remove('open');
    const renderers = { dashboard: renderDashboard, queue: renderQueueDashboard, checkin: renderCheckin, appointments: renderAppointments, messages: renderMessages, transactions: renderTransactions, incidents: renderIncidents, scholarship: renderScholarship, services: renderServicesManage, reports: renderReports, profile: renderProfile };
    renderers[key]();
}
function navigateTxnService(key) {
    state_view = 'transactions';
    txnServiceFilter = key || undefined;
    const db = loadDB();
    document.getElementById('pageTitle').textContent = key ? serviceLabel(db, key) : 'All Transactions';
    document.getElementById('pageSub').textContent = key ? `Requests logged under ${serviceLabel(db, key)}` : TITLES.transactions[1];
    renderSidebar();
    document.getElementById('sidebar').classList.remove('open');
    renderTransactions();
}
function statusPill(status) {
    const map = { Pending: 'pill-warn', Processing: 'pill-info', Approved: 'pill-ok', Completed: 'pill-ok', Rejected: 'pill-danger', Booked: 'pill-info', 'Checked-in': 'pill-gold', Cancelled: 'pill-danger', 'Under Review': 'pill-warn', Resolved: 'pill-ok', Open: 'pill-info', Closed: 'pill-danger' };
    return `<span class="pill ${map[status] || 'pill-info'}">${status}</span>`;
}

/* =========================================================================
   DASHBOARD
========================================================================= */
function renderDashboard() {
    const db = loadDB();
    const t = today();
    const todaysTxn = db.transactions.filter(x => fmtDate(x.createdAt) === t);
    const pending = db.transactions.filter(x => x.status === 'Pending').length;
    const todaysAppt = db.appointments.filter(x => x.date === t);
    const openIncidents = db.incidents.filter(x => x.status !== 'Resolved').length;
    const qs = queueStats(db);
    const recent = [...db.transactions].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
    const upcoming = db.appointments.filter(a => a.status === 'Booked').slice(0, 5);

    document.getElementById('content').innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="lbl">Today's Transactions</div><div class="val">${todaysTxn.length}</div><div class="sub">across all services</div></div>
      <div class="stat-card"><div class="lbl">Pending Requests</div><div class="val">${pending}</div><div class="sub">awaiting processing</div></div>
      <div class="stat-card"><div class="lbl">Today's Appointments</div><div class="val">${todaysAppt.length}</div><div class="sub">booked visits</div></div>
      <div class="stat-card"><div class="lbl">Unread Messages</div><div class="val">${totalStaffUnread()}</div><div class="sub">from visitors &amp; students</div></div>
      <div class="stat-card"><div class="lbl">Open Incident Reports</div><div class="val">${openIncidents}</div><div class="sub">requires attention</div></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><h3>Recent Transactions</h3><div class="desc">Latest requests logged across the office</div></div><button class="btn btn-ghost btn-sm" onclick="navigateTxnService(null)">View all</button></div>
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
      <div class="card-head"><div><h3>Live Queue</h3><div class="desc"></div></div><button class="btn btn-primary btn-sm" onclick="navigate('queue')">${icon('ticket', 14)} Open Queue</button></div>
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
   QUEUE DASHBOARD
========================================================================= */
let adminQueuePollTimer = null;
function startAdminQueuePolling() { stopAdminQueuePolling(); adminQueuePollTimer = setInterval(() => { if (state_view === 'queue') renderQueueDashboard(); }, 4000); }
function stopAdminQueuePolling() { if (adminQueuePollTimer) { clearInterval(adminQueuePollTimer); adminQueuePollTimer = null; } }
function renderQueueDashboard() {
    const db = loadDB();
    const stats = queueStats(db);
    const mine = myQueueEntries(db, currentUser.id);
    const waiting = waitingQueueSorted(db);
    const nextUp = waiting[0] || null;

    document.getElementById('content').innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="lbl">Currently Waiting</div><div class="val">${stats.waiting}</div><div class="sub">in the queue right now</div></div>
      <div class="stat-card"><div class="lbl">Currently Serving</div><div class="val">${stats.serving}</div><div class="sub">across all OSS Admins</div></div>
      <div class="stat-card"><div class="lbl">Completed Today</div><div class="val">${stats.completedToday}</div><div class="sub">queue numbers served</div></div>
      <div class="stat-card"><div class="lbl">Average Wait</div><div class="val">${stats.avgWaitMin == null ? '&mdash;' : stats.avgWaitMin + 'm'}</div><div class="sub">time to being called</div></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><h3>My Queue</h3><div class="desc">${escapeHtml(currentUser.fullName)} &mdash; OSS Admin</div></div>
          <button class="btn btn-gold btn-sm" onclick="handleCallNext()" ${!nextUp ? 'disabled' : ''}>${icon('arrowright', 14)} Call Next</button>
        </div>
        <div class="card-pad">
          ${mine.length ? mine.map(q => renderMyQueueCard(db, q)).join('') : `<div class="helper-empty" style="padding:30px 10px;">${icon('ticket', 30)}<p>You're not currently serving anyone. Click Call Next to bring up the next queue number.</p></div>`}
          ${nextUp ? `<div class="divider"></div><div class="lbl" style="font-size:.72rem; text-transform:uppercase; letter-spacing:.6px; color:var(--text-soft); font-weight:600; margin-bottom:8px;">Next</div>
            <div class="qd-next-row"><span class="pill pill-gold">${nextUp.number}</span><span class="muted" style="font-size:.82rem;">${escapeHtml(nextUp.visitorType)} &middot; ${escapeHtml(serviceQueueLabel(db, nextUp))}${nextUp.source !== 'Walk-in' ? ' &middot; ' + nextUp.source : ''}</span></div>` : ''}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Waiting</h3><div class="desc">${waiting.length} in line</div></div></div>
        <div class="table-wrap"><table><thead><tr><th>#</th><th>Type</th><th>Service</th><th>Source</th><th></th></tr></thead>
          <tbody>${waiting.length ? waiting.map(q => `<tr><td class="mono">${q.number}</td><td>${q.visitorType}</td><td>${escapeHtml(serviceQueueLabel(db, q))}</td>
            <td>${q.source !== 'Walk-in' ? `<span class="pill pill-info">${q.source}</span>` : `<span class="muted" style="font-size:.76rem;">Walk-in</span>`}</td>
            <td><button class="icon-btn" title="Cancel" onclick="adminCancelQueue('${q.id}')">${icon('x', 14)}</button></td></tr>`).join('') : `<tr class="empty-row"><td colspan="5">Queue is empty.</td></tr>`}</tbody>
        </table></div>
      </div>
    </div>
  `;
    startAdminQueuePolling();
}
function renderMyQueueCard(db, q) {
    const isCalled = q.status === 'Called';
    return `<div class="qd-serving-card"><div class="qd-serving-top">
      <div><div class="qd-serving-number">${q.number}</div><div class="muted" style="font-size:.8rem;">${escapeHtml(q.visitorType)} &middot; ${escapeHtml(serviceQueueLabel(db, q))}</div></div>
      ${isCalled ? `<span class="pill pill-warn">Called &mdash; awaiting arrival</span>` : `<span class="pill pill-ok">Serving</span>`}
    </div>
    <div class="qd-serving-actions">
      ${isCalled ? `<button class="btn btn-primary btn-sm" onclick="handleBeginServing('${q.id}')">${icon('check', 13)} Begin Service</button>
        <button class="btn btn-ghost btn-sm" onclick="handleRecall('${q.id}')">${icon('megaphone', 13)} Recall</button>
        <button class="btn btn-danger-o btn-sm" onclick="handleSkip('${q.id}')">Skip</button>`
            : `<button class="btn btn-primary btn-sm" onclick="handleCompleteQueue('${q.id}')">${icon('check', 13)} Complete</button>
        <button class="btn btn-ghost btn-sm" onclick="openTransferModal('${q.id}')">${icon('swap', 13)} Transfer</button>`}
    </div></div>`;
}
function handleCallNext() { const db = loadDB(); const entry = callNextQueue(db, currentUser); if (!entry) { toast('The queue is empty.', 'err'); return; } saveDB(db); toast(`Called ${entry.number} &mdash; please proceed to ${currentUser.fullName}.`, 'ok'); renderQueueDashboard(); }
function handleBeginServing(id) { const db = loadDB(); beginServingQueue(db, id); saveDB(db); toast('Now serving &mdash; continue with the existing OSS workflow for this service.', 'ok'); renderQueueDashboard(); }
function handleCompleteQueue(id) { const db = loadDB(); completeQueue(db, id); saveDB(db); toast('Queue ticket marked Completed.', 'ok'); renderQueueDashboard(); renderSidebar(); }
function handleSkip(id) { const db = loadDB(); skipQueue(db, id); saveDB(db); toast('Queue number skipped.', 'ok'); renderQueueDashboard(); }
function handleRecall(id) { const db = loadDB(); recallQueue(db, id); saveDB(db); toast('Recalled on the public display.', 'ok'); renderQueueDashboard(); }
function adminCancelQueue(id) { if (!confirm('Cancel this queue number?')) return; const db = loadDB(); cancelQueue(db, id); saveDB(db); renderQueueDashboard(); }
function openTransferModal(id) {
    const db = loadDB(); const q = db.queues.find(x => x.id === id); if (!q) return;
    openModal(`Transfer ${q.number}`, `<p class="field-hint" style="margin-bottom:12px;">Move this Guest/Student back into the queue under a different OSS service.</p>
    <div class="field"><label>New Service</label><select id="mTransferSvc">${db.services.map(s => `<option value="${s.key}" ${s.key === q.serviceKey ? 'selected' : ''}>${s.label}</option>`).join('')}</select></div>`,
        [{ label: 'Cancel', cls: 'btn-ghost', action: closeModal },
        { label: 'Transfer', cls: 'btn-primary', action: () => { const db2 = loadDB(); transferQueue(db2, id, document.getElementById('mTransferSvc').value); saveDB(db2); closeModal(); renderQueueDashboard(); toast('Queue number transferred.', 'ok'); } }]);
}

/* =========================================================================
   CHECK-IN
========================================================================= */
function renderCheckin() {
    const db = loadDB();
    document.getElementById('content').innerHTML = `
    <div class="grid-2">
      <div class="card card-pad">
        <h3 style="margin-bottom:4px;">Walk-in Check-In</h3>
        <div class="desc muted" style="margin-bottom:16px; font-size:.82rem;">Identify a student or guest and log their transaction.</div>
        <div class="field"><label>Type</label><select id="ciType" onchange="document.getElementById('ciIdLbl').textContent = this.value==='Student'?'Student Number':'Guest ID Number'"><option>Student</option><option>Guest</option></select></div>
        <div class="field"><label>Full Name</label><input id="ciName" placeholder="Full name"></div>
        <div class="form-row"><div class="field"><label id="ciIdLbl">Student Number</label><input id="ciIdNum" placeholder="e.g. 2023-00000"></div><div class="field"><label>Section / Org</label><input id="ciSection" placeholder="e.g. BSIT-3A"></div></div>
        <div class="field"><label>Service / Concern</label><select id="ciService">${db.services.map(s => `<option value="${s.key}">${s.label}</option>`).join('')}</select></div>
        <div class="field"><label>Details</label><textarea id="ciDetails" placeholder="Short description of the request"></textarea></div>
        <button class="btn btn-primary btn-block" onclick="submitCheckin()">${icon('check', 15)} Log Transaction</button>
      </div>
      <div class="card"><div class="card-head"><h3>Checked In Today</h3></div>
        <div class="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th>Service</th><th>Time</th></tr></thead><tbody id="ciTodayBody"></tbody></table></div>
      </div>
    </div>
  `;
    renderCiToday();
}
function renderCiToday() {
    const db = loadDB();
    const t = today();
    const rows = db.transactions.filter(x => fmtDate(x.createdAt) === t).sort((a, b) => b.createdAt - a.createdAt);
    document.getElementById('ciTodayBody').innerHTML = rows.length ? rows.map(r => `<tr><td>${escapeHtml(r.name)}<div class="muted" style="font-size:.72rem;">${r.idNumber || ''}</div></td><td>${r.type}</td><td>${serviceLabel(db, r.service)}</td><td class="muted">${fmtTime(r.createdAt)}</td></tr>`).join('') : `<tr class="empty-row"><td colspan="4">No one checked in yet today.</td></tr>`;
}
function submitCheckin() {
    const name = document.getElementById('ciName').value.trim();
    const type = document.getElementById('ciType').value;
    const idNumber = document.getElementById('ciIdNum').value.trim();
    const section = document.getElementById('ciSection').value.trim();
    const service = document.getElementById('ciService').value;
    const details = document.getElementById('ciDetails').value.trim();
    if (!name || !idNumber) { toast('Name and ID number are required.', 'err'); return; }
    const db = loadDB();
    const txn = mkTxn({ name, type, idNumber, section, service, details, status: 'Pending', createdAt: new Date() });
    db.transactions.push(txn);
    logActivity(db, currentUser, `Checked in ${type.toLowerCase()} ${name} (${serviceLabel(db, service)})`);
    saveDB(db);
    toast(`${name} logged &mdash; code ${txn.code}`, 'ok');
    ['ciName', 'ciIdNum', 'ciSection', 'ciDetails'].forEach(id => document.getElementById(id).value = '');
    renderCiToday();
}

/* =========================================================================
   APPOINTMENTS
========================================================================= */
function renderAppointments() {
    document.getElementById('content').innerHTML = `
    <div class="card">
      <div class="card-head"><div><h3>All Appointments</h3><div class="desc">Scheduled visits &mdash; booked online or added by staff. Checking one in adds it to the Service Queue below.</div></div>
        <button class="btn btn-primary btn-sm" onclick="openApptForm()">${icon('plus', 14)} New Appointment</button></div>
      <div class="table-wrap"><table><thead><tr><th>Code</th><th>Visitor</th><th>Type</th><th>Service</th><th>Schedule</th><th>Files</th><th>Status</th><th>Queue #</th><th></th></tr></thead><tbody id="apptBody"></tbody></table></div>
    </div>
  `;
    renderApptTable();
}
function renderApptTable() {
    const db = loadDB();
    const rows = [...db.appointments].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    document.getElementById('apptBody').innerHTML = rows.length ? rows.map(a => {
        const q = a.queueId ? db.queues.find(x => x.id === a.queueId) : null;
        return `<tr>
      <td class="mono">${a.code}</td><td>${escapeHtml(a.name)}</td><td>${a.type}</td><td>${a.service}</td><td class="muted">${a.date} &middot; ${a.time}</td>
      <td>${a.attachments && a.attachments.length ? `<span class="pill pill-gold">${icon('paperclip', 11)} ${a.attachments.length}</span>` : `<span class="muted" style="font-size:.76rem;">&mdash;</span>`}</td>
      <td>${statusPill(a.status)}</td><td>${q ? `<span class="pill pill-gold">${q.number}</span>` : `<span class="muted" style="font-size:.76rem;">&mdash;</span>`}</td>
      <td style="display:flex; gap:6px;">${a.status === 'Booked' ? `<button class="icon-btn" title="Check in" onclick="apptCheckin('${a.id}')">${icon('check', 15)}</button>` : ''}<button class="icon-btn" title="View pass" onclick='viewPass("${a.id}")'>${icon('idcard', 15)}</button></td>
    </tr>`;
    }).join('') : `<tr class="empty-row"><td colspan="9">No appointments booked.</td></tr>`;
}
function apptCheckin(id) {
    const db = loadDB();
    const a = db.appointments.find(x => x.id === id);
    a.status = 'Checked-in';
    const txn = mkTxn({ name: a.name, type: a.type, idNumber: a.idNumber || '-', section: '-', service: 'other', details: `Appointment: ${a.service}`, status: 'Processing', createdAt: new Date(), attachments: a.attachments || [] });
    db.transactions.push(txn);
    const qEntry = addToQueue(db, { visitorType: a.type === 'Guest' ? 'Guest' : 'Student', serviceKey: null, serviceLabel: a.service, source: 'Appointment', name: a.name, idNumber: a.idNumber, contact: a.contact, appointmentId: a.id });
    qEntry.transactionId = txn.id;
    a.queueId = qEntry.id;
    logActivity(db, currentUser, `Checked in appointment ${a.code} (${a.name})`);
    saveDB(db);
    toast(`${a.name} checked in &mdash; queue number ${qEntry.number}.`, 'ok');
    renderApptTable();
}
function viewPass(id) { const db = loadDB(); const a = db.appointments.find(x => x.id === id); showPassModalReadonly(a); }
function showPassModalReadonly(appt) {
    openModal(`Visitor Pass &mdash; ${appt.code}`, `<div class="pass-card"><div class="pass-top"><div class="org">Office of Student Services<b>${appt.service}</b></div><span class="pass-type">${appt.type}</span></div>
    <div class="pass-body"><div class="pass-info"><div class="name">${escapeHtml(appt.name)}</div><div class="meta">${appt.date} &middot; ${appt.time}</div><div class="pass-code">${appt.code}</div></div><div class="qr-box">${mockQR(appt.code)}</div></div></div>
    <div style="margin-top:14px;"><label style="display:block; font-size:.78rem; font-weight:600; margin-bottom:6px; color:var(--text-soft);">Uploaded Requirements</label>${attachListHtml(appt.attachments, 'No files uploaded with this booking.')}</div>`,
        [{ label: 'Close', cls: 'btn-primary', action: closeModal }]);
}
function openApptForm() {
    openModal('New Appointment', `
    <div class="field"><label>Visitor Type</label><select id="mApTy"><option>Student</option><option>Guest</option></select></div>
    <div class="field"><label>Full Name</label><input id="mApName"></div>
    <div class="form-row"><div class="field"><label>Contact</label><input id="mApContact"></div><div class="field"><label>Service</label><input id="mApService" placeholder="e.g. Good Moral Character"></div></div>
    <div class="form-row"><div class="field"><label>Date</label><input id="mApDate" type="date" value="${today()}"></div><div class="field"><label>Time</label><input id="mApTime" type="time" value="09:00"></div></div>
  `, [{ label: 'Cancel', cls: 'btn-ghost', action: closeModal },
    {
        label: 'Book & Generate Pass', cls: 'btn-primary', action: () => {
            const name = document.getElementById('mApName').value.trim();
            if (!name) { toast('Name is required.', 'err'); return; }
            const db = loadDB();
            const appt = mkAppt({ name, type: document.getElementById('mApTy').value, contact: document.getElementById('mApContact').value, service: document.getElementById('mApService').value || 'General Concern', date: document.getElementById('mApDate').value, time: formatTimeInput(document.getElementById('mApTime').value), status: 'Booked' });
            db.appointments.push(appt);
            logActivity(db, currentUser, `Booked appointment for ${name}`);
            saveDB(db);
            closeModal(); renderApptTable();
            showPassModalReadonly(appt);
        }
    }]);
}
function formatTimeInput(t) { const [h, m] = t.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; const hh = h % 12 || 12; return `${hh}:${pad2(m)} ${ap}`; }

/* =========================================================================
   MESSAGES
========================================================================= */
let activeStaffChatId = null;
function renderMessages() {
    document.getElementById('content').innerHTML = `
    <div class="card"><div class="card-head"><div><h3>Messages</h3><div class="desc">Conversations started by students and guests via the visitor portal</div></div></div>
      <div class="chat-shell"><div class="chat-thread-list" id="chatThreadList"></div><div class="chat-panel" id="chatPanel">${emptyChatPanel()}</div></div>
    </div>
  `;
    renderChatThreadList();
    startMessagesPolling();
}
function emptyChatPanel() { return `<div class="helper-empty" style="padding:80px 20px;">${icon('chat', 34)}<p>Select a conversation to view messages.</p></div>`; }
function renderChatThreadList() {
    const db = loadDB();
    const list = document.getElementById('chatThreadList');
    if (!list) return;
    const rows = [...db.chats].sort((a, b) => b.updatedAt - a.updatedAt);
    list.innerHTML = rows.length ? rows.map(c => {
        const last = c.messages[c.messages.length - 1];
        return `<button class="chat-thread-item ${activeStaffChatId === c.id ? 'active' : ''}" onclick="openStaffChat('${c.id}')">
      <div class="ttl"><span>${escapeHtml(c.visitorName)}</span>${c.staffUnread ? `<span class="unread-dot"></span>` : ''}</div>
      <div class="prev">${last ? escapeHtml(last.text) : 'No messages yet'}</div>
      <div class="meta-row"><span class="mono muted" style="font-size:.68rem;">${c.code}</span>${statusPill(c.status)}</div>
    </button>`;
    }).join('') : `<div class="helper-empty" style="padding:40px 16px;"><p>No conversations yet.</p></div>`;
}
function openStaffChat(id) {
    activeStaffChatId = id;
    const db = loadDB();
    const c = db.chats.find(x => x.id === id);
    if (!c) return;
    c.staffUnread = 0;
    saveDB(db);
    renderChatThreadList();
    renderSidebar();
    document.getElementById('chatPanel').innerHTML = `
    <div class="chat-panel-head"><div><b>${escapeHtml(c.visitorName)}</b> <span class="pill pill-info">${c.visitorType}</span><div class="muted mono" style="font-size:.72rem; margin-top:2px;">${c.code}${c.contact ? ' &middot; ' + escapeHtml(c.contact) : ''}</div></div>
      <div class="chat-status-toggle"><button class="cst-btn ok ${c.status === 'Open' ? 'active' : ''}" onclick="setChatStatus('${c.id}','Open')">${icon('check', 12)}<span>Open</span></button>
        <button class="cst-btn danger ${c.status === 'Closed' ? 'active' : ''}" onclick="setChatStatus('${c.id}','Closed')">${icon('x', 12)}<span>Closed</span></button></div>
    </div>
    <div class="chat-messages" id="chatMsgArea">${renderBubbles(c)}</div>
    <div class="chat-input-row"><textarea id="staffReplyBox" placeholder="${c.status === 'Closed' ? 'Conversation is closed' : 'Type a reply...'}" ${c.status === 'Closed' ? 'disabled' : ''}></textarea>
      <button class="btn btn-primary" onclick="sendStaffReply('${c.id}')" ${c.status === 'Closed' ? 'disabled' : ''}>Send</button></div>
  `;
    const area = document.getElementById('chatMsgArea');
    if (area) area.scrollTop = area.scrollHeight;
}
function renderBubbles(c) {
    if (!c.messages.length) return `<div class="muted" style="font-size:.8rem; padding:10px;">No messages yet.</div>`;
    return c.messages.map(m => `<div class="bubble ${m.sender}"><div class="who">${m.sender === 'staff' ? escapeHtml(m.senderName || 'OSS Staff') : escapeHtml(m.senderName || 'Visitor')}</div><div>${escapeHtml(m.text)}</div>${m.attachments && m.attachments.length ? `<div class="attach-list">${m.attachments.map(attachChip).join('')}</div>` : ''}<div class="ts">${fmtDateTime(m.ts)}</div></div>`).join('');
}
function sendStaffReply(id) {
    const db = loadDB();
    const c = db.chats.find(x => x.id === id);
    const ta = document.getElementById('staffReplyBox');
    const text = ta.value.trim();
    if (!text) return;
    c.messages.push({ id: uid('MSG'), sender: 'staff', senderName: currentUser.fullName, text, ts: new Date() });
    c.visitorUnread = (c.visitorUnread || 0) + 1;
    c.updatedAt = new Date();
    logActivity(db, currentUser, `Replied to chat ${c.code} (${c.visitorName})`);
    saveDB(db);
    openStaffChat(id);
}
function setChatStatus(id, status) {
    const db = loadDB();
    const c = db.chats.find(x => x.id === id);
    c.status = status; c.updatedAt = new Date();
    logActivity(db, currentUser, `Marked chat ${c.code} as ${status}`);
    saveDB(db);
    renderChatThreadList();
    openStaffChat(id);
}
let messagesPollTimer = null;
function startMessagesPolling() {
    stopMessagesPolling();
    messagesPollTimer = setInterval(() => {
        if (state_view !== 'messages') return;
        renderChatThreadList();
        if (activeStaffChatId) {
            const db = loadDB();
            const c = db.chats.find(x => x.id === activeStaffChatId);
            const area = document.getElementById('chatMsgArea');
            if (c && area && c.messages.length !== area.querySelectorAll('.bubble').length) {
                area.innerHTML = renderBubbles(c);
                area.scrollTop = area.scrollHeight;
            }
        }
    }, 4000);
}
function stopMessagesPolling() { if (messagesPollTimer) { clearInterval(messagesPollTimer); messagesPollTimer = null; } }

/* =========================================================================
   TRANSACTIONS
========================================================================= */
let txnFilter = 'all';
function renderTransactions() {
    const db = loadDB();
    const svcKey = txnServiceFilter;
    const heading = svcKey ? serviceLabel(db, svcKey) : 'All Student Service Transactions';
    const desc = svcKey ? `Requests filed under ${serviceLabel(db, svcKey)}` : 'Good Moral, IDs, excuse letters, off-campus & org activities, and more';
    document.getElementById('content').innerHTML = `
    <div class="card">
      <div class="card-head"><div><h3>${escapeHtml(heading)}</h3><div class="desc">${escapeHtml(desc)}</div></div>
        <div class="toolbar"><div class="search-box">${icon('search', 15)}<input id="txnSearch" placeholder="Search name or code" oninput="renderTxnTable()"></div>
        <button class="btn btn-primary btn-sm" onclick="openTxnForm()">${icon('plus', 14)} New Request</button></div></div>
      <div class="subnav" style="padding:14px 22px 0;"><button class="active" onclick="setTxnFilter('all',this)">All</button><button onclick="setTxnFilter('Pending',this)">Pending</button><button onclick="setTxnFilter('Processing',this)">Processing</button><button onclick="setTxnFilter('Approved',this)">Approved</button><button onclick="setTxnFilter('Completed',this)">Completed</button></div>
      <div class="table-wrap"><table><thead><tr><th>Code</th><th>Requestor</th><th>Service</th><th>Files</th><th>Status</th><th>Logged</th><th></th></tr></thead><tbody id="txnBody"></tbody></table></div>
    </div>
  `;
    txnFilter = 'all';
    renderTxnTable();
}
function setTxnFilter(f, el) { txnFilter = f; document.querySelectorAll('.subnav button').forEach(b => b.classList.remove('active')); el.classList.add('active'); renderTxnTable(); }
function renderTxnTable() {
    const db = loadDB();
    const q = (document.getElementById('txnSearch')?.value || '').toLowerCase();
    let rows = [...db.transactions].sort((a, b) => b.createdAt - a.createdAt);
    if (txnServiceFilter) rows = rows.filter(r => r.service === txnServiceFilter);
    if (txnFilter !== 'all') rows = rows.filter(r => r.status === txnFilter);
    if (q) rows = rows.filter(r => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q));
    document.getElementById('txnBody').innerHTML = rows.length ? rows.map(r => `<tr>
    <td class="mono">${r.code}</td><td>${escapeHtml(r.name)}<div class="muted" style="font-size:.72rem;">${r.idNumber || ''} ${r.section ? '&middot; ' + r.section : ''}</div></td>
    <td>${serviceLabel(db, r.service)}</td><td>${r.attachments && r.attachments.length ? `<span class="pill pill-gold">${icon('paperclip', 11)} ${r.attachments.length}</span>` : `<span class="muted" style="font-size:.76rem;">&mdash;</span>`}</td>
    <td>${statusPill(r.status)}</td><td class="muted">${fmtDateTime(r.createdAt)}</td><td><button class="btn btn-ghost btn-sm" onclick="openTxnDetail('${r.id}')">Manage</button></td></tr>`).join('') : `<tr class="empty-row"><td colspan="7">No matching transactions.</td></tr>`;
}
function openTxnForm() {
    const db = loadDB();
    const preselect = txnServiceFilter || (db.services[0] && db.services[0].key);
    openModal('New Service Request', `
    <div class="field"><label>Requestor Type</label><select id="mTxTy"><option>Student</option><option>Guest</option></select></div>
    <div class="field"><label>Full Name</label><input id="mTxName"></div>
    <div class="form-row"><div class="field"><label>ID Number</label><input id="mTxId"></div><div class="field"><label>Section / Org</label><input id="mTxSec"></div></div>
    <div class="field"><label>Service</label><select id="mTxSvc">${db.services.map(s => `<option value="${s.key}" ${s.key === preselect ? 'selected' : ''}>${s.label}</option>`).join('')}</select></div>
    <div class="field"><label>Details</label><textarea id="mTxDet"></textarea></div>
  `, [{ label: 'Cancel', cls: 'btn-ghost', action: closeModal },
    {
        label: 'Submit Request', cls: 'btn-primary', action: () => {
            const name = document.getElementById('mTxName').value.trim();
            if (!name) { toast('Name is required.', 'err'); return; }
            const db2 = loadDB();
            const txn = mkTxn({ name, type: document.getElementById('mTxTy').value, idNumber: document.getElementById('mTxId').value, section: document.getElementById('mTxSec').value, service: document.getElementById('mTxSvc').value, details: document.getElementById('mTxDet').value, status: 'Pending', createdAt: new Date() });
            db2.transactions.push(txn);
            logActivity(db2, currentUser, `Submitted request: ${serviceLabel(db2, txn.service)} for ${name}`);
            saveDB(db2);
            closeModal(); renderTxnTable(); toast('Request submitted.', 'ok');
        }
    }]);
}
function openTxnDetail(id) {
    const db = loadDB();
    const r = db.transactions.find(x => x.id === id);
    const nextStatuses = ['Pending', 'Processing', 'Approved', 'Completed', 'Rejected'];
    openModal(`${r.code}`, `
    <div class="kv"><span>Requestor</span><span>${escapeHtml(r.name)} (${r.type})</span></div>
    <div class="kv"><span>ID Number</span><span>${r.idNumber || '&mdash;'}</span></div>
    <div class="kv"><span>Section / Org</span><span>${r.section || '&mdash;'}</span></div>
    <div class="kv"><span>Service</span><span>${serviceLabel(db, r.service)}</span></div>
    <div class="kv"><span>Details</span><span style="max-width:260px; text-align:right;">${escapeHtml(r.details || '&mdash;')}</span></div>
    <div class="kv"><span>Logged</span><span>${fmtDateTime(r.createdAt)}</span></div>
    <div class="divider"></div>
    <div class="field"><label>Uploaded Requirements</label>${attachListHtml(r.attachments)}</div>
    <div class="field"><label>Update Status</label><select id="mTxStatus">${nextStatuses.map(s => `<option value="${s}" ${s === r.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
  `, [{ label: 'Close', cls: 'btn-ghost', action: closeModal },
    {
        label: 'Save Status', cls: 'btn-primary', action: () => {
            const db2 = loadDB();
            const r2 = db2.transactions.find(x => x.id === id);
            const ns = document.getElementById('mTxStatus').value;
            r2.status = ns; r2.updatedAt = new Date();
            logActivity(db2, currentUser, `Updated ${r2.code} status to ${ns}`);
            saveDB(db2);
            closeModal(); renderTxnTable(); toast('Status updated.', 'ok');
        }
    }]);
}

/* =========================================================================
   INCIDENT REPORTS
========================================================================= */
function renderIncidents() {
    document.getElementById('content').innerHTML = `
    <div class="card"><div class="card-head"><div><h3>Incident Reports <span class="tag-lock">${icon('lock', 12)} Confidential</span></h3><div class="desc">Sensitive records handled by OSS admin</div></div>
      <button class="btn btn-primary btn-sm" onclick="openIncidentForm()">${icon('plus', 14)} File Report</button></div>
      <div class="table-wrap"><table><thead><tr><th>Code</th><th>Involved</th><th>Reported By</th><th>Status</th><th>Date</th><th></th></tr></thead><tbody id="incBody"></tbody></table></div>
    </div>
  `;
    renderIncTable();
}
function renderIncTable() {
    const db = loadDB();
    const rows = [...db.incidents].sort((a, b) => b.createdAt - a.createdAt);
    document.getElementById('incBody').innerHTML = rows.length ? rows.map(r => `<tr><td class="mono">${r.code}</td><td>${r.involved}</td><td>${r.reporter}</td><td>${statusPill(r.status)}</td><td class="muted">${fmtDateTime(r.createdAt)}</td><td><button class="btn btn-ghost btn-sm" onclick="openIncidentDetail('${r.id}')">Manage</button></td></tr>`).join('') : `<tr class="empty-row"><td colspan="6">No incident reports on file.</td></tr>`;
}
function openIncidentForm() {
    openModal('File Incident Report', `
    <div class="field"><label>Person(s) Involved</label><input id="mIncInv" placeholder="Name / ID number"></div>
    <div class="field"><label>Description</label><textarea id="mIncDesc" placeholder="Describe what happened"></textarea></div>
    <p class="field-hint">${icon('lock', 11)} This record is confidential and only visible to OSS admin accounts.</p>
  `, [{ label: 'Cancel', cls: 'btn-ghost', action: closeModal },
    {
        label: 'Submit Report', cls: 'btn-primary', action: () => {
            const inv = document.getElementById('mIncInv').value.trim();
            const desc = document.getElementById('mIncDesc').value.trim();
            if (!inv || !desc) { toast('Please complete all fields.', 'err'); return; }
            const db = loadDB();
            const rec = mkIncident({ reporter: currentUser.fullName, involved: inv, description: desc, status: 'Under Review', createdAt: new Date() });
            db.incidents.push(rec);
            logActivity(db, currentUser, `Filed incident report ${rec.code}`);
            saveDB(db);
            closeModal(); renderIncTable(); toast('Incident report filed.', 'ok');
        }
    }]);
}
function openIncidentDetail(id) {
    const db = loadDB();
    const r = db.incidents.find(x => x.id === id);
    openModal(`${r.code} ${icon('lock', 13)}`, `
    <div class="kv"><span>Involved</span><span>${r.involved}</span></div>
    <div class="kv"><span>Reported By</span><span>${r.reporter}</span></div>
    <div class="kv"><span>Date Filed</span><span>${fmtDateTime(r.createdAt)}</span></div>
    <div class="field" style="margin-top:14px;"><label>Description</label><textarea disabled>${r.description}</textarea></div>
    <div class="field"><label>Actions Taken</label><textarea id="mIncActions" placeholder="Document actions taken">${r.actions || ''}</textarea></div>
    <div class="field"><label>Status</label><select id="mIncStatus"><option ${r.status === 'Under Review' ? 'selected' : ''}>Under Review</option><option ${r.status === 'Escalated' ? 'selected' : ''}>Escalated</option><option ${r.status === 'Resolved' ? 'selected' : ''}>Resolved</option></select></div>
  `, [{ label: 'Close', cls: 'btn-ghost', action: closeModal },
    {
        label: 'Save', cls: 'btn-primary', action: () => {
            const db2 = loadDB();
            const r2 = db2.incidents.find(x => x.id === id);
            r2.actions = document.getElementById('mIncActions').value;
            r2.status = document.getElementById('mIncStatus').value;
            logActivity(db2, currentUser, `Updated incident ${r2.code} (${r2.status})`);
            saveDB(db2);
            closeModal(); renderIncTable(); toast('Incident report updated.', 'ok');
        }
    }]);
}

/* =========================================================================
   SCHOLARSHIP
========================================================================= */
function renderScholarship() {
    document.getElementById('content').innerHTML = `
    <div class="card"><div class="card-head"><div><h3>Scholarship Records <span class="tag-lock">${icon('lock', 12)} Confidential</span></h3><div class="desc">OSS admin-managed documentation</div></div>
      <button class="btn btn-primary btn-sm" onclick="openScholarshipForm()">${icon('plus', 14)} New Record</button></div>
      <div class="table-wrap"><table><thead><tr><th>Student</th><th>Program</th><th>Document</th><th>Status</th><th></th></tr></thead><tbody id="schBody"></tbody></table></div>
    </div>
  `;
    renderSchTable();
}
function renderSchTable() {
    const db = loadDB();
    const rows = [...db.scholarships].sort((a, b) => b.createdAt - a.createdAt);
    document.getElementById('schBody').innerHTML = rows.length ? rows.map(r => `<tr><td>${escapeHtml(r.name)}<div class="muted" style="font-size:.72rem;">${r.idNumber}</div></td><td>${r.program}</td><td>${r.doc}</td><td>${statusPill(r.status)}</td><td><button class="btn btn-ghost btn-sm" onclick="cycleSch('${r.id}')">Advance Status</button></td></tr>`).join('') : `<tr class="empty-row"><td colspan="5">No scholarship records yet.</td></tr>`;
}
function cycleSch(id) {
    const order = ['Pending', 'Under Evaluation', 'Approved', 'Released'];
    const db = loadDB();
    const r = db.scholarships.find(x => x.id === id);
    const idx = order.indexOf(r.status);
    r.status = order[Math.min(idx + 1, order.length - 1)];
    logActivity(db, currentUser, `Advanced scholarship status for ${r.name} to ${r.status}`);
    saveDB(db);
    renderSchTable();
}
function openScholarshipForm() {
    openModal('New Scholarship Record', `
    <div class="field"><label>Student Name</label><input id="mScName"></div>
    <div class="form-row"><div class="field"><label>Student Number</label><input id="mScId"></div><div class="field"><label>Program</label><input id="mScProg" placeholder="e.g. Academic Scholarship"></div></div>
    <div class="field"><label>Document</label><input id="mScDoc" placeholder="e.g. Grade Report + Good Moral"></div>
  `, [{ label: 'Cancel', cls: 'btn-ghost', action: closeModal },
    {
        label: 'Add Record', cls: 'btn-primary', action: () => {
            const name = document.getElementById('mScName').value.trim();
            if (!name) { toast('Student name is required.', 'err'); return; }
            const db = loadDB();
            const rec = mkScholarship({ name, idNumber: document.getElementById('mScId').value, program: document.getElementById('mScProg').value || 'General', doc: document.getElementById('mScDoc').value || '&mdash;', status: 'Pending', createdAt: new Date() });
            db.scholarships.push(rec);
            logActivity(db, currentUser, `Added scholarship record for ${name}`);
            saveDB(db);
            closeModal(); renderSchTable(); toast('Record added.', 'ok');
        }
    }]);
}

/* =========================================================================
   MANAGE SERVICES
========================================================================= */
function renderServicesManage() {
    document.getElementById('content').innerHTML = `
    <div class="card"><div class="card-head"><div><h3>Service Catalog</h3><div class="desc">These services appear as cards in the visitor portal and as sections under Transactions</div></div>
      <button class="btn btn-primary btn-sm" onclick="openServiceForm()">${icon('plus', 14)} Create Service</button></div>
      <div class="card-pad"><div class="svc-manage-grid" id="svcManageGrid"></div></div>
    </div>
  `;
    renderSvcManageGrid();
}
function renderSvcManageGrid() {
    const db = loadDB();
    const grid = document.getElementById('svcManageGrid');
    if (!db.services.length) { grid.innerHTML = `<div class="helper-empty">${icon('folder', 30)}<p>No services yet. Create one to get started.</p></div>`; return; }
    grid.innerHTML = db.services.map(s => `<div class="svc-manage-card">
    <div class="top"><span class="ic">${icon(s.icon || 'home', 18)}</span><div style="display:flex; gap:6px;"><button class="icon-btn" title="Edit" onclick="openServiceForm('${s.key}')">${icon('edit', 14)}</button><button class="icon-btn" title="Delete" onclick="deleteService('${s.key}')">${icon('trash', 14)}</button></div></div>
    <h4>${escapeHtml(s.label)}</h4><div class="desc-txt">${escapeHtml(s.desc || '')}</div>
    <div class="req-mini">${s.requirements && s.requirements.length ? s.requirements.length + ' requirement(s): ' + s.requirements.map(escapeHtml).join(', ') : 'No requirements set'}</div>
    <div class="req-mini mono">${countTxnForService(db, s.key)} transaction(s) logged</div>
  </div>`).join('');
}
function openServiceForm(key) {
    const db = loadDB();
    const editing = key ? db.services.find(s => s.key === key) : null;
    openModal(editing ? 'Edit Service' : 'Create Service', `
    <div class="field"><label>Service Name</label><input id="mSvcLabel" value="${editing ? escapeHtml(editing.label) : ''}" placeholder="e.g. Good Moral Character"></div>
    <div class="field"><label>Short Description</label><textarea id="mSvcDesc" placeholder="Shown as the card blurb on the visitor portal">${editing ? escapeHtml(editing.desc || '') : ''}</textarea></div>
    <div class="field"><label>Requirements <span class="muted" style="font-weight:400;">(one per line)</span></label><textarea id="mSvcReq" placeholder="Valid School ID">${editing ? escapeHtml((editing.requirements || []).join('\n')) : ''}</textarea></div>
    <div class="field"><label>Icon</label><div class="icon-picker">${ICON_CHOICES.map(ic => `<label><input type="radio" name="mSvcIcon" value="${ic}" ${(editing ? editing.icon : ICON_CHOICES[0]) === ic ? 'checked' : ''}><span>${icon(ic, 18)}</span></label>`).join('')}</div></div>
  `, [{ label: 'Cancel', cls: 'btn-ghost', action: closeModal },
    {
        label: editing ? 'Save Changes' : 'Create Service', cls: 'btn-primary', action: () => {
            const label = document.getElementById('mSvcLabel').value.trim();
            if (!label) { toast('Service name is required.', 'err'); return; }
            const desc = document.getElementById('mSvcDesc').value.trim();
            const reqs = document.getElementById('mSvcReq').value.split('\n').map(s => s.trim()).filter(Boolean);
            const iconEl = document.querySelector('input[name="mSvcIcon"]:checked');
            const iconVal = iconEl ? iconEl.value : 'home';
            const db2 = loadDB();
            if (editing) {
                const e2 = db2.services.find(s => s.key === editing.key);
                e2.label = label; e2.desc = desc; e2.requirements = reqs; e2.icon = iconVal;
                logActivity(db2, currentUser, `Updated service "${label}"`);
                toast('Service updated.', 'ok');
            } else {
                const key2 = slugify(label);
                if (db2.services.some(s => s.key === key2)) { toast('A service with a similar name already exists.', 'err'); return; }
                db2.services.push({ key: key2, label, desc, requirements: reqs, icon: iconVal });
                logActivity(db2, currentUser, `Created service "${label}"`);
                toast('Service created.', 'ok');
            }
            saveDB(db2);
            closeModal(); renderSvcManageGrid(); renderSidebar();
        }
    }]);
}
function deleteService(key) {
    const db = loadDB();
    const s = db.services.find(x => x.key === key);
    if (!s) return;
    const used = countTxnForService(db, key);
    if (!confirm(`Delete "${s.label}"?${used ? ` ${used} existing transaction(s) will keep the label for reference.` : ''}`)) return;
    db.services = db.services.filter(x => x.key !== key);
    logActivity(db, currentUser, `Deleted service "${s.label}"`);
    if (txnServiceFilter === key) txnServiceFilter = undefined;
    saveDB(db);
    renderSvcManageGrid(); renderSidebar();
    toast('Service deleted.', 'ok');
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
      <div class="report-header"><span class="crest"><img src="pup.jpg" alt="PUP logo" class="report-crest-img"></span><div class="t"><small>Office of Student Services</small><h2 id="repTitle">Daily Transaction Report</h2></div></div>
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
    const chats = db.chats.filter(c => c.createdAt >= start);
    const inc = db.incidents.filter(i => i.createdAt >= start);
    const sch = db.scholarships.filter(s => s.createdAt >= start);
    document.getElementById('repBody').innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="lbl">Total Transactions</div><div class="val">${txns.length}</div></div>
      <div class="stat-card"><div class="lbl">Appointments Booked</div><div class="val">${appts.length}</div></div>
      <div class="stat-card"><div class="lbl">Completed</div><div class="val">${txns.filter(t => t.status === 'Completed').length}</div></div>
      <div class="stat-card"><div class="lbl">Pending</div><div class="val">${txns.filter(t => t.status === 'Pending').length}</div></div>
    </div>
    <h3 style="font-size:.95rem; margin-bottom:10px;">Breakdown by Service</h3>
    <div class="table-wrap"><table><thead><tr><th>Service</th><th>Count</th></tr></thead><tbody>${db.services.map(s => `<tr><td>${s.label}</td><td>${counts[s.key] || 0}</td></tr>`).join('')}</tbody></table></div>
    <div class="divider"></div>
    <div class="kv"><span>Chat Conversations Started</span><span>${chats.length}</span></div>
    <div class="kv"><span>Incident Reports Filed</span><span>${inc.length}</span></div>
    <div class="kv"><span>Scholarship Records Added</span><span>${sch.length}</span></div>
  `;
}

/* =========================================================================
   PROFILE
========================================================================= */
function renderProfile() {
    const u = currentUser;
    const initials = u.fullName.split(' ').map(s => s[0]).slice(0, 2).join('');
    document.getElementById('content').innerHTML = `
    <div class="card" style="max-width:560px;">
      <div class="profile-head"><div class="profile-avatar">${initials}</div><div><div style="font-weight:700; font-size:1.05rem;">${escapeHtml(u.fullName)}</div><span class="pill pill-gold">${ROLES[u.role].label}</span></div></div>
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