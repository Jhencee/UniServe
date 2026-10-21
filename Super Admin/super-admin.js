const DB_KEY = 'ossuniserve_db_v1';
const ROLES = { SUPER_ADMIN: { label: 'Super Admin' }, ADMIN: { label: 'Admin' }, SYSTEM: { label: 'System' }, VISITOR: { label: 'Visitor' } };
const SYSTEM_ACTOR = { fullName: 'System', role: 'SYSTEM' };
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

const QUEUE_AVG_MINUTES = 4;
const DEFAULT_GRACE_MINUTES = 15;
const DEFAULT_NOSHOW_MINUTES = 60;
const AUDIT_CATEGORIES = ['Confidential', 'Authentication', 'Accounts', 'Settings', 'Data', 'Transactions', 'Queue', 'Appointments', 'Messages', 'Feedback', 'System'];
const AUDIT_MAX_ENTRIES = 2000;
const CONFIDENTIAL_SERVICES = ['incident_report', 'concern', 'scholarship_txn', 'excuse_letter'];

function graceMinutes(db) { return Number(db.systemSettings.gracePeriodMinutes) || DEFAULT_GRACE_MINUTES; }
function noShowMinutes(db) { return Number(db.systemSettings.noShowThresholdMinutes) || DEFAULT_NOSHOW_MINUTES; }
function apptScheduledDate(appt) {
  if (!appt.date || !appt.time) return null;
  const m = /(\d+):(\d+)\s*(AM|PM)/i.exec(appt.time);
  if (!m) return null;
  let h = Number(m[1]) % 12;
  if (/PM/i.test(m[3])) h += 12;
  const [y, mo, da] = appt.date.split('-').map(Number);
  return new Date(y, mo - 1, da, h, Number(m[2]));
}
function evaluateArrival(db, appt) {
  const sched = apptScheduledDate(appt);
  if (!sched) return { status: 'OnTime', lateMinutes: 0 };
  const lateMinutes = Math.round((new Date() - sched) / 60000);
  if (lateMinutes <= graceMinutes(db)) return { status: 'OnTime', lateMinutes: Math.max(0, lateMinutes) };
  if (lateMinutes <= noShowMinutes(db)) return { status: 'Late', lateMinutes };
  return { status: 'PastWindow', lateMinutes };
}
function sweepNoShows(db) {
  let changed = false;
  (db.appointments || []).forEach(a => {
    if (a.shared || a.queueId || a.status !== 'Booked') return;
    const arr = evaluateArrival(db, a);
    if (arr.status !== 'PastWindow') return;
    Object.assign(a, { status: 'No-show', arrivalStatus: 'NoShow', lateMinutes: arr.lateMinutes, autoNoShow: true });
    logActivity(db, SYSTEM_ACTOR, `Auto-marked ${a.visitId} (${a.code}) as No-show &mdash; ${fmtMinutes(arr.lateMinutes)} past the scheduled time`, { category: 'Appointments', target: a.visitId });
    changed = true;
  });
  return changed;
}

function uid(p) {
  const c = (Number(localStorage.getItem(DB_KEY + '_uidc')) || 1000) + 1;
  localStorage.setItem(DB_KEY + '_uidc', c);
  return p + c;
}
const pad2 = n => String(n).padStart(2, '0');
const fmtDate = d => { d = new Date(d); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const fmtTime = d => { d = new Date(d); let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return `${h}:${pad2(d.getMinutes())} ${ap}`; };
const fmtDateTime = d => `${fmtDate(d)} &middot; ${fmtTime(d)}`;
const today = () => fmtDate(new Date());
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(0, 0, 0, 0); return d; };
const randCode = prefix => { const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)]; return `${prefix}-${s}`; };
function escapeHtml(s) { if (s == null) return ''; return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtMinutes(m) {
 if(m==null)return '&mdash;';
 const seconds=Math.max(0,Math.round(Number(m)*60));
 const h=Math.floor(seconds/3600),n=Math.floor(seconds%3600/60),sec=seconds%60;
 return [h?h+' '+(h===1?'hour':'hours'):'',n?n+' '+(n===1?'minute':'minutes'):'',sec?sec+' '+(sec===1?'second':'seconds'):''].filter(Boolean).join(' ')||'0 seconds';
}
function actionText(s) { return String(s == null ? '' : s).replace(/&mdash;/g, '—').replace(/&middot;/g, '·').replace(/&ndash;/g, '–'); }
function diffFields(before, after, labels) {
  return Object.keys(labels).filter(k => String(before[k] ?? '') !== String(after[k] ?? '')).map(k => ({ field: labels[k], from: before[k] ?? '', to: after[k] ?? '' }));
}

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
    users: [
      { id: 'u1', username: 'admin', fullName: 'System Administrator', role: 'SUPER_ADMIN', active: true, email: 'sysadmin@oss.edu.ph', confidentialAccess: false },
    ],
    services: DEFAULT_SERVICES.map(s => ({ ...s, requirements: [...s.requirements] })),
    transactions: [], appointments: [], chats: [],
    activityLog: [], queues: [], queueCounters: {}, visitorLog: [], visitCounter: 0,
    systemSettings: { orgName: 'Office of Student Services', supportEmail: 'oss@university.edu.ph', supportPhone: '0917-000-0000', timezone: 'Asia/Manila', maintenanceMode: false, autoCloseChats: false, sessionTimeout: 30, queuePrefixStudent: 'A', queuePrefixGuest: 'G', gracePeriodMinutes: DEFAULT_GRACE_MINUTES, noShowThresholdMinutes: DEFAULT_NOSHOW_MINUTES },
  };
}
function mkTxn(o) { return { id: uid('T'), code: randCode('OSS'), status: 'Pending', escalation: null, ...o, updatedAt: o.createdAt || new Date() }; }
function mkAppt(o) { return { id: uid('A'), code: randCode('APT'), visitId: null, queueId: null, queueNumber: null, isSenior: false, isPWD: false, attachments: [], readiness: null, arrivalStatus: null, lateMinutes: null, possibleDuplicate: false, ...o }; }
function mkLog(user, role, action, ts) { return { id: uid('L'), user, role, action, ts: ts || new Date() }; }
function mkChat(o) { return { id: uid('C'), status: 'Open', messages: [], staffUnread: 0, visitorUnread: 0, createdAt: new Date(), updatedAt: new Date(), ...o }; }
function mkQueue(o) {
  return { id: uid('Q'), visitId: null, number: null, status: 'Waiting', createdAt: new Date(), checkedInAt: new Date(), scheduledAt: null, calledAt: null, servingAt: null, completedAt: null, assignedAdminId: null, assignedAdminName: null, transactionId: null, appointmentId: null, visitorLogId: null, recallCount: 0, isSenior: false, isPWD: false, possibleDuplicate: false, feedback: null, ...o };
}
const DATE_FIELDS = ['createdAt', 'updatedAt', 'calledAt', 'servingAt', 'completedAt', 'recalledAt', 'transferredAt', 'checkedInAt', 'scheduledAt', 'skippedAt', 'cancelledAt', 'startedAt', 'escalatedAt', 'submittedAt', 'ts', 'timeIn', 'timeOut'];
function reviveDates(obj) {
  if (Array.isArray(obj)) { obj.forEach(reviveDates); return obj; }
  if (obj && typeof obj === 'object') Object.keys(obj).forEach(k => { if (DATE_FIELDS.includes(k) && obj[k]) obj[k] = new Date(obj[k]); else reviveDates(obj[k]); });
  return obj;
}
function loadDB() {
  const raw = localStorage.getItem(DB_KEY);
  if (!raw) { const s = freshState(); localStorage.setItem(DB_KEY, JSON.stringify(s)); return s; }
  try {
    const p = reviveDates(JSON.parse(raw));
    p.visitorLog = p.visitorLog || []; p.appointments = p.appointments || [];
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
function callableQueue(db) { const now = new Date(); return waitingQueueSorted(db).filter(q => isDue(q, now)); }
function todaysQueue(db) { const t = today(); return db.queues.filter(q => fmtDate(q.createdAt) === t); }
function visitStart(q) {
  const arrived = new Date(q.checkedInAt || q.createdAt);
  return q.source === 'Appointment' && q.scheduledAt && new Date(q.scheduledAt) > arrived ? new Date(q.scheduledAt) : arrived;
}
function serviceLabel(db, key) { const s = db.services.find(x => x.key === key); return s ? s.label : key; }
function serviceQueueLabel(db, e) { return e.serviceLabel || (e.serviceKey ? serviceLabel(db, e.serviceKey) : 'General Concern'); }
function queueStats(db) {
  const list = todaysQueue(db);
  const done = list.filter(q => q.status === 'Completed');
  const withWait = done.filter(q => q.calledAt);
  const avgWaitMin = withWait.length ? Math.round(withWait.reduce((s, q) => s + (new Date(q.calledAt) - visitStart(q)), 0) / withWait.length / 60000) : null;
  return {
    waiting: list.filter(q => q.status === 'Waiting').length,
    serving: list.filter(q => q.status === 'Serving' || q.status === 'Called').length,
    completedToday: done.length, avgWaitMin, next: callableQueue(db)[0] || null,
  };
}
function peakHourWindows(db) {
  const since = daysAgo(30), counts = new Array(24).fill(0);
  db.queues.forEach(q => { const t = q.checkedInAt || q.createdAt; if (t && new Date(t) >= since) counts[new Date(t).getHours()]++; });
  const max = Math.max(...counts);
  return max === 0 ? [] : [fmtHourRange(counts.indexOf(max))];
}
function fmtHourRange(h) {
  const f = hh => `${hh % 12 || 12}:00 ${hh >= 12 ? 'PM' : 'AM'}`;
  return `${f(h)} &ndash; ${f((h + 1) % 24)}`;
}

const STARS = n => '&#9733;'.repeat(n) + '&#9734;'.repeat(5 - n);
function feedbackStats(db) {
  const rows = db.queues.filter(q => q.feedback), n = rows.length, completed = db.queues.filter(q => q.status === 'Completed').length;
  const satisfied = rows.filter(q => q.feedback.rating >= 4).length;
  return {
    rows, n, completed, satisfied,
    avg: n ? rows.reduce((s, q) => s + q.feedback.rating, 0) / n : null,
    satPct: n ? Math.round(satisfied / n * 100) : null,
    rate: completed ? Math.round(n / completed * 100) : null,
    dist: [5, 4, 3, 2, 1].map(s => ({ label: `${s} star${s === 1 ? '' : 's'}`, count: rows.filter(q => q.feedback.rating === s).length })),
  };
}
function feedbackCommentHtml(id, text) {
  const t = escapeHtml(text);
  return `<div class="fb-comment" title="Click to read the full comment" onclick="openFeedbackComment('${id}')">${t}</div>`;
}
function openFeedbackComment(id) {
  const db = loadDB(), q = db.queues.find(x => x.id === id);
  if (!q || !q.feedback) { toast('Feedback not found.', 'err'); return; }
  const t = q.transactionId ? db.transactions.find(x => x.id === q.transactionId) : null;
  if (t && isTxnLocked(t)) { toast('This feedback belongs to a confidential record.', 'err'); return; }
  const when = q.feedback.submittedAt || q.completedAt || q.createdAt;
  openModal('Visitor Feedback', `
    <div class="kv"><span>Visit</span><span class="mono">${escapeHtml(q.visitId || q.number || '—')}</span></div>
    <div class="kv"><span>Visitor</span><span>${escapeHtml(q.name || '—')}</span></div>
    <div class="kv"><span>Service</span><span>${escapeHtml(serviceQueueLabel(db, q))}</span></div>
    <div class="kv"><span>Rating</span><span class="fb-readout"><span class="stars">${STARS(q.feedback.rating)}</span></span></div>
    <div class="kv"><span>Date</span><span class="mono">${fmtDateTime(when)}</span></div>
    <div class="divider"></div>
    <div class="fb-full">${escapeHtml(q.feedback.comment || '')}</div>`, []);
}
function feedbackDashboardHtml(db) {
  const fs = feedbackStats(db);
  const when = q => new Date((q.feedback && q.feedback.submittedAt) || q.completedAt || 0);
  const recent = fs.rows.filter(q => q.feedback.comment).sort((a, b) => when(b) - when(a)).slice(0, 5);
  const cell = q => { const t = q.transactionId ? db.transactions.find(x => x.id === q.transactionId) : null; return t && isTxnLocked(t) ? { name: maskName(q.name), text: null } : { name: q.name || '—', text: q.feedback.comment }; };
  return `<div class="stat-grid">
        <div class="stat-card"><div class="lbl">Responses</div><div class="val">${fs.n}</div></div>
        <div class="stat-card"><div class="lbl">Average Rating</div><div class="val">${fs.avg == null ? '&mdash;' : fs.avg.toFixed(1)}</div></div>
        <div class="stat-card"><div class="lbl">Satisfied (4&ndash;5 stars)</div><div class="val">${fs.satPct == null ? '&mdash;' : fs.satPct + '%'}</div></div>
        <div class="stat-card"><div class="lbl">Response Rate</div><div class="val">${fs.rate == null ? '&mdash;' : fs.rate + '%'}</div></div></div>
    <div class="grid-2 grid-even">
    <div class="card"><div class="card-head"><div><h3>Ratings</h3><div class="desc">Stars given after completed visits</div></div></div>
      <div class="card-pad">${fs.n ? svgBarChart(fs.dist) : emptyChart('No feedback received yet.')}</div></div>
    <div class="card"><div class="card-head"><div><h3>Recent Comments</h3><div class="desc">Latest written feedback</div></div></div>
      <div class="table-wrap"><table><thead><tr><th>Visitor</th><th>Rating</th><th>Comment</th></tr></thead><tbody>${recent.length ? recent.map(q => { const c = cell(q); return `<tr><td>${escapeHtml(c.name)}</td><td><span class="fb-readout"><span class="stars">${STARS(q.feedback.rating)}</span></span></td><td class="fb-comment-cell">${c.text ? feedbackCommentHtml(q.id, c.text) : '<span class="muted">Hidden</span>'}</td></tr>`; }).join('') : `<tr class="empty-row"><td colspan="3">No comments yet.</td></tr>`}</tbody></table></div></div></div>`;
}

function inferCategory(action) {
  const a = String(action || '').toLowerCase();
  if (/confidential/.test(a)) return 'Confidential';
  if (/logged (in|out)|login|logout|timed out/.test(a)) return 'Authentication';
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
function auditIntegrity(db) {
  const log = db.activityLog, bad = [];
  let unsealed = 0;
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i], older = log[i + 1];
    if (!e.hash) { unsealed++; continue; }
    if (auditDigest(e) !== e.hash) bad.push([e, 'The entry was changed after it was recorded']);
    else if (older && older.hash && e.prev !== older.hash) bad.push([e, 'The link to the previous entry is broken (an entry was removed, inserted or reordered)']);
  }
  return { total: log.length, unsealed, bad };
}

function reportLetterhead() {
  return `<div class="report-header">
      <span class="report-logo-left"><img src="pup.jpg" alt="PUP Seal"></span>
      <div class="report-org-text"><div class="org-country">Republic of the Philippines</div><div class="org-univ">Polytechnic University of the Philippines</div><div class="org-office">Office of the Vice President for Campuses</div><div class="org-campus">Santa Maria Campus</div></div>
      <span class="report-logo-right"><img src="pilipinas.png" alt="Bagong Pilipinas"></span></div>`;
}
function reportFooter() {
  return `<div class="print-footer"><div class="pf-text"><div class="pf-addr">Km. 38, Pulong Buhangin, Santa Maria, Bulacan, 3022</div><div class="pf-addr">Website: www.pup.edu.ph | Email: stamaria@pup.edu.ph</div><div class="pf-tag">A Leading Comprehensive Polytechnic University in Asia</div></div><img class="pf-badges" src="badge.png" alt=""></div>`;
}
function reportSignatureBlock() {
  return `<div class="rpt-signature-block">
    <div class="rpt-sign-col"><div class="rpt-sign-line"></div><div class="rpt-sign-name">${escapeHtml(currentUser.fullName)}</div><div class="rpt-sign-role">Prepared by, Super Admin</div></div>
    <div class="rpt-sign-col"><div class="rpt-sign-line"></div><div class="rpt-sign-name">&nbsp;</div><div class="rpt-sign-role">Noted by, Head, Office of Student Services</div></div></div>`;
}
function printInjected(html) {
  document.querySelectorAll('.print-inject').forEach(n => n.remove());
  const wrap = document.createElement('div');
  wrap.id = 'printArea'; wrap.className = 'print-inject';
  wrap.innerHTML = `<table class="print-sheet"><tbody><tr><td>${html}</td></tr></tbody><tfoot><tr><td><div class="print-footer-space"></div></td></tr></tfoot></table>${reportFooter()}`;
  document.body.appendChild(wrap);
  window.prepareStaffReport?.(wrap);
  const cleanup = () => { wrap.remove(); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  const imgs = Array.from(wrap.querySelectorAll('img')).map(img => img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; }));
  Promise.all([...imgs, document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()]).then(() => {
    const fi = wrap.querySelector('.print-footer img');
    if (fi && fi.naturalWidth) wrap.style.setProperty('--footer-h', Math.min(20, Math.max(14, 187.9 * 0.70 * fi.naturalHeight / fi.naturalWidth)).toFixed(1) + 'mm');
    window.print();
    setTimeout(() => { if (document.body.contains(wrap)) wrap.remove(); }, 8000);
  });
}

function buildTrendBuckets(items, start) {
  const day = 86400000, rangeDays = Math.max(1, Math.round((new Date() - start) / day));
  const unit = rangeDays <= 14 ? 'day' : 'week', bucketMs = unit === 'day' ? day : day * 7;
  const n = Math.max(1, Math.ceil(rangeDays / (bucketMs / day)));
  const buckets = Array.from({ length: n }, (_, i) => ({ start: new Date(start.getTime() + i * bucketMs), count: 0 }));
  items.forEach(t => { const i = Math.min(n - 1, Math.floor((t.createdAt - start) / bucketMs)); if (i >= 0) buckets[i].count++; });
  return { labels: buckets.map(b => fmtDate(b.start).slice(5)), values: buckets.map(b => b.count), unit };
}
function truncateLabel(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function svgLineChart(trend, label) {
  const { labels, values } = trend;
  const gradientId = `trend-fill-${svgLineChart.gradientSequence = (svgLineChart.gradientSequence || 0) + 1}`;
  const w = 760, h = 220, padL = 34, padR = 20, padT = 20, padB = 34, innerW = w - padL - padR, innerH = h - padT - padB;
  const max = Math.max(1, ...values), stepX = values.length > 1 ? innerW / (values.length - 1) : 0;
  const pts = values.map((v, i) => ({ x: padL + (values.length > 1 ? i * stepX : innerW / 2), y: padT + innerH - (v / max) * innerH, v }));
  const line = pts.map((p, i) => {
    if (!i) return `M${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    const previous = pts[i - 1], middle = (previous.x + p.x) / 2;
    return `C${middle.toFixed(1)},${previous.y.toFixed(1)} ${middle.toFixed(1)},${p.y.toFixed(1)} ${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(' ');
  const area = pts.length > 1 ? `${line} L${pts[pts.length - 1].x.toFixed(1)},${(padT + innerH).toFixed(1)} L${pts[0].x.toFixed(1)},${(padT + innerH).toFixed(1)} Z` : '';
  const grid = [0, .25, .5, .75, 1].map(f => { const y = padT + innerH - f * innerH; return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" stroke="var(--text)" stroke-opacity="0.05"/><text x="${padL - 8}" y="${(y + 3).toFixed(1)}" font-size="10" text-anchor="end" fill="var(--text)">${Math.round(max * f)}</text>`; }).join('');
  const xl = pts.map((p, i) => `<text x="${p.x.toFixed(1)}" y="${h - 10}" font-size="10" text-anchor="middle" fill="var(--text)">${escapeHtml(labels[i])}</text>`).join('');
  const dots = pts.map(p => `<g class="cl-point-group"><circle class="cl-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" stroke-width="2"/><text class="cl-val-label" x="${p.x.toFixed(1)}" y="${(p.y - 9).toFixed(1)}" font-size="10" text-anchor="middle" fill="var(--text)">${p.v}</text></g>`).join('');
  const total = values.reduce((sum, value) => sum + value, 0);
  const average = values.length ? (total / values.length).toFixed(1) : '0';
  const peak = values.length ? Math.max(...values) : 0;
  return `<div class="trend-summary"><span>Total <strong>${total}</strong></span><span>Daily average <strong>${average}</strong></span><span>Busiest day <strong>${peak} transactions</strong></span></div><div class="trend-chart-scroll"><svg viewBox="0 0 ${w} ${h}" style="width:100%; height:auto; max-height:240px;" role="img" aria-label="${escapeHtml(label || 'Trend chart')}"><defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--trend-color, #8b5cf6)" stop-opacity="0.16"/><stop offset="100%" stop-color="var(--trend-color, #8b5cf6)" stop-opacity="0.015"/></linearGradient></defs>${grid}${area ? `<path class="cl-area" style="--trend-fill:url(#${gradientId})" d="${area}" stroke="none"/>` : ''}<path class="cl-line" pathLength="1000" d="${line}" fill="none" stroke-width="2.5"/>${dots}${xl}</svg></div>`;
}
function svgBarChart(rows, opts) {
  opts = opts || {};
  const w = 380, rowH = 30, h = opts.height || rows.length * rowH + 20, max = Math.max(1, ...rows.map(r => r.count)), labelW = 120, barW = w - labelW - 50;
  const bars = rows.map((r, i) => {
    const y = 10 + i * rowH, bw = (r.count / max) * barW;
    return `<g class="chart-bar-row"><text class="cb-label" x="0" y="${y + rowH / 2 + 4}" font-size="11" fill="var(--text)">${escapeHtml(truncateLabel(r.label, 18))}</text>
      <rect x="${labelW}" y="${y + 4}" width="${barW}" height="${rowH - 14}" fill="var(--text)" fill-opacity="0.05"/>
      <rect class="cb-rect animated" style="animation-delay:${i * 45}ms" x="${labelW}" y="${y + 4}" width="${bw.toFixed(1)}" height="${rowH - 14}"/>
      <text class="cb-value" x="${labelW + barW + 8}" y="${y + rowH / 2 + 4}" font-size="11" fill="var(--text)" font-weight="600">${r.count}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%; height:auto;" role="img" aria-label="Bar chart">${bars}</svg>`;
}
const emptyChart = msg => `<div class="helper-empty" style="padding:20px 10px;">${icon('chart', 26)}<p>${msg}</p></div>`;

function icon(name, size = 17) {
  const p = {
    eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 100-6 3 3 0 000 6z',
    'eye-off': 'M17.94 17.94A10.94 10.94 0 0112 20c-7 0-11-8-11-8a21.5 21.5 0 015.06-6.06M9.9 4.24A10.94 10.94 0 0112 4c7 0 11 8 11 8a21.5 21.5 0 01-2.61 3.68M14.12 14.12a3 3 0 11-4.24-4.24M1 1l22 22',
    dashboard: 'M4 13h6V4H4v9zm0 7h6v-5H4v5zm10 0h6V11h-6v9zm0-16v5h6V4h-6z',
    calendar: 'M8 2v4M16 2v4M3 9h18M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z',
    alert: 'M12 3l9 16H3l9-16zM12 10v4M12 17.5v.01',
    chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    users: 'M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M13 7a4 4 0 11-8 0 4 4 0 018 0M23 21v-2a4 4 0 00-3-3.87M17 3.13a4 4 0 010 7.75',
    lock: 'M5 11h14v9H5v-9zM8 11V7a4 4 0 118 0v4',
    search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35',
    plus: 'M12 5v14M5 12h14',
    print: 'M6 9V2h12v7M6 18H4a1 1 0 01-1-1v-6a1 1 0 011-1h16a1 1 0 011 1v6a1 1 0 01-1 1h-2M6 14h12v8H6v-8z',
    edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z',
    trash: 'M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m2 0v14a1 1 0 01-1 1H7a1 1 0 01-1-1V6h12z',
    x: 'M18 6L6 18M6 6l12 12',
    check: 'M20 6L9 17l-5-5',
    home: 'M3 12l9-9 9 9M5 10v10h14V10',
    userc: 'M12 12a5 5 0 100-10 5 5 0 000 10zM3 21a9 9 0 0118 0',
    ticket: 'M4 8a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2a2 2 0 000-4V8zM10 6v2M10 11v2M10 16v2',
    log: 'M4 4h16v16H4V4zM8 8h8M8 12h8M8 16h5',
    download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
    gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z',
    dots: 'M12 5v.01M12 12v.01M12 19v.01',
  }[name] || 'M12 2v20';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p.split('M').filter(Boolean).map(seg => `<path d="M${seg}"/>`).join('')}</svg>`;
}
function toast(msg, type = 'ok') {
  const wrap = document.getElementById('toastWrap'), el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-ic">${icon(type === 'err' ? 'x' : 'check', 14)}</span><span class="toast-msg">${msg}</span>`;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
function openModal(title, bodyHtml, buttons) {
  closeModal();
  buttons = (buttons || []).filter(b => b.label !== 'Close');
  const wrap = document.createElement('div');
  wrap.className = 'overlay'; wrap.id = 'activeModal';
  wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><div class="modal-head"><h3>${title}</h3><button class="close-x" id="modalCloseX" aria-label="Close">${icon('x', 18)}</button></div><div class="modal-body">${bodyHtml}</div>${buttons.length ? `<div class="modal-foot">${buttons.map((b, i) => `<button class="btn ${b.cls} btn-sm" id="modalBtn${i}">${b.label}</button>`).join('')}</div>` : ''}</div>`;
  document.body.appendChild(wrap);
  buttons.forEach((b, i) => document.getElementById(`modalBtn${i}`).onclick = b.action);
  document.getElementById('modalCloseX').onclick = closeModal;
  wrap.addEventListener('click', e => { if (e.target === wrap) closeModal(); });
}
function closeModal() { const m = document.getElementById('activeModal'); if (m) m.remove(); }

function setTheme(t) { localStorage.setItem('ossuniserve_theme', t); document.documentElement.setAttribute('data-theme', t); document.querySelectorAll('[data-theme-btn]').forEach(b => b.classList.toggle('active', b.dataset.themeBtn === t)); }
setTheme(localStorage.getItem('ossuniserve_theme') || 'light');

let currentUser = null;
(function guard() {
  const sess = loadSession(), db = loadDB();
  const fresh = sess.currentUser ? db.users.find(u => u.id === sess.currentUser.id) : null;
  if (!sess.token || !fresh || fresh.role !== 'SUPER_ADMIN' || !fresh.active) {
    location.href = '../Landing/landing.html';
    throw new Error('OSS UniServe: not an authorized Super Admin session — redirecting to login.');
  }
  currentUser = fresh;
})();
function endSession(reason) {
  sessionStorage.removeItem('ossuniserve_session');
  if (reason) sessionStorage.setItem('ossuniserve_notice', reason);
  location.href = '../Landing/landing.html';
}
function doLogout() {
  openModal('Log Out?', '<p>Are you sure you want to log out?</p>', [
    { label: 'Cancel', cls: 'btn-ghost', action: closeModal },
    { label: 'Log Out', cls: 'btn-primary', action: () => {
      const db = loadDB();
      logActivity(db, currentUser, 'Logged out', { category: 'Authentication' });
      saveDB(db);
      closeModal();
      endSession();
    } }
  ]);
}
function validateSession() {
  const fresh = loadDB().users.find(u => u.id === currentUser.id);
  if (!fresh || fresh.role !== 'SUPER_ADMIN' || !fresh.active) { endSession('Your account is no longer active.'); return false; }
  currentUser = fresh;
  return true;
}
let lastActivity = Date.now();
['click', 'keydown', 'mousemove', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true }));
setInterval(() => {
  if (!validateSession()) return;
  const mins = Number(loadDB().systemSettings.sessionTimeout) || 30;
  if (Date.now() - lastActivity > mins * 60000) {
    const db = loadDB();
    logActivity(db, currentUser, 'Session timed out (idle)', { category: 'Authentication' });
    saveDB(db);
    endSession('You were signed out after being idle.');
  }
}, 30000);

function isConfidentialTxn(t) { return !!t && CONFIDENTIAL_SERVICES.includes(t.service); }
function isTxnLocked(t) { return isConfidentialTxn(t); }
function maskName(name) {
  const p = String(name || '').trim().split(/\s+/).filter(Boolean);
  return p.length < 2 ? (p[0] || '—') : `${p[0]} ${p[p.length - 1][0].toUpperCase()}.`;
}
function redactConfidentialTxn(t) {
  return { id: t.id, code: t.code, service: t.service, status: t.status, escalation: t.escalation || null, visitId: t.visitId || null, createdAt: t.createdAt, completedAt: t.completedAt || null, confidential: true };
}

const NAV = [
  { key: 'dashboard', label: 'Dashboard', ic: 'dashboard' },
  { key: 'reports', label: 'Reports', ic: 'chart' },
  { key: 'activitylog', label: 'Audit Trail', ic: 'log' },
  { key: 'users', label: 'Admin Management', ic: 'users' },
  { key: 'settings', label: 'System Settings', ic: 'gear' },
  { key: 'backup', label: 'Backup & Data', ic: 'download' },
  { key: 'profile', label: 'My Profile', ic: 'userc' },
];
const TITLES = {
  dashboard: ['Dashboard', "Overview of today's activity &mdash; view only"],
  reports: ['Reports', 'Printable system reports: audit activity, access and configuration'],
  activitylog: ['Audit Trail', 'Tracks user actions and changes'],
  users: ['Admin Management', 'Create and manage OSS Admin accounts &mdash; Super Admin only'],
  settings: ['System Settings', 'Office details, defaults & maintenance mode &mdash; Super Admin only'],
  backup: ['Backup & Data', 'Export system data and manage browser records &mdash; Super Admin only'],
  profile: ['My Profile', 'Manage your account details'],
};
document.getElementById('avatarInit').textContent = currentUser.fullName.split(' ').map(s => s[0]).slice(0, 2).join('');
document.getElementById('userNameLbl').textContent = currentUser.fullName;
document.getElementById('userRoleLbl').textContent = ROLES[currentUser.role].label;
function tickClock() { const d = new Date(), l = document.getElementById('clockLbl'); if (l) l.textContent = `${fmtDate(d)}  ${fmtTime(d)}`; }
setInterval(tickClock, 20000); tickClock();

const SIDEBAR_KEY = 'ossuniserve_sidebar_collapsed';
function toggleSidebar() {
  if (window.matchMedia('(min-width:881px)').matches) {
    const c = document.getElementById('app').classList.toggle('collapsed');
    localStorage.setItem(SIDEBAR_KEY, c ? '1' : '0');
  } else document.getElementById('sidebar').classList.toggle('open');
}
document.getElementById('app').classList.toggle('collapsed', localStorage.getItem(SIDEBAR_KEY) === '1');

let state_view = 'dashboard';
function renderSidebar() {
  document.getElementById('navList').innerHTML = NAV.map(n => `<li><button class="nav-item ${state_view === n.key ? 'active' : ''}" title="${n.label}" onclick="navigate('${n.key}')">${icon(n.ic)}<span>${n.label}</span></button></li>`).join('');
}
function navigate(key) {
  if (!TITLES[key]) key = 'dashboard';
  state_view = key;
  document.getElementById('pageTitle').textContent = TITLES[key][0];
  document.getElementById('pageSub').innerHTML = TITLES[key][1];
  renderSidebar();
  document.getElementById('sidebar').classList.remove('open');
  ({ dashboard: renderDashboard, reports: renderReports, activitylog: renderActivityLog, users: renderUsers, settings: renderSettings, backup: renderBackup, profile: renderProfile })[key]();
}
function statusPill(status) {
  const map = { Pending: 'pill-warn', Processing: 'pill-info', Approved: 'pill-ok', Completed: 'pill-ok', Rejected: 'pill-danger', Resolved: 'pill-ok', Open: 'pill-info', Closed: 'pill-danger' };
  return `<span class="pill ${map[status] || 'pill-info'}">${status}</span>`;
}
function escalationPill(status) {
  if (!status || status === 'Normal') return '';
  return `<span class="pill ${{ 'For Review': 'pill-warn', Escalated: 'pill-danger', Resolved: 'pill-ok' }[status] || 'pill-info'}">${escapeHtml(status)}</span>`;
}

function renderDashboard() {
  const db = loadDB();
  if (sweepNoShows(db)) saveDB(db);
  const t = today(), qs = queueStats(db);
  const todaysTxn = db.transactions.filter(x => fmtDate(x.createdAt) === t);
  const pending = db.transactions.filter(x => x.status === 'Pending').length;
  const recent = [...db.transactions].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  const lateToday = db.appointments.filter(a => a.date === t && a.arrivalStatus === 'Late').length;
  const noShowToday = db.appointments.filter(a => a.date === t && a.status === 'No-show').length;
  const openEsc = db.transactions.filter(x => x.escalation === 'Escalated' || x.escalation === 'For Review').length;
  const awaiting = db.appointments.filter(a => ['Booked', 'Requested'].includes(a.status)).length;
  const peaks = peakHourWindows(db);
  const admins = db.users.filter(u => u.role === 'ADMIN');
  const trendStart = daysAgo(13), trendTxns = db.transactions.filter(x => x.createdAt >= trendStart), trend = buildTrendBuckets(trendTxns, trendStart);
  const svcCounts = {}; db.services.forEach(s => svcCounts[s.key] = 0);
  db.transactions.forEach(x => { svcCounts[x.service] = (svcCounts[x.service] || 0) + 1; });
  const topServices = db.services.map(s => ({ label: s.label, count: svcCounts[s.key] || 0 })).sort((a, b) => b.count - a.count).slice(0, 6);
  const ORDER = ['Completed', 'Approved', 'Processing', 'Pending', 'Rejected'], sc = {}; ORDER.forEach(s => sc[s] = 0);
  db.transactions.forEach(x => { if (sc[x.status] !== undefined) sc[x.status]++; });

  document.getElementById('content').innerHTML = `
    <section class="dash-section"><h2 class="dash-h">Today at a glance</h2>
      <div class="stat-grid">
        <div class="stat-card"><div class="lbl">Today's Transactions</div><div class="val">${todaysTxn.length}</div></div>
        <div class="stat-card"><div class="lbl">Pending Requests</div><div class="val">${pending}</div></div>
        <div class="stat-card"><div class="lbl">Today's Appointments</div><div class="val">${db.appointments.filter(x => x.date === t).length}</div></div>
        <div class="stat-card"><div class="lbl">Open Escalations</div><div class="val">${openEsc}</div></div>
        <div class="stat-card"><div class="lbl">Late Appointments Today</div><div class="val">${lateToday}</div></div>
        <div class="stat-card"><div class="lbl">No-Shows Today</div><div class="val">${noShowToday}</div></div>
        <div class="stat-card"><div class="lbl">Completed Today</div><div class="val">${qs.completedToday}</div></div>
        <div class="stat-card"><div class="lbl">Peak Hour</div><div class="val val-list">${peaks.length ? `<span>${peaks[0]}</span>` : '&mdash;'}</div></div>
      </div></section>
    <section class="dash-section"><h2 class="dash-h">System</h2>
      <div class="stat-grid">
        <div class="stat-card"><div class="lbl">Admin Accounts</div><div class="val">${admins.filter(u => u.active).length}<span class="muted" style="font-size:1rem; font-weight:600;"> / ${admins.length}</span></div></div>
        <div class="stat-card"><div class="lbl">Confidential Access</div><div class="val">${admins.filter(u => u.confidentialAccess).length}<span class="muted" style="font-size:1rem; font-weight:600;"> / ${admins.length}</span></div></div>
        <div class="stat-card"><div class="lbl">Audit Entries</div><div class="val">${db.activityLog.length}</div></div>
        <div class="stat-card"><div class="lbl">Maintenance Mode</div><div class="val val-sm">${db.systemSettings.maintenanceMode ? 'On' : 'Off'}</div></div>
      </div></section>
    <section class="dash-section"><h2 class="dash-h">Live queue</h2>
      <div class="card"><div class="card-head"><div><h3>Queue Status</h3><div class="desc">Read-only &mdash; the queue is managed by OSS Admin</div></div></div>
        <div class="card-pad"><div class="stat-grid" style="margin-bottom:0;">
          <div class="stat-card"><div class="lbl">Currently Waiting</div><div class="val">${qs.waiting}</div></div>
          <div class="stat-card"><div class="lbl">Currently Serving</div><div class="val">${qs.serving}</div></div>
          <div class="stat-card"><div class="lbl">Next To Call</div><div class="val val-sm">${qs.next ? escapeHtml(queueRef(qs.next)) : '&mdash;'}</div></div>
          <div class="stat-card"><div class="lbl">Awaiting Check-In</div><div class="val">${awaiting}</div></div>
        </div></div></div></section>
    <section class="dash-section"><h2 class="dash-h">Activity</h2>
      <div class="grid-2">
        <div class="card"><div class="card-head"><div><h3>14-Day Transaction Trend</h3><div class="desc">Transactions logged per day, most recent two weeks</div></div></div>
          <div class="card-pad">${trendTxns.length ? svgLineChart({ labels: trend.labels, values: trend.values }, 'Transaction trend chart') : emptyChart('No transactions logged in the last 14 days.')}</div></div>
        <div class="card"><div class="card-head"><div><h3>Top Services</h3><div class="desc">All-time transaction volume</div></div></div>
          <div class="card-pad">${topServices.some(r => r.count) ? svgBarChart(topServices, { height: topServices.length * 30 + 20 }) : emptyChart('No transactions logged yet.')}</div></div>
      </div></section>
    <section class="dash-section"><h2 class="dash-h">Records</h2>
    <div class="grid-2">
      <div class="card"><div class="card-head"><div><h3>Recent Transactions</h3><div class="desc">View only &mdash; managed by OSS Admin</div></div></div>
        <div class="table-wrap"><table><thead><tr><th>#</th><th>Code</th><th>Requestor</th><th>Service</th><th>Status</th><th>Logged</th></tr></thead>
          <tbody>${recent.length ? recent.map((r, i) => { const conf = isConfidentialTxn(r); return `<tr><td class="row-num">${i + 1}</td><td class="mono">${r.code}${conf ? ` <span class="tag-lock">${icon('lock', 10)}</span>` : ''}</td><td>${escapeHtml(conf ? maskName(r.name) : r.name)}</td><td>${serviceLabel(db, r.service)}</td><td>${statusPill(r.status)} ${escalationPill(r.escalation)}</td><td class="muted">${fmtDate(r.createdAt)}<br>${fmtTime(r.createdAt)}</td></tr>`; }).join('') : `<tr class="empty-row"><td colspan="6">No transactions yet.</td></tr>`}</tbody></table></div></div>
      <div class="card"><div class="card-head"><div><h3>Status Mix</h3><div class="desc">All-time transaction status breakdown</div></div></div>
        <div class="card-pad">${db.transactions.length ? svgBarChart(ORDER.map(s => ({ label: s, count: sc[s] })), { height: ORDER.length * 30 + 20 }) : emptyChart('No transactions logged yet.')}</div></div>
    </div></section>
    <section class="dash-section"><h2 class="dash-h">Visitor feedback</h2>${feedbackDashboardHtml(db)}</section>`;
}

let reportPeriod = 'Daily';
function periodStart(p) { const d = new Date(); if (p === 'Daily') d.setHours(0, 0, 0, 0); else d.setDate(d.getDate() - ({ Weekly: 7, Monthly: 30 }[p] || 90)); return d; }
const categoryOf = e => e.category || inferCategory(e.action);
function reportChangesHtml(entry) {
  const changes=entry.changes||[];
  if(!changes.length)return '<p class="report-change-empty">No field changes recorded.</p>';
  const value=v=>escapeHtml(v===''||v==null?'Not set':String(v));
  return '<table class="report-diff-table"><colgroup><col style="width:34%"><col style="width:33%"><col style="width:33%"></colgroup><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>'+changes.map(change=>`<tr><th scope="row">${escapeHtml(change.field)}</th><td>${value(change.from)}</td><td>${value(change.to)}</td></tr>`).join('')+'</tbody></table>';
}
const changesText = e => (e.changes || []).map(c => `${c.field}: ${c.from === '' || c.from == null ? '(empty)' : c.from} → ${c.to === '' || c.to == null ? '(empty)' : c.to}`).join('; ');
function systemReportData(db) {
  const start = periodStart(reportPeriod);
  const entries = db.activityLog.filter(e => new Date(e.ts) >= start);
  const txt = e => auditActionLabel(e.action).toLowerCase();
  const byCat = AUDIT_CATEGORIES.map(c => ({ label: c, count: entries.filter(e => categoryOf(e) === c).length }));
  const logins = entries.filter(e => /^logged in/.test(txt(e)));
  const failed = entries.filter(e => /failed|blocked|wrong password|incorrect/.test(txt(e)));
  const accountEvents = entries.filter(e => ['Accounts', 'Confidential'].includes(categoryOf(e)));
  const confEvents = entries.filter(e => categoryOf(e) === 'Confidential');
  const settingsEvents = entries.filter(e => categoryOf(e) === 'Settings');
  const dataEvents = entries.filter(e => categoryOf(e) === 'Data');
  const configEvents = entries.filter(e => ['Settings', 'Data'].includes(categoryOf(e)));
  const sessions = {};
  entries.filter(e => categoryOf(e) === 'Authentication').forEach(e => {
    const rec = sessions[e.user] || (sessions[e.user] = { user: e.user, role: e.role, logins: 0, logouts: 0, timeouts: 0, last: null });
    if (/^logged in/.test(txt(e))) { rec.logins++; if (!rec.last) rec.last = e.ts; }
    else if (/^logged out/.test(txt(e))) rec.logouts++;
    else if (/timed out/.test(txt(e))) rec.timeouts++;
  });
  return { start, entries, byCat, logins, failed, accountEvents, confEvents, settingsEvents, dataEvents, configEvents, sessions: Object.values(sessions).sort((a, b) => b.logins - a.logins), integrity: auditIntegrity(db) };
}
function renderReports() {
  document.getElementById('content').innerHTML = `
    <div class="card card-pad no-print">
      <div class="subnav">${['Daily', 'Weekly', 'Monthly', 'Quarterly'].map((p, i) => `<button class="${i ? '' : 'active'}" onclick="setReportPeriod('${p}',this)">${p}</button>`).join('')}</div>
      <div style="display:flex; gap:10px; flex-wrap:wrap;"><button class="btn btn-primary btn-sm" onclick="printReport()">${icon('print', 14)} Print report</button><button class="btn btn-ghost btn-sm" onclick="downloadReportExcel()">${icon('download', 14)} Download Excel</button></div></div>
    <div class="card card-pad" id="reportSheet" style="margin-top:16px;">${reportLetterhead()}
      <div class="report-title-block"><h2 id="repTitle">Daily System Report</h2><div class="report-meta"><span id="repPeriodLbl"></span><span id="repGenLbl"></span></div></div>
      <div id="repBody"></div></div>`;
  reportPeriod = 'Daily';
  buildReport();
}
function setReportPeriod(p, el) { reportPeriod = p; document.querySelectorAll('.subnav button').forEach(b => b.classList.remove('active')); el.classList.add('active'); buildReport(); }
function printReport() {
  const sheet = document.getElementById('reportSheet');
  if (!sheet) return;
  printInjected(sheet.innerHTML);
  const db = loadDB();
  logActivity(db, currentUser, `Printed ${reportPeriod} system report`, { category: 'System' });
  saveDB(db);
}
function buildReport() {
  const db = loadDB(), d = systemReportData(db), s = db.systemSettings;
  document.getElementById('repTitle').textContent = `${reportPeriod} System Report`;
  document.getElementById('repPeriodLbl').textContent = `Period: ${fmtDate(d.start)} to ${today()}`;
  document.getElementById('repGenLbl').textContent = `Generated: ${actionText(fmtDateTime(new Date()))} by ${currentUser.fullName}`;
  const total = d.entries.length, pct = n => total ? Math.round(n / total * 100) : 0;
  const trend = buildTrendBuckets(d.entries.map(e => ({ createdAt: new Date(e.ts) })), d.start);
  const activeCats = d.byCat.filter(c => c.count).length;
  const admins = db.users.filter(u => u.role === 'ADMIN');
  const integrityTxt = d.integrity.bad.length ? `${d.integrity.bad.length} problem${d.integrity.bad.length === 1 ? '' : 's'} found` : 'Passed';
  const eventRows = list => list.map(e => `<article class="report-event"><div class="report-event-heading"><h4>${escapeHtml(auditActionLabel(e.action))}</h4><p>${escapeHtml(fmtDate(e.ts))} at ${escapeHtml(fmtTime(e.ts))} &middot; ${escapeHtml(e.user)}${e.target?' &middot; Record: '+escapeHtml(e.target):''}</p></div>${reportChangesHtml(e)}</article>`).join('');
  const eventTable=(list,emptyMsg)=>list.length ? '<div class="report-event-list">'+eventRows(list)+'</div>' : '<p class="rpt-desc">'+escapeHtml(emptyMsg)+'</p>';

  document.getElementById('repBody').innerHTML = `
    <div class="rpt-section"><h3 class="rpt-h">Executive Summary</h3>
      <div class="stat-grid rpt-stat-grid">
        <div class="rpt-stat"><div class="rpt-stat-lbl">Audit Entries</div><div class="rpt-stat-val">${total}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-lbl">Sign-ins</div><div class="rpt-stat-val">${d.logins.length}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-lbl">Failed / Blocked</div><div class="rpt-stat-val">${d.failed.length}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-lbl">Account Changes</div><div class="rpt-stat-val">${d.accountEvents.length}</div></div></div>
      <div class="stat-grid rpt-stat-grid">
        <div class="rpt-stat"><div class="rpt-stat-lbl">Confidential Events</div><div class="rpt-stat-val">${d.confEvents.length}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-lbl">Settings Changes</div><div class="rpt-stat-val">${d.settingsEvents.length}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-lbl">Exports &amp; Resets</div><div class="rpt-stat-val">${d.dataEvents.length}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-lbl">Audit Integrity</div><div class="rpt-stat-val" style="font-size:1.1rem;">${integrityTxt}</div></div></div>
      <p class="rpt-narrative">During the period ${fmtDate(d.start)} to ${today()}, the system recorded <strong>${total}</strong> audit entr${total === 1 ? 'y' : 'ies'} across ${activeCats} categor${activeCats === 1 ? 'y' : 'ies'}. There ${d.logins.length === 1 ? 'was' : 'were'} <strong>${d.logins.length}</strong> sign-in${d.logins.length === 1 ? '' : 's'} by ${d.sessions.length} account${d.sessions.length === 1 ? '' : 's'} and <strong>${d.failed.length}</strong> failed or blocked attempt${d.failed.length === 1 ? '' : 's'}. <strong>${d.accountEvents.length}</strong> account or access change${d.accountEvents.length === 1 ? ' was' : 's were'} recorded, including ${d.confEvents.length} Confidential-access event${d.confEvents.length === 1 ? '' : 's'}, and <strong>${d.settingsEvents.length}</strong> settings change${d.settingsEvents.length === 1 ? '' : 's'}. The audit trail integrity check ${d.integrity.bad.length ? `found ${d.integrity.bad.length} problem${d.integrity.bad.length === 1 ? '' : 's'}` : 'passed with no tampering detected'}.</p></div>
    <div class="rpt-section"><h3 class="rpt-h">Audit Activity Trend</h3><div class="rpt-desc">Audit entries recorded per ${trend.unit} over the reporting period</div>${svgLineChart(trend, 'Audit activity trend chart')}</div>
    <div class="rpt-section"><h3 class="rpt-h">Activity by Category</h3><div class="rpt-grid-2"><div>${svgBarChart(d.byCat, { height: d.byCat.length * 26 + 20 })}</div>
      <div class="rpt-table-wrap"><table class="rpt-table"><colgroup><col style="width:60%"><col style="width:20%"><col style="width:20%"></colgroup><thead><tr><th>Category</th><th>Count</th><th>%</th></tr></thead>
        <tbody>${d.byCat.map(r => `<tr><td>${r.label}</td><td>${r.count}</td><td>${pct(r.count)}%</td></tr>`).join('')}<tr class="rpt-total-row"><td>Total</td><td>${total}</td><td>${total ? '100%' : '0%'}</td></tr></tbody></table></div></div></div>
    <div class="rpt-section"><h3 class="rpt-h">Sign-in Activity by Account</h3>
      <div class="rpt-table-wrap"><table class="rpt-table"><colgroup><col style="width:28%"><col style="width:16%"><col style="width:11%"><col style="width:11%"><col style="width:12%"><col style="width:22%"></colgroup>
        <thead><tr><th>Account</th><th>Role</th><th>Sign-ins</th><th>Sign-outs</th><th>Idle timeouts</th><th>Last sign-in</th></tr></thead>
        <tbody>${d.sessions.length ? d.sessions.map(r => `<tr><td>${escapeHtml(r.user)}</td><td>${escapeHtml(ROLES[r.role]?.label || r.role)}</td><td>${r.logins}</td><td>${r.logouts}</td><td>${r.timeouts}</td><td class="mono nw">${r.last ? `${fmtDate(r.last)}<br>${fmtTime(r.last)}` : '—'}</td></tr>`).join('') : '<tr class="empty-row"><td colspan="6">No sign-in activity in this period.</td></tr>'}</tbody></table></div></div>
    <div class="rpt-section"><h3 class="rpt-h">Account &amp; Access Changes</h3><div class="rpt-desc">${d.accountEvents.length} event${d.accountEvents.length === 1 ? '' : 's'} &mdash; account changes and Confidential-access grants, removals and unlocks</div>${eventTable(d.accountEvents, 'No account or access changes in this period.')}</div>
    <div class="rpt-section"><h3 class="rpt-h">Settings, Exports &amp; Resets</h3><div class="rpt-desc">${d.configEvents.length} event${d.configEvents.length === 1 ? '' : 's'}</div>${eventTable(d.configEvents, 'No settings changes, exports or resets in this period.')}</div>
    <div class="rpt-section"><h3 class="rpt-h">Other Audit Activity</h3><div class="rpt-desc">Sign-ins, queue, appointment, messaging, and other events within the selected period.</div>${eventTable(d.entries.filter(e=>!['Accounts','Confidential','Settings','Data'].includes(categoryOf(e))), 'No other activity in this period.')}</div>
    <div class="rpt-section"><h3 class="rpt-h">Admin Accounts</h3><div class="rpt-desc">Current accounts at the time of printing</div>
      <div class="rpt-table-wrap"><table class="rpt-table"><colgroup><col style="width:22%"><col style="width:16%"><col style="width:26%"><col style="width:12%"><col style="width:12%"><col style="width:12%"></colgroup>
        <thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Role</th><th>Status</th><th>Confidential</th></tr></thead>
        <tbody>${db.users.map(u => `<tr><td>${escapeHtml(u.fullName)}</td><td class="mono">${escapeHtml(u.username)}</td><td>${escapeHtml(u.email || '—')}</td><td>${ROLES[u.role].label}</td><td>${u.active ? 'Active' : 'Disabled'}</td><td>${u.role === 'ADMIN' ? (u.confidentialAccess ? 'Authorized' : 'No access') : 'N/A'}</td></tr>`).join('')}</tbody></table></div>
      <p class="rpt-desc" style="margin-top:8px;">${admins.filter(u => u.confidentialAccess).length} of ${admins.length} Admin${admins.length === 1 ? '' : 's'} authorized to open confidential records.</p></div>
    <div class="rpt-section"><h3 class="rpt-h">System Configuration</h3><div class="rpt-desc">Current settings at the time of printing</div>
      <table class="doc-form-table"><colgroup><col style="width:34%"><col style="width:66%"></colgroup>
        <tr><th>Organization</th><td>${escapeHtml(s.orgName)}</td></tr>
        <tr><th>Support email / phone</th><td>${escapeHtml(s.supportEmail || '—')} / ${escapeHtml(s.supportPhone || '—')}</td></tr>
        <tr><th>Queue prefixes</th><td>Student ${escapeHtml(s.queuePrefixStudent)}, Guest ${escapeHtml(s.queuePrefixGuest)}</td></tr>
        <tr><th>Grace period / No-show threshold</th><td>${graceMinutes(db)} min / ${noShowMinutes(db)} min</td></tr>
        <tr><th>Session timeout</th><td>${Number(s.sessionTimeout) || 30} min</td></tr>
        <tr><th>Maintenance mode</th><td>${s.maintenanceMode ? 'On' : 'Off'}</td></tr></table></div>
    <div class="rpt-section"><h3 class="rpt-h">Audit Trail Integrity</h3>
      <table class="doc-form-table"><colgroup><col style="width:34%"><col style="width:66%"></colgroup>
        <tr><th>Entries checked</th><td>${d.integrity.total - d.integrity.unsealed} of ${d.integrity.total}</td></tr>
        <tr><th>Not yet sealed</th><td>${d.integrity.unsealed}</td></tr>
        <tr><th>Result</th><td>${d.integrity.bad.length ? `${d.integrity.bad.length} problem${d.integrity.bad.length === 1 ? '' : 's'} found` : 'No tampering detected'}</td></tr></table></div>
    ${reportSignatureBlock()}`;
}
function downloadReportExcel() {
  const db = loadDB(), d = systemReportData(db), s = db.systemSettings;
  const trend=buildTrendBuckets(d.entries.map(e=>({createdAt:new Date(e.ts)})),d.start);
  const display=value=>value===''||value==null?'Not set':String(value);
  const events=d.entries.flatMap(e=>{
    const changes=e.changes?.length?e.changes:[null];
    return changes.map(change=>[e.id||'',fmtDate(e.ts),fmtTime(e.ts),e.user,ROLES[e.role]?.label||e.role,categoryOf(e),auditActionLabel(e.action),e.target||'',change?.field||'',change?display(change.from):'',change?display(change.to):'']);
  });
  const exportReport=(filename,rows)=>{
    {
      const headers=new Set(['Summary','Audit Activity Trend','Activity by Category','Sign-in Activity by Account','Detailed Audit Events','Admin Accounts','System Configuration','Audit Trail Integrity','Event ID','Name','Account','Category','Period']);
      const headingRows=rows.flatMap((row,index)=>index===0||headers.has(row[0])?[index]:[]);
      SpreadsheetExport.download(filename,rows,[36,24,22,26,18,22,36,26,28,38,38],{sheetName:'System Report',headingRows,filter:false});
    }
  };
  exportReport(`OSS_${reportPeriod}_System_Report_${today()}.xlsx`, [
    ['Polytechnic University of the Philippines - Santa Maria Campus'], ['Office of Student Services'], [`${reportPeriod} System Report`], [`Period: ${fmtDate(d.start)} to ${today()}`],
    [`Generated: ${actionText(fmtDateTime(new Date()))} by ${currentUser.fullName}`], [],
    ['Summary'], ['Audit entries', d.entries.length], ['Sign-ins', d.logins.length], ['Failed or blocked attempts', d.failed.length], ['Account and access changes', d.accountEvents.length],
    ['Confidential events', d.confEvents.length], ['Settings changes', d.settingsEvents.length], ['Exports and resets', d.dataEvents.length], ['Audit integrity', d.integrity.bad.length ? `${d.integrity.bad.length} problem(s)` : 'Passed'], [],
    ['Audit Activity Trend'], ['Period', 'Audit entries'], ...trend.labels.map((label,i)=>[label,trend.values[i]]), [],
    ['Activity by Category'], ['Category', 'Count', 'Percentage'], ...d.byCat.map(c => [c.label, c.count, d.entries.length?Math.round(c.count/d.entries.length*100)+'%':'0%']), [],
    ['Sign-in Activity by Account'], ['Account','Role','Sign-ins','Sign-outs','Idle timeouts','Last sign-in'], ...d.sessions.map(account=>[account.user,ROLES[account.role]?.label||account.role,account.logins,account.logouts,account.timeouts,account.last?fmtDateTime(account.last):'']), [],
    ['Detailed Audit Events'], ['Event ID','Date','Time','Account','Role','Category','Action','Record','Field','Before','After'], ...events, [],
    ['Admin Accounts'], ['Name', 'Username', 'Email', 'Role', 'Status', 'Confidential access'],
    ...db.users.map(u => [u.fullName, u.username, u.email || '', ROLES[u.role].label, u.active ? 'Active' : 'Disabled', u.role === 'ADMIN' ? (u.confidentialAccess ? 'Authorized' : 'No access') : 'N/A']), [],
    ['System Configuration'], ['Organization', s.orgName], ['Support email',s.supportEmail||''], ['Support phone',s.supportPhone||''], ['Student queue prefix',s.queuePrefixStudent], ['Guest queue prefix',s.queuePrefixGuest], ['Grace period (min)', graceMinutes(db)], ['No-show threshold (min)', noShowMinutes(db)], ['Session timeout (min)', Number(s.sessionTimeout) || 30], ['Maintenance mode', s.maintenanceMode ? 'On' : 'Off'], [],
    ['Audit Trail Integrity'], ['Entries checked',d.integrity.total-d.integrity.unsealed], ['Total entries',d.integrity.total], ['Not yet sealed',d.integrity.unsealed], ['Problems found',d.integrity.bad.length],
  ]);
  logActivity(db, currentUser, `Downloaded ${reportPeriod} system report`, { category: 'Data' });
  saveDB(db);
  toast('Report downloaded.', 'ok');
}

const RANGES = { audit: { from: '', to: '' } };
function rangeLabel(r) { return !r.from && !r.to ? 'All recorded dates' : (r.from === r.to ? r.from : `${r.from || 'start'} to ${r.to || 'today'}`); }
function dateRangeHtml(which) {
  const r = RANGES[which];
  const active = (r.from || r.to) ? ' is-set' : '';
  return `<div class="date-range${active}" role="group" aria-label="Date range">
    <span class="dr-ic">${icon('calendar', 15)}</span>
    <label class="dr-field"><span>From</span><input type="date" class="date-in" value="${r.from}" max="${r.to || ''}" aria-label="From date" onchange="setRange('${which}','from',this.value)"></label>
    <span class="dr-sep" aria-hidden="true">&ndash;</span>
    <label class="dr-field"><span>To</span><input type="date" class="date-in" value="${r.to}" min="${r.from || ''}" aria-label="To date" onchange="setRange('${which}','to',this.value)"></label>
    <span class="dr-actions"><button type="button" class="dr-btn" onclick="setRange('${which}','today')">Today</button><button type="button" class="dr-btn" onclick="setRange('${which}','all')">All dates</button></span></div>`;
}
function setRange(which, k, v) {
  const r = RANGES[which];
  if (k === 'all') { r.from = ''; r.to = ''; } else if (k === 'today') { r.from = r.to = today(); } else r[k] = v;
  if (r.from && r.to && r.from > r.to) { if (k === 'from') r.to = r.from; else r.from = r.to; }
  auditState.page = 1;
  renderActivityLog();
}

let auditState = { q: '', cat: '', user: '', page: 1 };
const AUDIT_PAGE_SIZE = 25;
let auditRowsCache = [];
function auditFiltered(db) {
  const q = auditState.q.toLowerCase(), r = RANGES.audit;
  const from = r.from ? new Date(r.from + 'T00:00:00') : null, to = r.to ? new Date(r.to + 'T23:59:59') : null;
  return db.activityLog.filter(e => {
    if (auditState.cat && categoryOf(e) !== auditState.cat) return false;
    if (auditState.user && e.user !== auditState.user) return false;
    if (from && new Date(e.ts) < from) return false;
    if (to && new Date(e.ts) > to) return false;
    if (q) {
      const hay = [e.user, auditActionLabel(e.action), e.target || '', ...(e.changes || []).map(c => `${c.field} ${c.from} ${c.to}`)].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
function renderActivityLog() {
  const db = loadDB(), users = [...new Set(db.activityLog.map(r => r.user))].sort();
  document.getElementById('content').innerHTML = `
    <div class="card">
      <div class="card-head"><div><h3>Audit Trail <span class="badge-role">${icon('lock', 12)} Super Admin</span></h3><div class="desc" id="auditCount"></div></div>
        <div class="toolbar"><button class="btn btn-ghost btn-sm" onclick="verifyAuditIntegrity()">${icon('check', 14)} Verify integrity</button><button class="btn btn-primary btn-sm" onclick="printAuditReport()">${icon('print', 14)} Print report</button><button class="btn btn-ghost btn-sm" onclick="exportAuditExcel()">${icon('download', 14)} Download Excel</button></div></div>
      <div class="filter-bar">${dateRangeHtml('audit')}
        <select class="filter-select" aria-label="Category" onchange="auditState.cat=this.value;auditState.page=1;renderLogTable()"><option value="">All categories</option>${AUDIT_CATEGORIES.map(c => `<option ${auditState.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
        <select class="filter-select" aria-label="User" onchange="auditState.user=this.value;auditState.page=1;renderLogTable()"><option value="">All users</option>${users.map(u => `<option ${auditState.user === u ? 'selected' : ''}>${escapeHtml(u)}</option>`).join('')}</select>
        <div class="search-box">${icon('search', 15)}<input id="auditQ" placeholder="Search user, action, target, Visit ID" value="${escapeHtml(auditState.q)}" oninput="auditState.q=this.value;auditState.page=1;renderLogTable()"></div></div>
      <div class="table-wrap"><table><thead><tr><th>Timestamp</th><th>User</th><th>Category</th><th>Action</th><th>Details</th></tr></thead><tbody id="logBody"></tbody></table></div>
      <div class="audit-pager" id="auditPager"></div>
    </div>`;
  renderLogTable();
}
function auditCatPill(cat) {
  const map = { Confidential: 'pill-danger', Authentication: 'pill-info', Accounts: 'pill-gold', Settings: 'pill-warn', Data: 'pill-ok', Transactions: 'pill-info', Queue: 'pill-info', Appointments: 'pill-info', System: 'pill-danger' };
  return `<span class="pill ${map[cat] || 'pill-info'}">${cat === 'Confidential' ? icon('lock', 11) + ' ' : ''}${escapeHtml(cat)}</span>`;
}
function auditDetailsHtml(r) {
  const parts = [];
  if (r.target && /^(VIS-|OSS-)/.test(r.target)) parts.push(`<div class="audit-record-ref">Visit / record: <span class="mono">${escapeHtml(r.target)}</span></div>`);
  (r.changes||[]).forEach(c=>{
    const from=c.from==null?'':String(c.from),to=c.to==null?'':String(c.to);
    if(/^[\[{]/.test(from)||/^[\[{]/.test(to))parts.push(`<details class="audit-extra"><summary>${escapeHtml(c.field)}</summary><div>Before: ${escapeHtml(from||'Not set')}</div><div>After: ${escapeHtml(to||'Not set')}</div></details>`);
    else parts.push(`<div class="chg"><b>${escapeHtml(c.field)}</b>: ${from?escapeHtml(from)+' &rarr; ':''}${escapeHtml(to||'Not set')}</div>`);
  });
  if(r.target && !/^(VIS-|OSS-|\/?api\/)/.test(r.target))parts.push(`<div class="muted">Record: ${escapeHtml(r.target)}</div>`);
  return parts.join('') || '<span class="muted">&mdash;</span>';
}
function auditActionLabel(value){
  const raw=actionText(value);
  const sync=/^Imported (\d+) legacy browser records$/i.exec(raw);
  if(sync)return Number(sync[1])?'Saved records synchronized ('+sync[1]+')':'Saved records checked';
  if(/^Denied (GET|POST|PUT|PATCH|DELETE) /.test(raw))return 'Access denied';
  const match=/^(GET|POST|PUT|PATCH|DELETE)\s+(?:\/)?api\/([^\s]+)/.exec(raw);if(!match)return raw;
  const method=match[1],path=match[2];
  if(path==='login')return 'Signed in';if(path==='logout')return 'Signed out';
  if(path==='password')return 'Password changed';if(path==='profile')return 'Profile updated';
  if(path==='visits'&&method==='POST')return 'Walk-in registered';
  if(path.endsWith('/feedback'))return 'Visitor feedback submitted';
  if(path.endsWith('/check-in'))return 'Appointment checked in';
  if(path.endsWith('/cancel'))return 'Visit cancelled';
  if(path==='queue/call-next')return 'Next visitor called';
  if(path.startsWith('queue/')){const status=/(Waiting|Called|Serving|Skipped|Completed|Cancelled)\s*$/.exec(raw)?.[1];return ({Waiting:'Visitor returned to waiting',Called:'Visitor called',Serving:'Service started',Skipped:'Visitor skipped',Completed:'Service completed',Cancelled:'Visit cancelled'})[status]||'Queue entry updated';}
  if(path==='appointments')return 'Appointment requested';if(path.startsWith('appointments/'))return 'Appointment schedule updated';
  if(path.startsWith('admins'))return method==='POST'?'Admin account created':method==='DELETE'?'Admin account removed':'Admin account updated';
  if(path==='calendar')return 'Office calendar updated';if(path==='settings')return 'System settings updated';
  if(path.startsWith('services'))return method==='DELETE'?'Service removed':'Service updated';
  if(path.startsWith('service-records'))return 'Transaction updated';
  if(path.startsWith('chats'))return method==='DELETE'?'Conversation deleted':path.endsWith('/messages')?'Message sent':path.endsWith('/read')?'Conversation marked as read':method==='POST'?'Conversation started':'Conversation updated';
  if(path.startsWith('confidential'))return path.endsWith('/unlock')?'Confidential record unlocked':path.startsWith('confidential/requests')?'Confidential access request updated':'Confidential case updated';
  if(path.startsWith('notifications'))return method==='DELETE'?'Pending emails cancelled':'Appointment email queued';
  if(path==='import-browser')return 'Saved records synchronized';
  return 'Record updated';
}
function renderLogTable() {
  const db = loadDB();
  auditRowsCache = auditFiltered(db);
  const total = auditRowsCache.length, pages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE));
  auditState.page = Math.min(auditState.page, pages);
  const slice = auditRowsCache.slice((auditState.page - 1) * AUDIT_PAGE_SIZE, auditState.page * AUDIT_PAGE_SIZE);
  document.getElementById('auditCount').textContent = `${total} of ${db.activityLog.length} entries`;
  document.getElementById('logBody').innerHTML = slice.length ? slice.map(r => `<tr>
    <td class="muted mono nw">${fmtDateTime(r.ts)}</td>
    <td>${escapeHtml(r.user)}<div class="muted" style="font-size:.72rem;">${escapeHtml(ROLES[r.role]?.label || r.role)}</div></td>
    <td>${auditCatPill(categoryOf(r))}</td><td>${escapeHtml(auditActionLabel(r.action))}</td><td>${auditDetailsHtml(r)}</td></tr>`).join('')
    : `<tr class="empty-row"><td colspan="5">No matching audit entries.</td></tr>`;
  document.getElementById('auditPager').innerHTML = `
    <p class="audit-pagination-info">Page <b>${auditState.page}</b> of ${pages}<span>${total} records</span></p>
    <nav class="audit-pagination-buttons" aria-label="Audit pages"><button class="btn btn-ghost btn-sm" ${auditState.page <= 1 ? 'disabled' : ''} onclick="auditState.page--;renderLogTable()">Previous</button>
    <button class="btn btn-ghost btn-sm" ${auditState.page >= pages ? 'disabled' : ''} onclick="auditState.page++;renderLogTable()">Next</button></nav>`;
}
function verifyAuditIntegrity() {
  const db = loadDB(), r = auditIntegrity(db), bad = r.bad;
  logActivity(db, currentUser, `Verified audit trail integrity (${bad.length ? bad.length + ' problem(s)' : 'no problems'})`, { category: 'System' });
  saveDB(db);
  openModal('Audit Integrity Check', `
    <div class="alert-banner ${bad.length ? 'danger' : 'warn'}" style="${bad.length ? '' : 'background:var(--ok-bg);color:var(--ok);border-color:var(--ok);'}"><div><b>${bad.length ? `${bad.length} problem${bad.length === 1 ? '' : 's'} found` : 'No tampering detected'}</b>${r.total - r.unsealed} of ${r.total} entries checked${r.unsealed ? `; ${r.unsealed} older entr${r.unsealed === 1 ? 'y has' : 'ies have'} no seal yet and will be sealed on the next recorded action` : ''}.</div></div>
    ${bad.slice(0, 20).map(([e, why]) => `<div class="kv"><span class="mono">${fmtDateTime(e.ts)}</span><span>${escapeHtml(e.user)}: ${escapeHtml(auditActionLabel(e.action))}<div class="muted" style="font-size:.74rem;">${why}</div></span></div>`).join('')}
    <p class="field-hint" style="margin-top:12px;">This is a tamper-evident checksum kept in the browser. It shows that the log was altered, but it is not a substitute for a server-side log.</p>`, []);
}
function exportAuditExcel() {
  const rows = [['Timestamp', 'User', 'Role', 'Category', 'Action', 'Target', 'Changes']];
  auditRowsCache.forEach(r => rows.push([`${fmtDate(r.ts)} ${fmtTime(r.ts)}`, r.user, ROLES[r.role]?.label || r.role, categoryOf(r), auditActionLabel(r.action), r.target || '', changesText(r)]));
  SpreadsheetExport.download(`oss-audit-trail-${today()}.xlsx`,rows,[24,24,18,18,36,24,60]);
  const db = loadDB();
  logActivity(db, currentUser, `Exported audit trail (${auditRowsCache.length} entries)`, { category: 'Data' });
  saveDB(db);
  toast('Audit trail exported.', 'ok');
}
function printAuditReport() {
  const db = loadDB(), rows = auditFiltered(db), total = rows.length;
  if (!total) { toast('There are no audit entries to print for these filters.', 'err'); return; }
  const people = new Set(rows.map(r => r.user)).size, cats = new Set(rows.map(categoryOf)).size;
  const first = rows[rows.length - 1], last = rows[0];
  const filters = [
    ['Date range', rangeLabel(RANGES.audit)],
    ['Category', auditState.cat || 'All categories'],
    ['User', auditState.user || 'All users'],
    ['Search', auditState.q || 'None'],
  ];
  printInjected(`${reportLetterhead()}
    <div class="report-title-block"><h2>Audit Trail Report</h2><div class="report-meta"><span>Entries: ${total}</span><span>Generated: ${actionText(fmtDateTime(new Date()))} by ${escapeHtml(currentUser.fullName)}</span></div></div>
    <div class="rpt-section"><h3 class="rpt-h">Summary</h3><div class="stat-grid rpt-stat-grid">
      <div class="rpt-stat"><div class="rpt-stat-lbl">Entries</div><div class="rpt-stat-val">${total}</div></div>
      <div class="rpt-stat"><div class="rpt-stat-lbl">Accounts</div><div class="rpt-stat-val">${people}</div></div>
      <div class="rpt-stat"><div class="rpt-stat-lbl">Categories</div><div class="rpt-stat-val">${cats}</div></div>
      <div class="rpt-stat"><div class="rpt-stat-lbl">Coverage</div><div class="rpt-stat-val" style="font-size:.95rem;">${fmtDate(first.ts)}<br>to ${fmtDate(last.ts)}</div></div></div>
      <table class="doc-form-table"><caption>Filters applied</caption><colgroup><col style="width:28%"><col style="width:72%"></colgroup>
        ${filters.map(([l, v]) => `<tr><th>${l}</th><td>${escapeHtml(v)}</td></tr>`).join('')}</table></div>
    <div class="rpt-section"><h3 class="rpt-h">Audit Entries</h3><div class="rpt-desc">${total} entr${total === 1 ? 'y' : 'ies'}, newest first</div>
      <div class="rpt-table-wrap"><table class="rpt-table"><colgroup><col style="width:4%"><col style="width:12%"><col style="width:13%"><col style="width:11%"><col style="width:27%"><col style="width:11%"><col style="width:22%"></colgroup>
        <thead><tr><th>#</th><th>Timestamp</th><th>User</th><th>Category</th><th>Action</th><th>Target</th><th>Changes</th></tr></thead>
        <tbody>${rows.map((r, i) => `<tr><td>${i + 1}</td><td class="mono nw">${fmtDate(r.ts)}<br>${fmtTime(r.ts)}</td><td>${escapeHtml(r.user)}<br>${escapeHtml(ROLES[r.role]?.label || r.role)}</td><td>${escapeHtml(categoryOf(r))}</td><td>${escapeHtml(auditActionLabel(r.action))}</td><td class="mono">${escapeHtml(r.target || '—')}</td><td>${(r.changes||[]).length ? (r.changes||[]).length+' field change'+((r.changes||[]).length===1?'':'s') : 'No field changes'}</td></tr>${(r.changes||[]).length?`<tr class="report-change-detail"><td colspan="7">${reportChangesHtml(r)}</td></tr>`:''}`).join('')}</tbody></table></div></div>
    ${reportSignatureBlock()}
    <p class="doc-footnote">This report was generated by the OSS UniServe system.</p>`);
  logActivity(db, currentUser, `Printed audit trail report (${total} entr${total === 1 ? 'y' : 'ies'})`, { category: 'System' });
  saveDB(db);
}

function closeKebabs() { document.querySelectorAll('.kebab-menu').forEach(m => { m.hidden = true; }); }
function toggleKebab(ev, id) {
  ev.stopPropagation();
  const menu = document.getElementById('kebab_' + id), wasOpen = !!menu && !menu.hidden;
  closeKebabs();
  if (!menu || wasOpen) return;
  menu.hidden = false;
  const b = ev.currentTarget.getBoundingClientRect(), h = menu.offsetHeight, w = menu.offsetWidth;
  menu.style.left = Math.max(8, b.right - w) + 'px';
  menu.style.top = (b.bottom + h + 8 > window.innerHeight ? Math.max(8, b.top - h - 4) : b.bottom + 4) + 'px';
}
document.addEventListener('click', closeKebabs);
window.addEventListener('scroll', closeKebabs, true);
window.addEventListener('resize', closeKebabs);

// Admin Management is implemented in admin-management.js.

function renderSettings() {
  const s = loadDB().systemSettings;
  document.getElementById('content').innerHTML = `
    <div class="card">
      <div class="settings-block"><h4>Office Details</h4><div class="desc-txt">Shown on the landing page and the visitor portal contact details.</div>
        <div class="field"><label>Organization Name</label><input id="stOrg" value="${escapeHtml(s.orgName)}"></div>
        <div class="form-row"><div class="field"><label>Support Email</label><input id="stEmail" value="${escapeHtml(s.supportEmail)}"></div><div class="field"><label>Support Phone</label><input id="stPhone" value="${escapeHtml(s.supportPhone)}"></div></div></div>
      <div class="settings-block"><h4>Queue Numbers</h4><div class="desc-txt">Prefixes for walk-in queue numbers. Scheduled appointments get no queue number &mdash; they are identified by their Visit ID.</div>
        <div class="form-row"><div class="field"><label>Student Prefix</label><input id="stQPrefixStudent" maxlength="2" value="${escapeHtml(s.queuePrefixStudent || 'A')}"></div><div class="field"><label>Guest Prefix</label><input id="stQPrefixGuest" maxlength="2" value="${escapeHtml(s.queuePrefixGuest || 'G')}"></div></div></div>
      <div class="settings-block"><h4>Appointment Policy</h4><div class="desc-txt">A scheduled visitor is called when their time arrives. Staff reviews late arrivals. Unchecked appointments become No-show after the threshold; staff can reschedule the same request without re-entering details.</div>
        <div class="form-row"><div class="field"><label>Grace Period (minutes)</label><input id="stGraceMin" type="number" min="0" max="180" value="${s.gracePeriodMinutes ?? DEFAULT_GRACE_MINUTES}"></div><div class="field"><label>No-Show Threshold (minutes)</label><input id="stNoShowMin" type="number" min="5" max="480" value="${s.noShowThresholdMinutes ?? DEFAULT_NOSHOW_MINUTES}"></div></div>
        <div class="field-hint">Example: with a 15-minute grace period and a 60-minute threshold, a 10:00 AM appointment is On Time until 10:15, Late from 10:16&ndash;11:00, and automatically No-show after 11:00.</div></div>
      <div class="settings-block"><h4>Service capacity</h4><div class="field"><label for="stSlotCapacity">Appointments per time slot</label><input id="stSlotCapacity" type="number" min="1" max="20" value="${s.appointmentSlotCapacity??1}"><p class="field-hint">Default: one appointment at each date and time. Increase only when staff can handle the additional bookings.</p></div><div class="switch-row"><div><div class="lbl">Allow parallel service</div><div class="sub">Let each Admin call or serve multiple visitors at once. Off by default.</div></div><label class="switch"><input id="stParallel" type="checkbox" ${s.allowParallelService?'checked':''}><span class="track"></span></label></div></div>
      <div class="settings-block"><h4>Session</h4><div class="desc-txt">Admin and Super Admin sessions end automatically after this many idle minutes.</div>
        <div class="field"><label>Session Timeout (minutes)</label><input id="stTimeout" type="number" min="5" max="120" value="${Number(s.sessionTimeout) || 30}"></div></div>
      <div class="settings-block"><h4>System Maintenance</h4><div class="desc-txt">Temporarily restrict visitor-facing access while the office performs maintenance.</div>
        <div class="switch-row"><div><div class="lbl">Maintenance Mode</div><div class="sub">New visits can't be started in the Visitor Portal; checking an existing visit and staff login stay available</div></div><label class="switch"><input type="checkbox" id="stMaint" ${s.maintenanceMode ? 'checked' : ''}><span class="track"></span></label></div></div>
      <div class="modal-foot" style="border-top:1px solid var(--border);"><button class="btn btn-primary" onclick="saveSettings()">Save Settings</button></div>
    </div>`;
}
function saveSettings() {
  const db = loadDB(), s = db.systemSettings, before = { ...s }, v = id => document.getElementById(id).value;
  s.orgName = v('stOrg').trim() || s.orgName; s.supportEmail = v('stEmail').trim(); s.supportPhone = v('stPhone').trim();
  s.sessionTimeout = Math.max(5, Number(v('stTimeout')) || 30);
  s.maintenanceMode = document.getElementById('stMaint').checked;
  s.queuePrefixStudent = (v('stQPrefixStudent').trim() || 'A').toUpperCase().slice(0, 2); s.queuePrefixGuest = (v('stQPrefixGuest').trim() || 'G').toUpperCase().slice(0, 2);
  const grace = Number(v('stGraceMin')), noShow = Number(v('stNoShowMin'));
  s.gracePeriodMinutes = Number.isFinite(grace) && grace >= 0 ? grace : DEFAULT_GRACE_MINUTES;
  s.noShowThresholdMinutes = Number.isFinite(noShow) && noShow > s.gracePeriodMinutes ? noShow : Math.max(DEFAULT_NOSHOW_MINUTES, s.gracePeriodMinutes + 15);
  const view = o => ({ ...o, maintenanceMode: o.maintenanceMode ? 'On' : 'Off' });
  logActivity(db, currentUser, 'Updated system settings', { category: 'Settings', changes: diffFields(view(before), view(s), { orgName: 'Organization name', supportEmail: 'Support email', supportPhone: 'Support phone', sessionTimeout: 'Session timeout (min)', maintenanceMode: 'Maintenance mode', queuePrefixStudent: 'Student prefix', queuePrefixGuest: 'Guest prefix', gracePeriodMinutes: 'Grace period (min)', noShowThresholdMinutes: 'No-show threshold (min)' }) });
  saveDB(db); toast('System settings saved.', 'ok'); renderSettings();
}

function renderBackup() {
  const db = loadDB(), confCount = db.transactions.filter(isConfidentialTxn).length;
  const kv = (l, n) => `<div class="kv"><span>${l}</span><span>${n}</span></div>`;
  document.getElementById('content').innerHTML = `
    <div class="card backup-page">
      <div class="settings-block backup-export-block"><h4>Export Data</h4><div class="desc-txt">Download an encrypted backup of backend records. Keep the application key separately in a secure place; it is required to restore this backup.</div>
        <button class="btn btn-primary btn-sm backup-action" onclick="exportAllData()">Download backup (.json)</button></div>
      <div class="settings-block backup-restore-block"><h4>Restore Backup</h4><div class="desc-txt">Choose an encrypted UniServe backup to preview before restoring. It must use this server’s application key.</div><div class="backup-file-picker"><button type="button" id="restoreBackupChoose" class="btn btn-primary btn-sm backup-action" onclick="document.getElementById('restoreBackupFile').click()">Choose backup</button><span id="restoreBackupName" class="backup-file-name">JSON files only · Up to 30 MB</span><input id="restoreBackupFile" type="file" accept=".json,application/json" onchange="previewBackupFile(this)" hidden></div><p id="restoreBackupStatus" class="field-hint" role="status" aria-live="polite"></p></div>
      <div class="settings-block"><h4>Storage Summary</h4><div class="desc-txt">This summary covers records cached or stored in this browser. Shared queue records, accounts, calendar settings and backend audit history are stored separately on the server.</div>
        ${kv('Transactions', db.transactions.length)}${kv('Confidential Transactions', confCount)}${kv('Appointments', db.appointments.length)}${kv('Visitor Log Entries', db.visitorLog.length)}${kv('Queue Entries (all time)', db.queues.length)}${kv('Chat Conversations', db.chats.length)}${kv('Services in Catalog', db.services.length)}${kv('Staff Accounts', db.users.length)}${kv('Audit Trail Entries', `${db.activityLog.length} / ${AUDIT_MAX_ENTRIES}`)}</div>
    </div>`;
}
async function exportAllData(){try{const data=await UniServeUX.request('/backup');const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='uniserve-encrypted-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();URL.revokeObjectURL(url);toast('Encrypted backend backup downloaded. Keep the application key separately for recovery.','ok');}catch(e){toast(escapeHtml(e.message),'err');}}

function renderProfile() {
  const u = currentUser, initials = u.fullName.split(' ').map(s => s[0]).slice(0, 2).join('');
  document.getElementById('content').innerHTML = `
    <div class="card staff-profile-card">
      <div class="profile-head"><div class="profile-avatar">${initials}</div><div><div style="font-weight:700; font-size:1.05rem;">${escapeHtml(u.fullName)}</div><span class="badge-role">${ROLES[u.role].label}</span></div></div>
      <div class="card-pad staff-profile-grid"><section class="staff-profile-details" aria-label="Profile details">
        <div class="field"><label>Full Name</label><input id="pfName" value="${escapeHtml(u.fullName)}"></div>
        <div class="field"><label>Username</label><input id="pfUser" value="${escapeHtml(u.username)}"></div>
        <div class="field"><label>Email</label><input id="pfEmail" type="email" value="${escapeHtml(u.email || '')}"></div>
        </section><section class="staff-profile-password" aria-label="Password and account confirmation"><div class="field"><label>Current Password</label><div class="profile-password-input"><input id="pfCurrentPass" type="password" autocomplete="current-password"><button type="button" class="profile-pass-toggle" aria-label="Show password" aria-pressed="false" onclick="toggleProfilePassword('pfCurrentPass',this)">${profilePasswordEye(false)}</button></div></div>
        <div class="form-row"><div class="field"><label>New Password</label><div class="profile-password-input"><input id="pfPass" aria-describedby="pfPasswordHint" type="password" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;"><button type="button" class="profile-pass-toggle" aria-label="Show password" aria-pressed="false" onclick="toggleProfilePassword('pfPass',this)">${profilePasswordEye(false)}</button></div></div><div class="field"><label>Confirm New Password</label><div class="profile-password-input"><input id="pfPass2" type="password" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;"><button type="button" class="profile-pass-toggle" aria-label="Show password" aria-pressed="false" onclick="toggleProfilePassword('pfPass2',this)">${profilePasswordEye(false)}</button></div></div></div>
        <p id="pfPasswordHint" class="field-hint" aria-live="polite" style="margin-bottom:10px;">At least 12 characters with uppercase and lowercase letters, a number, and a special character.</p><button class="btn btn-primary btn-block" onclick="saveProfile()">Save changes</button>
        <p class="field-hint" style="margin-top:10px; margin-bottom:0;">Leave the new password fields blank to keep your password.</p>
      </section></div></div>`;
}
async function saveProfile() {
  const name = document.getElementById('pfName').value.trim(), uname = document.getElementById('pfUser').value.trim(), pass = document.getElementById('pfPass').value, pass2 = document.getElementById('pfPass2').value;
  if (!name || !uname) { toast('Name and username are required.', 'err'); return; }
  const db = loadDB();
  if (db.users.some(x => x.id !== currentUser.id && x.username.toLowerCase() === uname.toLowerCase())) { toast('That username is already taken.', 'err'); return; }
  if (pass || pass2) {
    if (pass.length < 12 || pass.length > 72 || !/[A-Z]/.test(pass) || !/[a-z]/.test(pass) || !/[0-9]/.test(pass) || !/[^A-Za-z0-9\s]/.test(pass)) { toast('At least 12 characters with uppercase and lowercase letters, a number, and a special character.', 'err'); return; }
    if (pass !== pass2) { toast('Passwords do not match.', 'err'); return; }
  }
  let result;
  try {
    const response = await fetch((globalThis.UniServeConfig?.apiBase||'http://127.0.0.1:8000/api')+'/profile', {
      method: 'PATCH', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + (loadSession().token || '') },
      body: JSON.stringify({ fullName: name, username: uname, email: document.getElementById('pfEmail').value.trim(),
        current_password: document.getElementById('pfCurrentPass').value,
        new_password: pass || null, new_password_confirmation: pass2 || null })
    });
    result = await response.json();
    if (!response.ok) { toast(escapeHtml(Object.values(result.errors || {}).flat().join(' ') || result.message || 'Profile update failed.'), 'err'); return; }
  } catch (_) { toast('Cannot reach the backend server.', 'err'); return; }
  const before = { fullName: currentUser.fullName, username: currentUser.username }, u2 = result.user;
  db.users = db.users.filter(user => user.id !== u2.id).concat(u2);
  const changes = diffFields(before, { fullName: name, username: uname }, { fullName: 'Full name', username: 'Username' });
  if (pass) changes.push({ field: 'Password', from: '', to: '(changed)' });
  logActivity(db, currentUser, 'Updated own profile', { category: 'Accounts', target: uname, changes });
  saveDB(db); currentUser = u2; saveSession({ currentUser: u2, token: result.token });
  document.getElementById('userNameLbl').textContent = u2.fullName;
  document.getElementById('avatarInit').textContent = u2.fullName.split(' ').map(s => s[0]).slice(0, 2).join('');
  renderProfile(); toast('Profile updated.', 'ok');
}

renderSidebar();
navigate('dashboard');

UniServeUX.install();
