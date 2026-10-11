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
const ICON_CHOICES = ['cap', 'idcard', 'checkin', 'folder', 'alert', 'calendar', 'users', 'chart', 'home', 'chat', 'lock', 'log'];
const QUEUE_STATUS_LABEL = { Waiting: 'Waiting', Called: 'Called', Serving: 'Processing', Completed: 'Completed', Skipped: 'Skipped', Cancelled: 'Cancelled' };

const QUEUE_AVG_MINUTES = 4;
const DEFAULT_GRACE_MINUTES = 15;
const DEFAULT_NOSHOW_MINUTES = 60;
const AUDIT_MAX_ENTRIES = 2000;
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
    if (a.queueId || a.status !== 'Booked') return;
    const arr = evaluateArrival(db, a);
    if (arr.status !== 'PastWindow') return;
    Object.assign(a, { status: 'No-show', arrivalStatus: 'NoShow', lateMinutes: arr.lateMinutes, autoNoShow: true });
    logActivity(db, SYSTEM_ACTOR, `Auto-marked ${a.visitId} (${a.code}) as No-show &mdash; ${fmtMinutes(arr.lateMinutes)} past the scheduled time`, { category: 'Appointments', target: a.visitId });
    changed = true;
  });
  return changed;
}
function arrivalStatusPill(appt) {
  if (!appt.arrivalStatus || appt.status === 'No-show') return '';
  const map = { OnTime: 'pill-ok', Late: 'pill-warn', NoShow: 'pill-danger' };
  const label = appt.arrivalStatus === 'NoShow' ? 'No-Show' : appt.arrivalStatus;
  return `<span class="pill ${map[appt.arrivalStatus] || 'pill-info'}">${label}${appt.lateMinutes ? ` &middot; ${fmtMinutes(appt.lateMinutes)}` : ''}</span>`;
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
const slugify = s => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || uid('svc');
function escapeHtml(s) { if (s == null) return ''; return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtFileSize(b) { if (b < 1024) return b + ' B'; if (b < 1048576) return (b / 1024).toFixed(1) + ' KB'; return (b / 1048576).toFixed(1) + ' MB'; }
function fmtMinutes(m) {
  if (m == null) return '&mdash;';
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 6) / 10;
  return `${h} ${h === 1 ? 'hr' : 'hrs'}`;
}
function requestorLabel(name, type) {
  if (!type || String(name || '').toLowerCase().includes(String(type).toLowerCase())) return name || '';
  return `${name} (${type})`;
}

const VISIT_ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomVisitSuffix(len) {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, b => VISIT_ID_CHARS[b % VISIT_ID_CHARS.length]).join('');
}
function visitIdExists(db, id) {
  return ['appointments', 'queues', 'transactions', 'visitorLog', 'chats'].some(k => (db[k] || []).some(x => x.visitId === id));
}
function nextVisitId(db) {
  let id;
  do { const s = randomVisitSuffix(8); id = `VIS-${s.slice(0, 4)}-${s.slice(4)}`; } while (visitIdExists(db, id));
  return id;
}
function normVisitRef(s) {
  const raw = String(s || '').trim().toUpperCase(), c = raw.replace(/[^A-Z0-9]/g, '');
  return /^VIS[A-Z0-9]{8}$/.test(c) ? `VIS-${c.slice(3, 7)}-${c.slice(7)}` : raw;
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
      { id: 'u1', username: 'admin', password: 'admin123', fullName: 'System Administrator', role: 'SUPER_ADMIN', active: true, email: 'sysadmin@oss.edu.ph', confidentialAccess: false },
      { id: 'u2', username: 'oss.admin', password: '1234', fullName: 'Maria Santos', role: 'ADMIN', active: true, email: 'maria.santos@oss.edu.ph', confidentialAccess: true },
      { id: 'u3', username: 'oss.admin2', password: '1234', fullName: 'Dr. Ramon Cruz', role: 'ADMIN', active: true, email: 'ramon.cruz@oss.edu.ph', confidentialAccess: false },
    ],
    services: DEFAULT_SERVICES.map(s => ({ ...s, requirements: [...s.requirements] })),
    transactions: [], appointments: [], chats: [],
    activityLog: [], queues: [], queueCounters: {}, visitorLog: [], visitCounter: 0,
    systemSettings: { orgName: 'Office of Student Services', supportEmail: 'oss@university.edu.ph', supportPhone: '0917-000-0000', timezone: 'Asia/Manila', maintenanceMode: false, autoCloseChats: false, sessionTimeout: 30, queuePrefixStudent: 'A', queuePrefixGuest: 'G', gracePeriodMinutes: DEFAULT_GRACE_MINUTES, noShowThresholdMinutes: DEFAULT_NOSHOW_MINUTES },
  };
}
function mkTxn(o) { return { id: uid('T'), code: randCode('OSS'), status: 'Pending', escalation: null, ...o, updatedAt: o.createdAt || new Date() }; }
function mkLog(user, role, action, ts) { return { id: uid('L'), user, role, action, ts: ts || new Date() }; }
function mkChat(o) { return { id: uid('C'), status: 'Open', messages: [], staffUnread: 0, visitorUnread: 0, createdAt: new Date(), updatedAt: new Date(), ...o }; }
function mkQueue(o) {
  return { id: uid('Q'), visitId: null, number: null, status: 'Waiting', createdAt: new Date(), checkedInAt: new Date(), scheduledAt: null, calledAt: null, servingAt: null, completedAt: null, assignedAdminId: null, assignedAdminName: null, transactionId: null, appointmentId: null, visitorLogId: null, recallCount: 0, isSenior: false, possibleDuplicate: false, feedback: null, ...o };
}
function mkVisitorEntry(o) { return { id: uid('V'), visitId: null, timeIn: new Date(), timeOut: null, ...o }; }
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

function queuePrefixFor(db, visitorType) {
  const s = db.systemSettings;
  const p = visitorType === 'Student' ? (s.queuePrefixStudent || 'A') : (s.queuePrefixGuest || 'G');
  return p.toUpperCase().slice(0, 2) || 'A';
}
function nextQueueNumber(db, visitorType) {
  const prefix = queuePrefixFor(db, visitorType);
  if (!db.queueCounters || db.queueCounters.dayKey !== today()) db.queueCounters = { dayKey: today() };
  const seq = (db.queueCounters[prefix] || 0) + 1;
  db.queueCounters[prefix] = seq;
  return { number: `${prefix}-${String(seq).padStart(3, '0')}`, prefix, seq };
}
function queueRef(q) { return q.number || q.visitId; }
function isDue(q, now = new Date()) { return q.source !== 'Appointment' || !q.scheduledAt || new Date(q.scheduledAt) <= now; }
function queueRank(q, now) {
  if (q.source === 'Appointment') return isDue(q, now) ? (q.isSenior ? -1 : 1) : 3;
  return q.isSenior ? -1 : 2;
}
function queueSortKey(q) { return new Date(q.source === 'Appointment' && q.scheduledAt ? q.scheduledAt : (q.checkedInAt || q.createdAt)); }
function waitingQueueSorted(db) {
  const now = new Date();
  return db.queues.filter(q => q.status === 'Waiting').sort((a, b) => queueRank(a, now) - queueRank(b, now) || queueSortKey(a) - queueSortKey(b));
}
function callableQueue(db) { const now = new Date(); return waitingQueueSorted(db).filter(q => isDue(q, now)); }
function findService(db, key) { return db.services.find(x => x.key === key) || db.services.find(x => x.label === key); }
function serviceLabel(db, key) { const s = db.services.find(x => x.key === key); return s ? s.label : key; }
function serviceQueueLabel(db, e) { return e.serviceLabel || (e.serviceKey ? serviceLabel(db, e.serviceKey) : 'General Concern'); }
function entryMethodLabel(q) { return q.source === 'Appointment' ? 'Scheduled' : (q.source || 'Walk-in'); }
function addToQueue(db, o) {
  const isAppt = o.source === 'Appointment';
  const num = isAppt ? null : nextQueueNumber(db, o.visitorType);
  const entry = mkQueue({
    visitId: o.visitId || nextVisitId(db),
    number: num ? num.number : null, prefix: num ? num.prefix : null, seq: num ? num.seq : null,
    visitorType: o.visitorType, serviceKey: o.serviceKey || null,
    serviceLabel: o.serviceLabel || (o.serviceKey ? serviceLabel(db, o.serviceKey) : 'General Concern'),
    source: o.source || 'Walk-in', name: o.name || '', idNumber: o.idNumber || '', idType: o.idType || '',
    guestClass: o.guestClass || '', contact: o.contact || '', email: String(o.email || '').trim().toLowerCase(),
    appointmentId: o.appointmentId || null, scheduledAt: o.scheduledAt || null,
    isSenior: !!o.isSenior, checkedInAt: o.checkedInAt || new Date(), possibleDuplicate: !!o.possibleDuplicate,
  });
  db.queues.push(entry);
  return entry;
}
function myQueueEntries(db, adminId) { return db.queues.filter(q => q.assignedAdminId === adminId && (q.status === 'Called' || q.status === 'Serving')); }
function todaysQueue(db) { const t = today(); return db.queues.filter(q => fmtDate(q.createdAt) === t); }
function visitRequirements(db, q) {
  if (q.attachments && q.attachments.length) return q.attachments;
  const a = q.appointmentId ? db.appointments.find(x => x.id === q.appointmentId) : null;
  return (a && a.attachments) || [];
}

function visitStart(q) {
  const arrived = new Date(q.checkedInAt || q.createdAt);
  return q.source === 'Appointment' && q.scheduledAt && new Date(q.scheduledAt) > arrived ? new Date(q.scheduledAt) : arrived;
}
function waitingTimeMinutes(q) { if (!q.servingAt) return null; return Math.max(0, Math.round((new Date(q.servingAt) - visitStart(q)) / 60000)); }
function serviceTimeMinutes(q) { if (!q.servingAt || !q.completedAt) return null; return Math.max(0, Math.round((new Date(q.completedAt) - new Date(q.servingAt)) / 60000)); }
function totalTimeMinutes(q) { if (!q.completedAt) return null; return Math.max(0, Math.round((new Date(q.completedAt) - visitStart(q)) / 60000)); }
function timeMetricsGrid(w, s, t) {
  return `<div class="kv"><span>Waiting Time</span><span>${fmtMinutes(w)}</span></div><div class="kv"><span>Service Time</span><span>${fmtMinutes(s)}</span></div><div class="kv"><span>Total Visit Time</span><span>${fmtMinutes(t)}</span></div>`;
}
function historicalAvgMinutes(db, svcKeyOrLabel) {
  const m = db.queues.filter(q => q.status === 'Completed' && q.checkedInAt && q.servingAt && (q.serviceKey === svcKeyOrLabel || q.serviceLabel === svcKeyOrLabel));
  if (!m.length) return QUEUE_AVG_MINUTES;
  return Math.max(1, Math.round(m.reduce((s, q) => s + Math.max(1, (new Date(q.servingAt) - visitStart(q)) / 60000), 0) / m.length));
}
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
function isServiceDelayed(db, q) {
  if (q.status !== 'Serving' || !q.servingAt) return false;
  const expected = historicalAvgMinutes(db, q.serviceKey || q.serviceLabel);
  const elapsed = (new Date() - new Date(q.servingAt)) / 60000;
  return elapsed > expected * 1.6 && elapsed > 8;
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
function computeReadiness(svc, attachments) {
  const required = svc && svc.requirements ? svc.requirements.length : 0, have = (attachments || []).length;
  if (!required || have >= required) return { status: 'READY', label: 'Ready' };
  return { status: 'INCOMPLETE', label: `Incomplete — ${have} of ${required} requirement(s)` };
}
function readinessPillHtml(r, short) {
  if (!r) return '';
  const status = r.status || r;
  const label = short ? (status === 'READY' ? 'Ready' : status === 'FOR_REVIEW' ? 'For review' : 'Incomplete') : (r.label || r);
  const cls = status === 'READY' ? 'ready' : (status === 'FOR_REVIEW' ? 'review' : 'incomplete');
  return `<span class="readiness-pill ${cls}">${icon(status === 'READY' ? 'check' : 'alert', 12)} ${escapeHtml(label)}</span>`;
}
const STARS = n => '&#9733;'.repeat(n) + '&#9734;'.repeat(5 - n);
function feedbackReadoutHtml(q) {
  if (!q || !q.feedback) return '';
  return `<div class="kv"><span>Visitor Feedback</span><span class="fb-readout"><span class="stars">${STARS(q.feedback.rating)}</span>${q.feedback.comment ? ` &mdash; "${escapeHtml(q.feedback.comment)}"` : ''}</span></div>`;
}

function timelineBlockHtml(q, appt) {
  const rows = [];
  if (appt && appt.date) rows.push(['Scheduled for', apptScheduledDate(appt)]);
  rows.push(['Checked in', q.checkedInAt || q.createdAt], ['Called', q.calledAt], ['Service started', q.servingAt], ['Completed', q.completedAt]);
  if (q.skippedAt) rows.push(['Skipped', q.skippedAt]);
  if (q.cancelledAt) rows.push(['Cancelled', q.cancelledAt]);
  return `<div class="divider"></div><div class="field-hint" style="margin:0 0 4px; font-weight:700; text-transform:uppercase; letter-spacing:.06em;">Visit timeline</div>` +
    rows.map(([l, t]) => `<div class="kv"><span>${l}</span><span class="mono">${t ? fmtDateTime(t) : '&mdash;'}</span></div>`).join('');
}
function timelinePrintRows(q, appt) {
  const rows = [];
  if (appt && appt.date) rows.push(['Scheduled For', apptScheduledDate(appt)]);
  rows.push(['Called', q.calledAt], ['Service Started', q.servingAt]);
  return rows.filter(r => r[1]).map(([l, t]) => `<tr><th>${l}</th><td>${fmtDateTime(t)}</td></tr>`).join('');
}
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
function feedbackDashboardHtml(db, canOpen) {
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
    <div class="card"><div class="card-head"><div><h3>Ratings</h3><div class="desc">Stars given after completed visits</div></div>${canOpen ? `<button class="btn btn-ghost btn-sm" onclick="navigate('feedback')">View all</button>` : ''}</div>
      <div class="card-pad">${fs.n ? svgBarChart(fs.dist) : emptyChart('No feedback received yet.')}</div></div>
    <div class="card"><div class="card-head"><div><h3>Recent Comments</h3><div class="desc">Latest written feedback</div></div></div>
      <div class="table-wrap"><table><thead><tr><th>Visitor</th><th>Rating</th><th>Comment</th></tr></thead><tbody>${recent.length ? recent.map(q => { const c = cell(q); return `<tr><td>${escapeHtml(c.name)}</td><td><span class="fb-readout"><span class="stars">${STARS(q.feedback.rating)}</span></span></td><td class="fb-comment-cell">${c.text ? feedbackCommentHtml(q.id, c.text) : '<span class="muted">Hidden</span>'}</td></tr>`; }).join('') : `<tr class="empty-row"><td colspan="3">No comments yet.</td></tr>`}</tbody></table></div></div></div>`;
}

function callSpecificQueue(db, id, admin) {
  const q = db.queues.find(x => x.id === id);
  if (!q || q.status !== 'Waiting' || !isDue(q) || myQueueEntries(db, admin.id).length) return null;
  Object.assign(q, { status: 'Called', assignedAdminId: admin.id, assignedAdminName: admin.fullName, calledAt: new Date(), recallCount: 0 });
  logActivity(db, admin, `Called ${queueRef(q)} (${serviceQueueLabel(db, q)})`);
  return q;
}
function callNextQueue(db, admin) { const next = callableQueue(db)[0]; return next ? callSpecificQueue(db, next.id, admin) : null; }
function beginServingQueue(db, id, admin) {
  const q = db.queues.find(x => x.id === id);
  if (!q) return null;
  q.status = 'Serving'; q.servingAt = new Date();
  if (admin && !q.assignedAdminId) { q.assignedAdminId = admin.id; q.assignedAdminName = admin.fullName; }
  const has = (q.visitorLogId && db.visitorLog.some(v => v.id === q.visitorLogId)) || db.visitorLog.some(v => v.visitId && v.visitId === q.visitId);
  if (!has) {
    const e = mkVisitorEntry({ name: q.name, type: q.visitorType || 'Guest', idNumber: q.idNumber || '', contact: q.contact || '', email: q.email || '', purpose: serviceQueueLabel(db, q), source: q.source || 'Walk-in', visitId: q.visitId });
    db.visitorLog.push(e);
    q.visitorLogId = e.id;
  }
  if (admin) logActivity(db, admin, `Began service for ${queueRef(q)} (${q.visitId}) &mdash; checked in`);
  return q;
}
function completeQueue(db, id, admin) {
  const q = db.queues.find(x => x.id === id);
  if (!q) return null;
  q.status = 'Completed'; q.completedAt = new Date();
  if (admin && !q.assignedAdminId) { q.assignedAdminId = admin.id; q.assignedAdminName = admin.fullName; }
  const linkedAppt = q.appointmentId ? db.appointments.find(a => a.id === q.appointmentId) : null;
  const svc = findService(db, q.serviceKey || q.serviceLabel);
  const txn = mkTxn({
    name: q.name || (q.visitorType + ' Visitor'), type: q.visitorType, idNumber: q.idNumber || '', email: q.email || '',
    service: svc ? svc.key : (q.serviceLabel || 'other'),
    details: q.source === 'Appointment' ? `Served via appointment${linkedAppt ? ' ' + linkedAppt.code : ''} — ${q.visitId}` : `Served via walk-in — queue ${q.number}`,
    status: 'Completed', queueId: q.id, queueNumber: q.number || null, visitId: q.visitId, entryMethod: entryMethodLabel(q),
    appointmentId: q.appointmentId || null, servedBy: (admin && admin.fullName) || q.assignedAdminName || '',
    startedAt: q.servingAt || null, createdAt: q.createdAt, completedAt: q.completedAt,
    waitingTimeMin: waitingTimeMinutes(q), serviceTimeMin: serviceTimeMinutes(q), totalTimeMin: totalTimeMinutes(q),
    possibleDuplicate: !!q.possibleDuplicate,
  });
  db.transactions.push(txn);
  q.transactionId = txn.id;
  const log = db.visitorLog.find(v => (q.visitorLogId && v.id === q.visitorLogId) || (v.visitId && v.visitId === q.visitId));
  if (log && !log.timeOut) log.timeOut = q.completedAt;
  if (linkedAppt) linkedAppt.status = 'Completed';
  if (admin) logActivity(db, admin, `Completed visit ${q.visitId} (${queueRef(q)}) &mdash; logged as transaction ${txn.code} &mdash; checked out`);
  return txn;
}
function skipQueue(db, id, admin) {
  const q = db.queues.find(x => x.id === id);
  if (!q) return;
  q.status = 'Skipped'; q.skippedAt = new Date();
  if (admin) logActivity(db, admin, `Skipped ${queueRef(q)} (${q.visitId}) &mdash; no response when called`, { category: 'Queue', target: q.visitId });
}
function recallQueue(db, id, admin) {
  const q = db.queues.find(x => x.id === id);
  if (!q) return;
  q.recallCount = (q.recallCount || 0) + 1; q.recalledAt = new Date();
  if (admin) logActivity(db, admin, `Recalled ${queueRef(q)} (${q.visitId})`, { category: 'Queue', target: q.visitId });
}
function cancelQueue(db, id, actor) {
  const q = db.queues.find(x => x.id === id);
  if (!q) return;
  q.status = 'Cancelled'; q.cancelledAt = new Date();
  const a = q.appointmentId ? db.appointments.find(x => x.id === q.appointmentId) : null;
  if (a) a.status = 'Cancelled';
  if (actor) logActivity(db, actor, `Cancelled ${queueRef(q)} (${q.visitId})`, { category: 'Queue', target: q.visitId });
}
function transferQueue(db, id, newKey, admin) {
  const q = db.queues.find(x => x.id === id);
  if (!q) return;
  const svc = findService(db, newKey), from = serviceQueueLabel(db, q);
  Object.assign(q, { serviceKey: newKey, serviceLabel: svc ? svc.label : newKey, status: 'Waiting', assignedAdminId: null, assignedAdminName: null, calledAt: null, transferredAt: new Date() });
  if (admin) logActivity(db, admin, `Transferred ${queueRef(q)} (${q.visitId}) from ${from} to ${q.serviceLabel}`, { category: 'Queue', target: q.visitId });
}
function queueStatusPillForLog(q) {
  if (!q) return `<span class="muted" style="font-size:.76rem;">&mdash;</span>`;
  return `<span class="pill ${q.status === 'Waiting' ? 'pill-warn' : (q.status === 'Called' ? 'pill-gold' : 'pill-info')}">${escapeHtml(QUEUE_STATUS_LABEL[q.status] || q.status)} &middot; ${escapeHtml(queueRef(q))}</span>`;
}
function activeQueueForVisit(db, visitId) {
  return visitId ? db.queues.find(q => q.visitId === visitId && ['Waiting', 'Called', 'Serving'].includes(q.status)) || null : null;
}

function adminCheckInAppointment(apptId) {
  const db = loadDB(), appt = db.appointments.find(x => x.id === apptId);
  if (!appt) { toast('Appointment not found.', 'err'); return; }
  const existing = appt.queueId ? db.queues.find(x => x.id === appt.queueId) : null;
  if (existing) { toast('This visit is already checked in.', 'err'); closeModal(); openQueueVisitDetail(existing.id); return; }
  if (appt.status === 'Cancelled') { toast('This appointment was cancelled.', 'err'); return; }
  if (appt.status === 'No-show') { toast('This appointment was marked as a no-show.', 'err'); return; }
  const arr = evaluateArrival(db, appt), now = new Date(), svc = findService(db, appt.service);
  const entry = addToQueue(db, {
    visitorType: appt.type, serviceKey: svc ? svc.key : null, serviceLabel: appt.service, source: 'Appointment',
    name: appt.name, idNumber: appt.idNumber, idType: appt.idType || '', guestClass: appt.guestClass, contact: appt.contact, email: appt.email,
    appointmentId: appt.id, scheduledAt: apptScheduledDate(appt), isSenior: appt.isSenior,
    visitId: appt.visitId, checkedInAt: now, possibleDuplicate: !!appt.possibleDuplicate,
  });
  Object.assign(appt, { status: 'Checked-in', checkedInAt: now, arrivalStatus: arr.status === 'PastWindow' ? 'Late' : arr.status, lateMinutes: arr.lateMinutes, queueId: entry.id });
  logActivity(db, currentUser, `Checked in ${appt.visitId} (${appt.code})${arr.status !== 'OnTime' ? ` &mdash; arrived ${fmtMinutes(arr.lateMinutes)} late` : ''}`);
  saveDB(db);
  closeModal();
  toast(`Checked in &mdash; ${escapeHtml(appt.visitId)} is in the queue by scheduled time.`, 'ok');
  if (state_view === 'appointments') renderApptTable();
  if (state_view === 'queue') renderQueueDashboard();
  renderSidebar();
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
  db.auditHead = { hash: e.hash };
  if (db.activityLog.length > AUDIT_MAX_ENTRIES) db.activityLog.length = AUDIT_MAX_ENTRIES;
}

function readFileAsDataURL(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res({ name: file.name, size: file.size, type: file.type, dataUrl: r.result }); r.onerror = rej; r.readAsDataURL(file); }); }
async function readFilesAsAttachments(list) { return Promise.all(Array.from(list || []).map(readFileAsDataURL)); }
function attachChip(a) { return `<a class="attach-chip" href="${a.dataUrl}" download="${escapeHtml(a.name)}" target="_blank">${icon('paperclip', 13)}<span class="fname">${escapeHtml(a.name)}</span><span class="fsize">${fmtFileSize(a.size)}</span></a>`; }
function attachListHtml(list, emptyText) { if (!list || !list.length) return `<div class="no-attach">${emptyText || 'No files uploaded.'}</div>`; return `<div class="attach-list">${list.map(attachChip).join('')}</div>`; }
function csvEscape(v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function downloadCSV(filename, rows) {
  const blob = new Blob(['\uFEFF' + rows.map(r => r.map(csvEscape).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
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
function reportSignatureBlock(role1, role2) {
  return `<div class="rpt-signature-block">
    <div class="rpt-sign-col"><div class="rpt-sign-line"></div><div class="rpt-sign-name">${escapeHtml(currentUser.fullName)}</div><div class="rpt-sign-role">${escapeHtml(role1 || 'Prepared by, OSS Admin')}</div></div>
    <div class="rpt-sign-col"><div class="rpt-sign-line"></div><div class="rpt-sign-name">&nbsp;</div><div class="rpt-sign-role">${escapeHtml(role2 || 'Noted by, Head, Office of Student Services')}</div></div></div>`;
}
function printInjected(html) {
  document.querySelectorAll('.print-inject').forEach(n => n.remove());
  const wrap = document.createElement('div');
  wrap.id = 'printArea'; wrap.className = 'print-inject';
  wrap.innerHTML = `<table class="print-sheet"><tbody><tr><td>${html}</td></tr></tbody><tfoot><tr><td><div class="print-footer-space"></div></td></tr></tfoot></table>${reportFooter()}`;
  document.body.appendChild(wrap);
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

function buildTrendBuckets(txns, start) {
  const day = 86400000, rangeDays = Math.max(1, Math.round((new Date() - start) / day));
  const unit = rangeDays <= 14 ? 'day' : 'week', bucketMs = unit === 'day' ? day : day * 7;
  const n = Math.max(1, Math.ceil(rangeDays / (bucketMs / day)));
  const buckets = Array.from({ length: n }, (_, i) => ({ start: new Date(start.getTime() + i * bucketMs), count: 0 }));
  txns.forEach(t => { const i = Math.min(n - 1, Math.floor((t.createdAt - start) / bucketMs)); if (i >= 0) buckets[i].count++; });
  return { labels: buckets.map(b => fmtDate(b.start).slice(5)), values: buckets.map(b => b.count), unit };
}
function truncateLabel(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function svgLineChart(trend) {
  const { labels, values } = trend;
  const w = 760, h = 220, padL = 34, padR = 20, padT = 20, padB = 34, innerW = w - padL - padR, innerH = h - padT - padB;
  const max = Math.max(1, ...values), stepX = values.length > 1 ? innerW / (values.length - 1) : 0;
  const pts = values.map((v, i) => ({ x: padL + (values.length > 1 ? i * stepX : innerW / 2), y: padT + innerH - (v / max) * innerH, v }));
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = pts.length > 1 ? `${line} L${pts[pts.length - 1].x.toFixed(1)},${(padT + innerH).toFixed(1)} L${pts[0].x.toFixed(1)},${(padT + innerH).toFixed(1)} Z` : '';
  const grid = [0, .25, .5, .75, 1].map(f => { const y = padT + innerH - f * innerH; return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" stroke="var(--text)" stroke-opacity="0.12"/><text x="${padL - 8}" y="${(y + 3).toFixed(1)}" font-size="10" text-anchor="end" fill="var(--text)">${Math.round(max * f)}</text>`; }).join('');
  const xl = pts.map((p, i) => `<text x="${p.x.toFixed(1)}" y="${h - 10}" font-size="10" text-anchor="middle" fill="var(--text)">${escapeHtml(labels[i])}</text>`).join('');
  const dots = pts.map(p => `<g class="cl-point-group"><circle class="cl-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" stroke-width="1"/><text class="cl-val-label" x="${p.x.toFixed(1)}" y="${(p.y - 9).toFixed(1)}" font-size="10" text-anchor="middle" fill="var(--text)">${p.v}</text></g>`).join('');
  return `<svg viewBox="0 0 ${w} ${h}" style="width:100%; height:auto; max-height:240px;" role="img" aria-label="Transaction trend chart">${grid}${area ? `<path class="cl-area" d="${area}" stroke="none"/>` : ''}<path class="cl-line" pathLength="1000" d="${line}" fill="none" stroke-width="2.5"/>${dots}${xl}</svg>`;
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
    log: 'M4 4h16v16H4V4zM8 8h8M8 12h8M8 16h5',
    star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
    download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
    eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 15a3 3 0 100-6 3 3 0 000 6z',
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
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('activeModal')) closeModal(); });
function setTheme(t) { localStorage.setItem('ossuniserve_theme', t); document.documentElement.setAttribute('data-theme', t); document.querySelectorAll('[data-theme-btn]').forEach(b => b.classList.toggle('active', b.dataset.themeBtn === t)); }
setTheme(localStorage.getItem('ossuniserve_theme') || 'light');

let currentUser = null;
(function guard() {
  const sess = loadSession(), db = loadDB();
  const fresh = sess.currentUser ? db.users.find(u => u.id === sess.currentUser.id) : null;
  if (!fresh || fresh.role !== 'ADMIN' || !fresh.active) {
    location.href = '../Landing/landing.html';
    throw new Error('OSS UniServe: not an authorized Admin session — redirecting to login.');
  }
  currentUser = fresh;
})();
function endSession(reason) {
  sessionStorage.removeItem('ossuniserve_session');
  if (reason) sessionStorage.setItem('ossuniserve_notice', reason);
  location.href = '../Landing/landing.html';
}
function doLogout() {
  const db = loadDB();
  logActivity(db, currentUser, 'Logged out');
  saveDB(db);
  endSession();
}
function validateSession() {
  const fresh = loadDB().users.find(u => u.id === currentUser.id);
  if (!fresh || fresh.role !== 'ADMIN' || !fresh.active) { endSession('Your account is no longer active.'); return false; }
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

const NAV = [
  { key: 'dashboard', label: 'Dashboard', ic: 'dashboard' },
  { key: 'queue', label: 'Queue', ic: 'ticket' },
  { key: 'appointments', label: 'Appointments', ic: 'calendar' },
  { key: 'logbook', label: 'Visitor Log', ic: 'log' },
  { key: 'messages', label: 'Messages', ic: 'chat' },
  { key: 'transactions', label: 'Transactions', ic: 'folder' },
  { key: 'feedback', label: 'Feedback', ic: 'star' },
  { key: 'services', label: 'Manage Services', ic: 'plus' },
  { key: 'reports', label: 'Reports', ic: 'chart' },
  { key: 'profile', label: 'My Profile', ic: 'userc' },
];
const TITLES = {
  dashboard: ['Dashboard', "Overview of today's activity"],
  queue: ['Queue', "Today's active service line — call, serve and complete visits."],
  appointments: ['Appointments', 'Scheduled visits awaiting check-in — set date and time, then check visitors in'],
  logbook: ['Visitor Log', 'Record of who visited the office and when — Time In and Time Out'],
  transactions: ['Transactions', 'Service history and records — including Incident Reports and Scholarship Transactions'],
  messages: ['Messages', 'Chat conversations with students and guests'],
  feedback: ['Feedback', 'Ratings and comments left by visitors after their visit'],
  services: ['Manage Services', 'Create and edit the services students & guests can request'],
  reports: ['Reports', 'Generate downloadable office reports'],
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
let txnServiceFilter;
function totalStaffUnread() { return loadDB().chats.reduce((s, c) => s + (c.staffUnread || 0), 0); }
function countTxnForService(db, key) { return db.transactions.filter(t => t.service === key).length; }
function renderSidebar() {
  const db = loadDB(), pending = db.transactions.filter(t => t.status === 'Pending').length;
  document.getElementById('navList').innerHTML = NAV.map(n => {
    const badge = n.key === 'messages' ? totalStaffUnread() : (n.key === 'transactions' ? pending : 0);
    return `<li><button class="nav-item ${state_view === n.key ? 'active' : ''}" title="${n.label}" onclick="navigate('${n.key}')">${icon(n.ic)}<span>${n.label}</span>${badge ? `<span class="nav-badge">${badge}</span>` : ''}</button></li>`;
  }).join('');
}
function navigate(key) {
  if (!TITLES[key]) key = 'dashboard';
  if (key !== 'queue') stopAdminQueuePolling();
  if (key !== 'messages') { stopMessagesPolling(); activeStaffChatId = null; }
  state_view = key; txnServiceFilter = undefined;
  document.getElementById('pageTitle').textContent = TITLES[key][0];
  document.getElementById('pageSub').innerHTML = TITLES[key][1];
  renderSidebar();
  document.getElementById('sidebar').classList.remove('open');
  ({ dashboard: renderDashboard, queue: renderQueueDashboard, appointments: renderAppointments, logbook: renderVisitorLogbook, messages: renderMessages, transactions: renderTransactions, feedback: renderFeedback, services: renderServicesManage, reports: renderReports, profile: renderProfile })[key]();
}
function navigateTxnService(key) { navigate('transactions'); if (key) setTxnService(key); }
function statusPill(status) {
  const map = { Pending: 'pill-warn', Processing: 'pill-info', Approved: 'pill-ok', Completed: 'pill-ok', Rejected: 'pill-danger', Requested: 'pill-warn', Booked: 'pill-info', Scheduled: 'pill-info', 'Checked-in': 'pill-gold', Cancelled: 'pill-danger', 'No-show': 'pill-danger', Waiting: 'pill-warn', Called: 'pill-gold', Serving: 'pill-info', Skipped: 'pill-danger', 'Under Review': 'pill-warn', Resolved: 'pill-ok', Open: 'pill-info', Closed: 'pill-danger' };
  return `<span class="pill ${map[status] || 'pill-info'}">${status}</span>`;
}
function queueStatusPill(status) { return statusPill(QUEUE_STATUS_LABEL[status] || status); }
function dueTagHtml(q) { return q.source === 'Appointment' && !isDue(q) ? `<span class="pill pill-info">Due ${fmtTime(q.scheduledAt)}</span>` : ''; }

function renderDashboard() {
  const db = loadDB();
  if (sweepNoShows(db)) saveDB(db);
  const t = today(), qs = queueStats(db);
  const todaysTxn = db.transactions.filter(x => fmtDate(x.createdAt) === t);
  const pending = db.transactions.filter(x => x.status === 'Pending').length;
  const openIncidents = db.transactions.filter(x => x.service === 'incident_report' && !['Completed', 'Rejected'].includes(x.status)).length;
  const upcoming = db.appointments.filter(a => !a.queueId && ['Booked', 'Requested'].includes(a.status)).length;
  const recent = [...db.transactions].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  const lateToday = db.appointments.filter(a => a.date === t && a.arrivalStatus === 'Late').length;
  const noShowToday = db.appointments.filter(a => a.date === t && a.status === 'No-show').length;
  const peaks = peakHourWindows(db);
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
        <div class="stat-card"><div class="lbl">Unread Messages</div><div class="val">${totalStaffUnread()}</div></div>
        <div class="stat-card"><div class="lbl">Open Incident Reports</div><div class="val">${openIncidents}</div></div>
        <div class="stat-card"><div class="lbl">Late Appointments Today</div><div class="val">${lateToday}</div></div>
        <div class="stat-card"><div class="lbl">No-Shows Today</div><div class="val">${noShowToday}</div></div>
        <div class="stat-card"><div class="lbl">Completed Today</div><div class="val">${qs.completedToday}</div></div>
        <div class="stat-card"><div class="lbl">Peak Hour</div><div class="val val-list">${peaks.length ? `<span>${peaks[0]}</span>` : '&mdash;'}</div></div>
      </div></section>
    <section class="dash-section"><h2 class="dash-h">Live queue</h2>
      <div class="card"><div class="card-head"><div><h3>Queue Status</h3><div class="desc">Who is waiting and who is being served right now</div></div><button class="btn btn-primary btn-sm" onclick="navigate('queue')">${icon('ticket', 14)} Open Queue</button></div>
        <div class="card-pad"><div class="stat-grid" style="margin-bottom:0;">
          <div class="stat-card"><div class="lbl">Currently Waiting</div><div class="val">${qs.waiting}</div></div>
          <div class="stat-card"><div class="lbl">Currently Serving</div><div class="val">${qs.serving}</div></div>
          <div class="stat-card"><div class="lbl">Next To Call</div><div class="val val-sm">${qs.next ? escapeHtml(queueRef(qs.next)) : '&mdash;'}</div></div>
          <div class="stat-card"><div class="lbl">Awaiting Check-In</div><div class="val">${upcoming}</div></div>
        </div></div></div></section>
    <section class="dash-section"><h2 class="dash-h">Activity</h2>
      <div class="grid-2">
        <div class="card"><div class="card-head"><div><h3>14-Day Transaction Trend</h3><div class="desc">Transactions logged per day, most recent two weeks</div></div></div>
          <div class="card-pad">${trendTxns.length ? svgLineChart(trend) : emptyChart('No transactions logged in the last 14 days.')}</div></div>
        <div class="card"><div class="card-head"><div><h3>Top Services</h3><div class="desc">All-time transaction volume</div></div></div>
          <div class="card-pad">${topServices.some(r => r.count) ? svgBarChart(topServices, { height: topServices.length * 30 + 20 }) : emptyChart('No transactions logged yet.')}</div></div>
      </div></section>
    <section class="dash-section"><h2 class="dash-h">Records</h2>
    <div class="grid-2">
      <div class="card"><div class="card-head"><div><h3>Recent Transactions</h3><div class="desc">Latest service records logged across the office</div></div><button class="btn btn-ghost btn-sm" onclick="navigateTxnService(null)">View all</button></div>
        <div class="table-wrap"><table><thead><tr><th>#</th><th>Code</th><th>Requestor</th><th>Service</th><th>Status</th><th>Logged</th></tr></thead>
          <tbody>${recent.length ? recent.map((r, i) => `<tr><td class="row-num">${i + 1}</td><td class="mono">${r.code}</td><td>${escapeHtml(isTxnLocked(r) ? maskName(r.name) : r.name)}</td><td>${serviceLabel(db, r.service)}</td><td>${statusPill(r.status)}</td><td class="muted">${fmtDate(r.createdAt)}<br>${fmtTime(r.createdAt)}</td></tr>`).join('') : `<tr class="empty-row"><td colspan="6">No transactions yet.</td></tr>`}</tbody></table></div></div>
      <div class="card"><div class="card-head"><div><h3>Status Mix</h3><div class="desc">All-time transaction status breakdown</div></div></div>
        <div class="card-pad">${db.transactions.length ? svgBarChart(ORDER.map(s => ({ label: s, count: sc[s] })), { height: ORDER.length * 30 + 20 }) : emptyChart('No transactions logged yet.')}</div></div>
    </div></section>
    <section class="dash-section"><h2 class="dash-h">Visitor feedback</h2>${feedbackDashboardHtml(db, true)}</section>`;
}

let adminQueuePollTimer = null;
function startAdminQueuePolling() { stopAdminQueuePolling(); adminQueuePollTimer = setInterval(() => { if (state_view === 'queue') renderQueueDashboard(); }, 4000); }
function stopAdminQueuePolling() { if (adminQueuePollTimer) { clearInterval(adminQueuePollTimer); adminQueuePollTimer = null; } }
function renderQueueDashboard() {
  const db = loadDB(), stats = queueStats(db), mine = myQueueEntries(db, currentUser.id), waiting = waitingQueueSorted(db), nextUp = stats.next, busy = mine[0];
  document.getElementById('content').innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="lbl">Currently Waiting</div><div class="val">${stats.waiting}</div></div>
      <div class="stat-card"><div class="lbl">Currently Serving</div><div class="val">${stats.serving}</div></div>
      <div class="stat-card"><div class="lbl">Completed Today</div><div class="val">${stats.completedToday}</div></div>
      <div class="stat-card"><div class="lbl">Average Wait</div><div class="val">${fmtMinutes(stats.avgWaitMin)}</div></div>
    </div>
    <div class="grid-2">
      <div class="card">
        <div class="card-head"><div><h3>My Queue</h3><div class="desc">${escapeHtml(currentUser.fullName)} &mdash; OSS Admin</div></div>
          <div class="toolbar"><button class="btn btn-gold btn-sm" onclick="handleCallNext()" ${!nextUp || busy ? 'disabled' : ''} title="${busy ? 'Finish or skip your current visitor first' : ''}">${icon('arrowright', 14)} Call Next</button></div></div>
        <div class="card-pad">
          ${mine.length ? mine.map(q => renderMyQueueCard(db, q)).join('') : `<div class="helper-empty" style="padding:30px 10px;">${icon('ticket', 30)}<p>${waiting.length && !nextUp ? 'Everyone waiting is scheduled for a later time.' : "You're not currently serving anyone. Click Call Next to bring up the next visit."}</p></div>`}
          ${nextUp ? `<div class="divider"></div><div class="lbl" style="font-size:.72rem; text-transform:uppercase; letter-spacing:.6px; color:var(--text-soft); font-weight:600; margin-bottom:8px;">Next${busy ? ` &mdash; finish or skip ${escapeHtml(queueRef(busy))} to call` : ''}</div>
            <div class="qd-next-row"><span class="pill pill-gold">${escapeHtml(queueRef(nextUp))}</span><span class="muted" style="font-size:.82rem;">${escapeHtml(nextUp.name || nextUp.visitorType)} &middot; ${escapeHtml(serviceQueueLabel(db, nextUp))} &middot; ${escapeHtml(entryMethodLabel(nextUp))}</span>${nextUp.isSenior ? ' <span class="pill pill-gold">Senior</span>' : ''}${nextUp.possibleDuplicate ? ' <span class="pill pill-warn">Possible Dup.</span>' : ''}</div>` : ''}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Waiting</h3><div class="desc">${waiting.length} in line &mdash; seniors, then scheduled visits by time, then walk-ins</div></div></div>
        <div class="table-wrap"><table><thead><tr><th>#</th><th>Ticket</th><th>Visitor</th><th>Service</th><th>Entry</th><th></th></tr></thead>
          <tbody>${waiting.length ? waiting.map((q, i) => `<tr><td class="row-num">${i + 1}</td>
            <td class="mono">${escapeHtml(queueRef(q))}${q.isSenior ? ' <span class="pill pill-gold">Senior</span>' : ''}${q.possibleDuplicate ? ' <span class="pill pill-warn">Dup?</span>' : ''}${q.number ? `<div class="muted" style="font-size:.68rem;">${escapeHtml(q.visitId || '')}</div>` : ''}</td>
            <td>${escapeHtml(q.name || '—')}<div class="muted" style="font-size:.72rem;">${escapeHtml(q.visitorType)}</div></td>
            <td>${escapeHtml(serviceQueueLabel(db, q))}</td>
            <td>${q.source === 'Appointment' ? (dueTagHtml(q) || `<span class="pill pill-info">Scheduled</span>`) : `<span class="muted" style="font-size:.76rem;">Walk-in</span>`}</td>
            <td style="white-space:nowrap;"><button class="icon-btn" title="View Visit" onclick="openQueueVisitDetail('${q.id}')">${icon('eye', 14)}</button> <button class="icon-btn" title="Cancel" onclick="adminCancelQueue('${q.id}')">${icon('x', 14)}</button></td></tr>`).join('') : `<tr class="empty-row"><td colspan="6">Queue is empty.</td></tr>`}</tbody></table></div>
      </div>
    </div>`;
  startAdminQueuePolling();
}
function renderMyQueueCard(db, q) {
  const called = q.status === 'Called', reqCount = visitRequirements(db, q).length, delayed = isServiceDelayed(db, q);
  return `<div class="qd-serving-card"><div class="qd-serving-top">
      <div><div class="qd-serving-number">${escapeHtml(queueRef(q))}${q.isSenior ? ' <span class="pill pill-gold">Senior</span>' : ''}${q.possibleDuplicate ? ' <span class="pill pill-warn">Dup?</span>' : ''}</div>
        <div class="muted" style="font-size:.8rem;">${escapeHtml(q.name || q.visitorType)} &middot; ${escapeHtml(serviceQueueLabel(db, q))} &middot; ${escapeHtml(entryMethodLabel(q))}</div>
        <div class="muted mono" style="font-size:.7rem; margin-top:2px;">${q.number ? escapeHtml(q.visitId || '') : (q.scheduledAt ? 'Scheduled ' + fmtTime(q.scheduledAt) : '')}${reqCount ? ` &middot; ${reqCount} requirement(s)` : ''}</div></div>
      ${delayed ? `<span class="pill delay-pill">${icon('alert', 11)} Delayed</span>` : (called ? `<span class="pill pill-warn">Called &mdash; awaiting arrival</span>` : `<span class="pill pill-ok">Processing</span>`)}
    </div>
    <div class="qd-serving-actions">
      <button class="btn btn-ghost btn-sm" onclick="openQueueVisitDetail('${q.id}')">${icon('eye', 13)} View Visit</button>
      ${called ? `<button class="btn btn-primary btn-sm" onclick="handleBeginServing('${q.id}')">${icon('check', 13)} Begin Service</button>
        <button class="btn btn-ghost btn-sm" onclick="handleRecall('${q.id}')">${icon('megaphone', 13)} Recall</button>
        <button class="btn btn-danger-o btn-sm" onclick="handleSkip('${q.id}')">Skip</button>`
      : `<button class="btn btn-primary btn-sm" onclick="handleCompleteQueue('${q.id}')">${icon('check', 13)} Complete Transaction</button>
        <button class="btn btn-ghost btn-sm" onclick="openTransferModal('${q.id}')">${icon('swap', 13)} Transfer</button>`}
    </div></div>`;
}
function handleCallNext() {
  const db = loadDB(), busy = myQueueEntries(db, currentUser.id)[0];
  if (busy) { toast(`Finish or skip ${escapeHtml(queueRef(busy))} first.`, 'err'); return; }
  const entry = callNextQueue(db, currentUser);
  if (!entry) { toast('No visit can be called yet.', 'err'); return; }
  saveDB(db);
  toast(`Called ${escapeHtml(queueRef(entry))} &mdash; please proceed to ${escapeHtml(currentUser.fullName)}.`, 'ok');
  renderQueueDashboard();
}
function handleBeginServing(id) { const db = loadDB(), q = beginServingQueue(db, id, currentUser); saveDB(db); toast(q ? `Now processing ${escapeHtml(queueRef(q))} &mdash; checked in to the Visitor Log.` : 'Now processing.', 'ok'); renderQueueDashboard(); }
function handleCompleteQueue(id) { const db = loadDB(), txn = completeQueue(db, id, currentUser); saveDB(db); toast(txn ? `Visit completed &mdash; logged as transaction ${txn.code} and checked out.` : 'Visit marked Completed.', 'ok'); renderQueueDashboard(); renderSidebar(); }
function handleSkip(id) { const db = loadDB(); skipQueue(db, id, currentUser); saveDB(db); toast('Skipped.', 'ok'); renderQueueDashboard(); }
function handleRecall(id) { const db = loadDB(); recallQueue(db, id, currentUser); saveDB(db); toast('Recalled on the public display.', 'ok'); renderQueueDashboard(); }
function adminCancelQueue(id) { if (!confirm('Cancel this visit?')) return; const db = loadDB(); cancelQueue(db, id, currentUser); saveDB(db); renderQueueDashboard(); }
function openTransferModal(id) {
  const db = loadDB(), q = db.queues.find(x => x.id === id);
  if (!q) return;
  openModal(`Transfer ${escapeHtml(queueRef(q))}`, `<p class="field-hint" style="margin-bottom:12px;">Move this visit back into the queue under a different OSS service. The Visit ID and uploaded requirements stay with it.</p>
    <div class="field"><label>New Service</label><select id="mTransferSvc">${db.services.map(s => `<option value="${s.key}" ${s.key === q.serviceKey ? 'selected' : ''}>${s.label}</option>`).join('')}</select></div>`,
    [{ label: 'Cancel', cls: 'btn-ghost', action: closeModal },
     { label: 'Transfer', cls: 'btn-primary', action: () => { const db2 = loadDB(); transferQueue(db2, id, document.getElementById('mTransferSvc').value, currentUser); saveDB(db2); closeModal(); renderQueueDashboard(); toast('Visit transferred.', 'ok'); } }]);
}
function openQueueVisitDetail(id) {
  const db = loadDB(), q = db.queues.find(x => x.id === id);
  if (!q) { toast('Visit not found.', 'err'); return; }
  const linkedAppt = q.appointmentId ? db.appointments.find(a => a.id === q.appointmentId) : null;
  const reqs = visitRequirements(db, q), mine = q.assignedAdminId === currentUser.id;
  const txn = q.transactionId ? db.transactions.find(t => t.id === q.transactionId) : null;
  const buttons = [];
  if (q.status === 'Waiting') {
    buttons.push({ label: 'Call Now', cls: 'btn-gold', action: () => {
      if (!isDue(q)) { toast(`Scheduled for ${fmtTime(q.scheduledAt)} &mdash; it cannot be called before then.`, 'err'); return; }
      const db2 = loadDB(), busy2 = myQueueEntries(db2, currentUser.id)[0];
      if (busy2) { toast(`Finish or skip ${escapeHtml(queueRef(busy2))} first.`, 'err'); return; }
      const called = callSpecificQueue(db2, q.id, currentUser);
      if (!called) { toast('Could not call this visit.', 'err'); return; }
      saveDB(db2); closeModal(); toast(`Called ${escapeHtml(queueRef(called))}.`, 'ok');
      if (state_view === 'queue') renderQueueDashboard();
    } });
  } else if (q.status === 'Called' && mine) buttons.push({ label: 'Begin Service', cls: 'btn-primary', action: () => { closeModal(); handleBeginServing(q.id); } });
  else if (q.status === 'Serving' && mine) buttons.push({ label: 'Complete Transaction', cls: 'btn-primary', action: () => { closeModal(); handleCompleteQueue(q.id); } });

  openModal(`Visit &mdash; ${escapeHtml(q.visitId || q.number)}`, `
    ${q.possibleDuplicate ? `<div class="dup-warn">${icon('alert', 13)} Flagged by the visitor portal as a possible duplicate active visit for this ID number or Gmail and service. Review before proceeding if unsure.</div>` : ''}
    ${isServiceDelayed(db, q) ? `<div class="alert-banner danger"><b>${icon('alert', 13)} Service Delay Alert</b>This visit has been in service noticeably longer than usual for this service. Informational only.</div>` : ''}
    ${q.number ? `<div class="kv"><span>Queue Number</span><span><span class="pill pill-gold">${escapeHtml(q.number)}</span></span></div>` : ''}
    <div class="kv"><span>Name</span><span>${escapeHtml(q.name || '—')}</span></div>
    <div class="kv"><span>Type</span><span>${escapeHtml(q.guestClass ? `${q.visitorType} (${q.guestClass})` : q.visitorType)}</span></div>
    ${q.idNumber ? `<div class="kv"><span>${q.idType ? escapeHtml(q.idType) : 'ID Number'}</span><span>${escapeHtml(q.idNumber)}</span></div>` : (q.idType ? `<div class="kv"><span>ID Type</span><span>${escapeHtml(q.idType)}</span></div>` : '')}
    ${q.contact ? `<div class="kv"><span>Contact</span><span>${escapeHtml(q.contact)}</span></div>` : ''}
    ${q.email ? `<div class="kv"><span>Gmail</span><span>${escapeHtml(q.email)}</span></div>` : ''}
    <div class="kv"><span>Service</span><span>${escapeHtml(serviceQueueLabel(db, q))}</span></div>
    <div class="kv"><span>Entry Method</span><span>${q.source === 'Appointment' ? 'Scheduled Appointment' : 'Walk-In'}</span></div>
    ${q.scheduledAt ? `<div class="kv"><span>Scheduled For</span><span>${fmtDateTime(q.scheduledAt)} ${dueTagHtml(q)}</span></div>` : ''}
    <div class="kv"><span>Status</span><span>${queueStatusPill(q.status)}</span></div>
    ${q.isSenior ? `<div class="kv"><span>Priority</span><span><span class="pill pill-gold">Senior Citizen</span></span></div>` : ''}
    ${linkedAppt ? `<div class="kv"><span>Appointment</span><span>${escapeHtml(linkedAppt.code)}</span></div>` : ''}
    ${linkedAppt && linkedAppt.arrivalStatus ? `<div class="kv"><span>Arrival</span><span>${arrivalStatusPill(linkedAppt)}</span></div>` : ''}
    ${q.assignedAdminName ? `<div class="kv"><span>OSS Admin</span><span>${escapeHtml(q.assignedAdminName)}</span></div>` : ''}
    ${txn ? `<div class="kv"><span>Transaction</span><span class="mono">${escapeHtml(txn.code)}</span></div>` : ''}
    ${feedbackReadoutHtml(q)}
    ${timelineBlockHtml(q, linkedAppt)}
    <div class="divider"></div>
    <div class="field"><label>Uploaded Requirements</label>${attachListHtml(reqs, q.source === 'Appointment' ? 'No files uploaded with this appointment.' : 'No files uploaded &mdash; walk-in visitors bring physical documents to the counter.')}</div>`, buttons);
}

let apptFilter = 'all';
function renderAppointments(keep) {
  const db0 = loadDB(), prev = keep ? (document.getElementById('apptSearch')?.value || '') : '';
  if (sweepNoShows(db0)) saveDB(db0);
  if (!keep) apptFilter = 'all';
  document.getElementById('content').innerHTML = `
    <div class="card">
      <div class="card-head"><div><h3>Scheduled Visits</h3><div class="desc">${escapeHtml(rangeLabel(RANGES.appt))} &mdash; by appointment date</div></div></div>
      <div class="filter-bar">${dateRangeHtml('appt')}<div class="search-box">${icon('search', 15)}<input id="apptSearch" placeholder="Name, code or visit ID" value="${escapeHtml(prev)}" oninput="renderApptTable()"></div></div>
      <div class="subnav tab-row">${['all', 'Requested', 'Booked', 'Checked-in', 'No-show', 'Cancelled'].map(f => `<button class="${apptFilter === f ? 'active' : ''}" onclick="setApptFilter('${f}',this)">${f === 'all' ? 'All' : f}</button>`).join('')}</div>
      <div class="table-wrap"><table><thead><tr><th>#</th><th>Visit ID</th><th>Requestor</th><th>Service</th><th>Date</th><th>Time</th><th>Readiness</th><th>Status</th><th></th></tr></thead><tbody id="apptBody"></tbody></table></div>
    </div>`;
  renderApptTable();
}
function setApptFilter(f, el) { apptFilter = f; document.querySelectorAll('.subnav button').forEach(b => b.classList.remove('active')); el.classList.add('active'); renderApptTable(); }
function renderApptTable() {
  const db = loadDB(), q = (document.getElementById('apptSearch')?.value || '').toLowerCase();
  let rows = [...db.appointments].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  if (apptFilter !== 'all') rows = rows.filter(r => r.status === apptFilter);
  rows = rows.filter(r => inRange(r.date ? new Date(r.date + 'T00:00:00') : r.createdAt, RANGES.appt));
  if (q) rows = rows.filter(r => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q) || (r.visitId || '').toLowerCase().includes(q));
  document.getElementById('apptBody').innerHTML = rows.length ? rows.map((r, i) => {
    const linkedQ = r.queueId ? db.queues.find(x => x.id === r.queueId) : null;
    return `<tr><td class="row-num">${i + 1}</td>
    <td class="mono">${escapeHtml(r.visitId || '—')}${r.isSenior ? ' <span class="pill pill-gold">Senior</span>' : ''}${r.possibleDuplicate ? ' <span class="pill pill-warn">Dup?</span>' : ''}<div class="muted" style="font-size:.68rem;">${escapeHtml(r.code)}</div></td>
    <td>${escapeHtml(r.name)}<div class="muted" style="font-size:.72rem;">${escapeHtml(r.email || '')}</div></td>
    <td>${escapeHtml(r.service)}</td><td class="mono">${r.date ? r.date : '<span class="muted" style="font-size:.76rem;">Not set</span>'}</td><td class="mono">${r.time ? escapeHtml(r.time) : '&mdash;'}</td>
    <td>${readinessPillHtml(computeReadiness(findService(db, r.service), r.attachments), true)}</td>
    <td>${statusPill(r.status)} ${arrivalStatusPill(r)}</td>
    <td style="white-space:nowrap;">${linkedQ ? `<button class="btn btn-ghost btn-sm" onclick="openQueueVisitDetail('${linkedQ.id}')">View Visit</button>` : `<button class="btn btn-ghost btn-sm" onclick="openApptDetail('${r.id}')">Manage</button>`}</td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="9">No scheduled visits.</td></tr>`;
}
function appointmentPassText(appt, svc) {
  const line = '='.repeat(40), thin = '-'.repeat(40);
  const reqs = svc && svc.requirements && svc.requirements.length ? svc.requirements.map(r => `  [ ] ${r}`).join('\n') : '  None required';
  return [
    'POLYTECHNIC UNIVERSITY OF THE PHILIPPINES',
    'Santa Maria Campus · Office of Student Services',
    line,
    'SCHEDULED VISIT PASS',
    line,
    `VISIT ID:   ${appt.visitId || ''}`,
    thin,
    `Service:    ${appt.service}`,
    `Visitor:    ${appt.name}`,
    `Type:       ${appt.guestClass ? `${appt.type} (${appt.guestClass})` : appt.type}${appt.isSenior ? ' · Senior (priority)' : ''}`,
    `Date:       ${appt.date}`,
    `Time:       ${appt.time}`,
    `Reference:  ${appt.code}`,
    `Entry:      Scheduled appointment`,
    thin,
    'WHAT TO BRING',
    reqs,
    thin,
    'NO QUEUE NUMBER IS ISSUED for scheduled visits.',
    'Show your Visit ID at the OSS front desk and check in. You will be',
    'called when your scheduled time arrives, ahead of walk-ins.',
    '',
    'Check your status anytime under "Check My Visit" with your Visit ID.',
    '',
    '— Office of Student Services',
  ].join('\n');
}
function mailtoForAppt(appt) {
  const db = loadDB(), svc = findService(db, appt.service);
  const subject = appt.date ? `Your OSS visit pass ${appt.visitId} — ${appt.date} ${appt.time}` : `Your OSS appointment request ${appt.visitId} — received`;
  const body = appt.date
    ? `Hi ${appt.name},\n\nYour appointment has been scheduled. Here is your pass:\n\n${appointmentPassText(appt, svc)}`
    : `Hi ${appt.name},\n\nWe've received your appointment request for ${appt.service} (Visit ID ${appt.visitId}). We'll email your pass once a date and time is assigned.\n\n— Office of Student Services`;
  return `mailto:${encodeURIComponent(appt.email || '')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
function openApptDetail(id) {
  const db = loadDB(), r = db.appointments.find(x => x.id === id);
  if (!r) return;
  const inQueue = !!r.queueId, canSetSchedule = !inQueue && !['Cancelled', 'No-show'].includes(r.status), canCheckIn = !inQueue && (r.status === 'Booked' || r.status === 'Requested');
  const readiness = computeReadiness(findService(db, r.service), r.attachments), arrival = canCheckIn ? evaluateArrival(db, r) : null;
  openModal(escapeHtml(r.visitId || r.code), `
    ${r.possibleDuplicate ? `<div class="dup-warn">${icon('alert', 13)} Flagged as a possible duplicate active visit for this ID number or Gmail and service.</div>` : ''}
    ${arrival && arrival.status !== 'OnTime' ? `<div class="alert-banner ${arrival.status === 'PastWindow' ? 'danger' : 'warn'}"><b>${icon('alert', 13)} ${arrival.status === 'PastWindow' ? 'Past Appointment Window' : 'Late Arrival'}</b>Scheduled time has passed by ${fmtMinutes(arrival.lateMinutes)}${arrival.status === 'PastWindow' ? ' — beyond the configured no-show threshold.' : ', still within the no-show threshold.'}</div>` : ''}
    <div class="kv"><span>Visit ID</span><span class="mono">${escapeHtml(r.visitId || '—')}</span></div>
    <div class="kv"><span>Reference Code</span><span class="mono">${escapeHtml(r.code)}</span></div>
    <div class="kv"><span>Requestor</span><span>${escapeHtml(r.name)} (${escapeHtml(r.guestClass ? `${r.type}, ${r.guestClass}` : r.type)})</span></div>
    ${r.idNumber ? `<div class="kv"><span>${r.idType ? escapeHtml(r.idType) : 'ID Number'}</span><span>${escapeHtml(r.idNumber)}</span></div>` : `<div class="kv"><span>ID Type</span><span>${escapeHtml(r.idType || '—')}</span></div>`}
    <div class="kv"><span>Contact</span><span>${escapeHtml(r.contact || '—')}</span></div>
    <div class="kv"><span>Email</span><span>${escapeHtml(r.email || '—')}</span></div>
    <div class="kv"><span>Service</span><span>${escapeHtml(r.service)}</span></div>
    <div class="kv"><span>Appointment</span><span>${r.date ? `${r.date} &middot; ${escapeHtml(r.time || '')}` : 'Not yet set'}</span></div>
    <div class="kv"><span>Readiness</span><span>${readinessPillHtml(readiness)}</span></div>
    <div class="kv"><span>Status</span><span>${statusPill(r.status)} ${arrivalStatusPill(r)}</span></div>
    <div class="kv"><span>Requested</span><span>${r.createdAt ? fmtDateTime(r.createdAt) : '&mdash;'}</span></div>
    ${r.isSenior ? `<div class="kv"><span>Priority</span><span><span class="pill pill-gold">Senior Citizen</span></span></div>` : ''}
    <div class="divider"></div>
    <div class="field"><label>Uploaded Requirements</label>${attachListHtml(r.attachments)}</div>
    ${canCheckIn ? `<div class="field"><button class="btn btn-gold btn-block" onclick="adminCheckInAppointment('${r.id}')">${icon('checkin', 14)} Check In &amp; Add to Queue</button>
      <div class="field-hint">No queue number is issued. The visit waits in the queue ordered by its scheduled time and can be called once that time arrives. The Visitor Log check-in happens when you begin service.</div></div>` : ''}
    ${canSetSchedule ? `<div class="form-row">
      <div class="field"><label>Date</label><input id="mApptDate" type="date" value="${r.date || ''}" min="${today()}"></div>
      <div class="field"><label>Time</label><input id="mApptTime" type="time" value="${r.time ? '' : '09:00'}"></div></div>
      <p class="field-hint" style="margin-bottom:0;">Setting a date &amp; time marks this visit as Booked and prepares an email with the visitor's pass.</p>` : ''}`, [
    { label: 'Email Pass', cls: 'btn-ghost', action: () => { if (!r.email) { toast('No email on file for this request.', 'err'); return; } window.open(mailtoForAppt(r), '_blank'); } },
    ...(canSetSchedule ? [{ label: 'Save Date & Time', cls: 'btn-primary', action: () => {
      const dateVal = document.getElementById('mApptDate').value, timeVal = document.getElementById('mApptTime').value;
      if (!dateVal || !timeVal) { toast('Please set both a date and a time.', 'err'); return; }
      const [h, m] = timeVal.split(':').map(Number), db2 = loadDB(), r2 = db2.appointments.find(x => x.id === id);
      r2.date = dateVal; r2.time = `${h % 12 || 12}:${pad2(m)} ${h >= 12 ? 'PM' : 'AM'}`; r2.status = 'Booked';
      logActivity(db2, currentUser, `Set appointment ${r2.code} to ${r2.date} ${r2.time}`);
      saveDB(db2);
      closeModal(); renderApptTable(); toast('Visit booked. Opening email with the visitor\'s pass.', 'ok');
      if (r2.email) window.open(mailtoForAppt(r2), '_blank');
    } }] : [])]);
}

const RANGES = { log: { from: today(), to: today() }, appt: { from: '', to: '' }, txn: { from: '', to: '' }, fb: { from: '', to: '' } };
function inRange(d, r) { if (!d) return !r.from && !r.to; const k = fmtDate(d); return (!r.from || k >= r.from) && (!r.to || k <= r.to); }
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
  ({ log: () => renderVisitorLogbook(true), appt: () => renderAppointments(true), txn: () => renderTxnCard(true), fb: renderFeedback })[which]();
}

function queueNumberForVisit(db, visitId) {
  const q = visitId ? db.queues.find(x => x.visitId === visitId && x.number) : null;
  return q ? q.number : '';
}
function logEmail(db, r) {
  if (r.email) return r.email;
  const q = db.queues.find(x => x.visitId && x.visitId === r.visitId);
  return (q && q.email) || '';
}
function logContact(db, r) {
  if (r.contact) return r.contact;
  const q = db.queues.find(x => x.visitId && x.visitId === r.visitId);
  return (q && q.contact) || '';
}
function renderVisitorLogbook(keep) {
  const db = loadDB(), prev = keep ? (document.getElementById('logSearch')?.value || '') : '';
  const rows = logbookRows(db, false), inside = rows.filter(r => !r.timeOut).length;
  document.getElementById('content').innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="lbl">Logged</div><div class="val">${rows.length}</div></div>
      <div class="stat-card"><div class="lbl">Currently Inside</div><div class="val">${inside}</div></div>
      <div class="stat-card"><div class="lbl">Checked Out</div><div class="val">${rows.length - inside}</div></div>
    </div>
    <div class="card"><div class="card-head"><div><h3>Visitor Log</h3><div class="desc">${escapeHtml(rangeLabel(RANGES.log))}</div></div>
      <div class="toolbar"><button class="btn btn-primary btn-sm" onclick="printVisitorLog()">${icon('print', 14)} Print Report</button>
        <button class="btn btn-ghost btn-sm" onclick="downloadLogbook()">${icon('download', 14)} Download CSV</button></div></div>
      <div class="filter-bar">${dateRangeHtml('log')}<div class="search-box">${icon('search', 15)}<input id="logSearch" placeholder="Name, ID or Gmail" value="${escapeHtml(prev)}" oninput="renderLogbookTable()"></div></div>
      <div class="table-wrap"><table><thead><tr><th>#</th><th>Name</th><th>Type</th><th>Entry Method</th><th>ID Number</th><th>Contact</th><th>Gmail</th><th>Purpose</th><th>Time In</th><th>Time Out</th><th>Queue Status</th></tr></thead><tbody id="logBody"></tbody></table></div></div>`;
  renderLogbookTable();
}
function logbookRows(db, ascending) {
  return [...db.visitorLog].sort((a, b) => ascending ? a.timeIn - b.timeIn : b.timeIn - a.timeIn).filter(r => inRange(r.timeIn, RANGES.log));
}
function renderLogbookTable() {
  const db = loadDB(), q = (document.getElementById('logSearch')?.value || '').toLowerCase();
  let rows = logbookRows(db, false);
  if (q) rows = rows.filter(r => r.name.toLowerCase().includes(q) || (r.idNumber || '').toLowerCase().includes(q) || logEmail(db, r).toLowerCase().includes(q));
  document.getElementById('logBody').innerHTML = rows.length ? rows.map((r, i) => `<tr><td class="row-num">${i + 1}</td>
    <td>${escapeHtml(r.name)}${r.visitId ? `<div class="muted mono" style="font-size:.68rem;">${escapeHtml(r.visitId)}</div>` : ''}</td><td>${escapeHtml(r.type)}</td>
    <td>${r.source === 'Appointment' ? '<span class="pill pill-info">Scheduled</span>' : '<span class="pill pill-gold">Walk-in</span>'}</td>
    <td class="mono">${r.idNumber ? escapeHtml(r.idNumber) : '&mdash;'}</td><td class="mono">${logContact(db, r) ? escapeHtml(logContact(db, r)) : '&mdash;'}</td><td class="mono" style="overflow-wrap:anywhere;">${logEmail(db, r) ? escapeHtml(logEmail(db, r)) : '&mdash;'}</td><td>${r.purpose ? escapeHtml(r.purpose) : '&mdash;'}</td>
    <td class="mono">${fmtDateTime(r.timeIn)}</td><td class="mono">${r.timeOut ? fmtDateTime(r.timeOut) : '&mdash;'}</td>
    <td>${queueStatusPillForLog(activeQueueForVisit(db, r.visitId))}</td></tr>`).join('') : `<tr class="empty-row"><td colspan="11">No visitor entries logged.</td></tr>`;
}
function downloadLogbook() {
  const db = loadDB(), rows = logbookRows(db, true);
  downloadCSV(`Visitor_Logbook_${RANGES.log.from || 'start'}_${RANGES.log.to || 'all'}.csv`, [
    ['Visit ID', 'Name', 'Type', 'ID Number', 'Contact', 'Gmail', 'Queue No.', 'Entry Method', 'Purpose', 'Date', 'Time In', 'Time Out', 'Status'],
    ...rows.map(r => [r.visitId || '', r.name, r.type, r.idNumber || '', logContact(db, r), logEmail(db, r), queueNumberForVisit(db, r.visitId), r.source || 'Walk-in', r.purpose || '', fmtDate(r.timeIn), fmtTime(r.timeIn), r.timeOut ? fmtTime(r.timeOut) : '', r.timeOut ? 'Checked Out' : 'Checked In']),
  ]);
  logActivity(db, currentUser, 'Downloaded visitor log'); saveDB(db);
  toast('Logbook downloaded.', 'ok');
}
function printVisitorLog() {
  const db = loadDB(), rows = logbookRows(db, true);
  const period = escapeHtml(rangeLabel(RANGES.log));
  const total = rows.length, inside = rows.filter(r => !r.timeOut).length, appts = rows.filter(r => r.source === 'Appointment').length;
  printInjected(`${reportLetterhead()}
    <div class="report-title-block"><h2>Visitor Logbook Report</h2><div class="report-meta"><span>Period: ${period}</span><span>Generated: ${fmtDateTime(new Date())} by ${escapeHtml(currentUser.fullName)}</span></div></div>
    <div class="rpt-section"><h3 class="rpt-h">Summary</h3><div class="stat-grid rpt-stat-grid">
      <div class="rpt-stat"><div class="rpt-stat-lbl">Total Entries</div><div class="rpt-stat-val">${total}</div></div>
      <div class="rpt-stat"><div class="rpt-stat-lbl">Currently Inside</div><div class="rpt-stat-val">${inside}</div></div>
      <div class="rpt-stat"><div class="rpt-stat-lbl">Checked Out</div><div class="rpt-stat-val">${total - inside}</div></div>
      <div class="rpt-stat"><div class="rpt-stat-lbl">Walk-in / Sched.</div><div class="rpt-stat-val" style="font-size:1.15rem;">${total - appts} / ${appts}</div></div></div></div>
    <div class="rpt-section"><h3 class="rpt-h">Visitor Entries</h3><div class="rpt-desc">${total} record${total === 1 ? '' : 's'} &mdash; ${period}, sorted by Time In</div>
      <div class="rpt-table-wrap"><table class="rpt-table">
        <colgroup><col style="width:3%"><col style="width:9%"><col style="width:10%"><col style="width:6%"><col style="width:8%"><col style="width:8%"><col style="width:12%"><col style="width:5%"><col style="width:6%"><col style="width:9%"><col style="width:9%"><col style="width:7%"><col style="width:8%"></colgroup>
        <thead><tr><th>#</th><th>Visit ID</th><th>Name</th><th>Type</th><th>ID Number</th><th>Contact</th><th>Gmail</th><th>Queue No.</th><th>Entry</th><th>Purpose</th><th>Time In</th><th>Time Out</th><th>Status</th></tr></thead>
        <tbody>${rows.length ? rows.map((r, i) => `<tr><td class="mono">${i + 1}</td><td class="mono">${escapeHtml(r.visitId || '—')}</td><td>${escapeHtml(r.name)}</td><td class="nw">${escapeHtml(r.type || '—')}</td><td class="mono">${r.idNumber ? escapeHtml(r.idNumber) : '&mdash;'}</td><td class="mono">${logContact(db, r) ? escapeHtml(logContact(db, r)) : '&mdash;'}</td><td class="mono" style="overflow-wrap:anywhere;">${logEmail(db, r) ? escapeHtml(logEmail(db, r)) : '&mdash;'}</td><td class="mono nw">${escapeHtml(queueNumberForVisit(db, r.visitId) || '—')}</td><td class="nw">${r.source === 'Appointment' ? 'Scheduled' : 'Walk-in'}</td><td>${r.purpose ? escapeHtml(r.purpose) : '&mdash;'}</td><td class="mono nw">${fmtDate(r.timeIn)}<br>${fmtTime(r.timeIn)}</td><td class="mono nw">${r.timeOut ? fmtTime(r.timeOut) : '&mdash;'}</td><td>${r.timeOut ? 'Checked Out' : 'Checked In'}</td></tr>`).join('') : `<tr class="empty-row"><td colspan="13">No visitor entries recorded for this period.</td></tr>`}</tbody></table></div></div>
    ${reportSignatureBlock()}`);
}

let activeStaffChatId = null, pendingStaffAttachments = [], messagesPollTimer = null;
function renderMessages() {
  document.getElementById('content').innerHTML = `<div class="card"><div class="card-head"><div><h3>Messages</h3></div></div>
    <div class="chat-shell"><div class="chat-thread-list" id="chatThreadList"><div class="thread-list-head"><span class="lbl">Conversations</span><button class="btn btn-gold btn-sm" onclick="openNewChatModal()">${icon('plus', 13)} New Chat</button></div><div class="thread-search"><input id="chatCodeSearch" placeholder="Search Visit ID or name" autocomplete="off" oninput="renderChatThreadList()" onkeydown="if(event.key==='Enter') openChatByCode()"></div><div id="chatThreadBody"></div></div><div class="chat-panel" id="chatPanel">${emptyChatPanel()}</div></div></div>`;
  renderChatThreadList();
  startMessagesPolling();
}
function emptyChatPanel() { return `<div class="helper-empty" style="padding:80px 20px;">${icon('chat', 34)}<p>Select a conversation to view messages.</p></div>`; }
function copyText(t) {
  const ok = () => toast('Copied.', 'ok'), bad = () => toast('Could not copy.', 'err');
  if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t).then(ok, bad); return; }
  const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); ok(); } catch (e) { bad(); }
  ta.remove();
}
function findVisitByRef(db, ref) {
  ref = normVisitRef(ref);
  if (!ref) return null;
  return db.queues.find(q => (q.visitId || '').toUpperCase() === ref) || db.appointments.find(a => (a.visitId || '').toUpperCase() === ref) || null;
}
const chatRef = c => c.visitId || 'No Visit ID';
function renderChatThreadList() {
  const db = loadDB(), body = document.getElementById('chatThreadBody');
  if (!body) return;
  const q = (document.getElementById('chatCodeSearch')?.value || '').trim().toLowerCase();
  let rows = [...db.chats].sort((a, b) => b.updatedAt - a.updatedAt);
  if (q) rows = rows.filter(c => [c.visitId, c.visitorName].some(v => String(v || '').toLowerCase().includes(q)));
  body.innerHTML = rows.length ? rows.map(c => {
    const last = c.messages[c.messages.length - 1];
    return `<div class="chat-thread-item ${activeStaffChatId === c.id ? 'active' : ''}" style="cursor:pointer;" onclick="openStaffChat('${c.id}')">
      <div class="ttl"><span class="mono">${escapeHtml(chatRef(c))}</span><span class="thread-actions">${c.staffUnread ? '<span class="unread-dot"></span>' : ''}<button class="icon-btn" title="Delete conversation" onclick="event.stopPropagation(); removeChatThread('${c.id}')">${icon('trash', 13)}</button></span></div>
      <div class="muted" style="font-size:.74rem; margin-top:2px;">${escapeHtml(c.visitorName || 'Visitor')}</div>
      <div class="prev">${last ? escapeHtml(last.text) : 'No messages yet'}</div>
      <div class="meta-row"><span></span>${statusPill(c.status)}</div></div>`;
  }).join('') : `<div class="helper-empty" style="padding:40px 16px;"><p>${q ? 'No conversation matches.' : 'No conversations yet.'}</p></div>`;
}
function openChatByCode() {
  const q = normVisitRef(document.getElementById('chatCodeSearch')?.value || '');
  const c = q ? loadDB().chats.filter(x => (x.visitId || '').toUpperCase() === q).sort((a, b) => b.updatedAt - a.updatedAt)[0] : null;
  if (!c) { toast('No conversation with that Visit ID.', 'err'); return; }
  openStaffChat(c.id);
}
function openNewChatModal() {
  openModal('Start New Chat', `
    <p class="field-hint" style="margin-bottom:12px;">Every chat belongs to a visit. Enter the visitor's Visit ID &mdash; they open the same chat in the portal with that Visit ID.</p>
    <div class="field"><label>Visit ID <span class="req">*</span></label><input id="mChatVisit" placeholder="VIS-K7M2-9QXA" style="text-transform:uppercase"></div>
    <div class="field"><label>Visitor name <span class="muted" style="font-weight:400;">(optional)</span></label><input id="mChatName" placeholder="e.g. Juan Dela Cruz"></div>
    <div class="field"><label>Contact <span class="muted" style="font-weight:400;">(optional)</span></label><input id="mChatContact" placeholder="Email or phone number"></div>`, [
    { label: 'Cancel', cls: 'btn-ghost', action: closeModal },
    { label: 'Start Chat', cls: 'btn-primary', action: () => {
      const db = loadDB(), ref = normVisitRef(document.getElementById('mChatVisit').value), src = findVisitByRef(db, ref);
      if (!ref) { toast('Enter the visitor\'s Visit ID.', 'err'); return; }
      if (!src) { toast('No visit found with that Visit ID.', 'err'); return; }
      const existing = db.chats.find(x => x.visitId === src.visitId && x.status === 'Open');
      if (existing) { closeModal(); openStaffChat(existing.id); toast(`${existing.visitId} already has an open conversation.`, 'ok'); return; }
      const chat = mkChat({
        visitorName: document.getElementById('mChatName').value.trim() || (src && src.name) || 'Visitor',
        visitorType: src ? (src.visitorType || src.type || '') : '',
        contact: document.getElementById('mChatContact').value.trim() || (src && src.contact) || '',
        visitId: src.visitId,
      });
      db.chats.push(chat);
      logActivity(db, currentUser, `Started a new conversation for ${chat.visitId}`);
      saveDB(db); closeModal(); renderChatThreadList(); openStaffChat(chat.id); toast(`Conversation started &mdash; ${chat.visitId}.`, 'ok');
    } }]);
}
function removeChatThread(id) {
  if (!confirm('Delete this conversation? This cannot be undone.')) return;
  const db = loadDB(), c = db.chats.find(x => x.id === id);
  db.chats = db.chats.filter(x => x.id !== id);
  if (c) logActivity(db, currentUser, `Deleted conversation with ${c.visitorName}`);
  saveDB(db);
  if (activeStaffChatId === id) { activeStaffChatId = null; const p = document.getElementById('chatPanel'); if (p) p.innerHTML = emptyChatPanel(); }
  renderChatThreadList(); renderSidebar(); toast('Conversation deleted.', 'ok');
}
function openStaffChat(id) {
  activeStaffChatId = id; pendingStaffAttachments = [];
  const db = loadDB(), c = db.chats.find(x => x.id === id);
  if (!c) return;
  c.staffUnread = 0; saveDB(db);
  renderChatThreadList(); renderSidebar();
  const closed = c.status === 'Closed';
  document.getElementById('chatPanel').innerHTML = `
    <div class="chat-panel-head"><div><div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;"><b class="mono" style="font-size:.92rem;">${escapeHtml(chatRef(c))}</b>${c.visitId ? `<button class="btn btn-ghost btn-sm" onclick="copyText('${escapeHtml(c.visitId)}')">Copy Visit ID</button>` : ''}</div>
      <div class="muted" style="font-size:.76rem; margin-top:3px;">${escapeHtml(c.visitorName || 'Visitor')}${c.visitorType ? ' &middot; ' + escapeHtml(c.visitorType) : ''}${c.contact ? ' &middot; ' + escapeHtml(c.contact) : ''}</div>
      ${c.messages.some(m => m.sender === 'visitor') ? '' : `<div class="field-hint" style="margin-top:4px;">The visitor opens this chat in the portal with their Visit ID.</div>`}</div>
      <div class="chat-status-toggle"><button class="cst-btn ok ${c.status === 'Open' ? 'active' : ''}" onclick="setChatStatus('${c.id}','Open')">${icon('check', 12)}<span>Open</span></button><button class="cst-btn danger ${closed ? 'active' : ''}" onclick="setChatStatus('${c.id}','Closed')">${icon('x', 12)}<span>Closed</span></button></div></div>
    <div class="chat-messages" id="chatMsgArea">${renderBubbles(c)}</div>
    <div id="staffAttachPreview" style="padding:${closed ? '0' : '10px 18px 0'};"></div>
    <div class="chat-input-row">
      <input type="file" id="staffAttachInput" multiple style="display:none" onchange="handleStaffFileSelect(this)" ${closed ? 'disabled' : ''}>
      <button class="icon-btn" title="Attach files" onclick="document.getElementById('staffAttachInput').click()" ${closed ? 'disabled' : ''}>${icon('paperclip', 16)}</button>
      <textarea id="staffReplyBox" placeholder="${closed ? 'Conversation is closed' : 'Type a reply...'}" ${closed ? 'disabled' : ''}></textarea>
      <button class="btn btn-primary" onclick="sendStaffReply('${c.id}')" ${closed ? 'disabled' : ''}>Send</button></div>`;
  const area = document.getElementById('chatMsgArea');
  if (area) area.scrollTop = area.scrollHeight;
}
function renderBubbles(c) {
  if (!c.messages.length) return `<div class="muted" style="font-size:.8rem; padding:10px;">No messages yet.</div>`;
  return c.messages.map(m => `<div class="bubble ${m.sender}"><div class="who">${escapeHtml(m.senderName || (m.sender === 'staff' ? 'OSS Staff' : 'Visitor'))}</div><div>${escapeHtml(m.text)}</div>${m.attachments && m.attachments.length ? `<div class="attach-list">${m.attachments.map(attachChip).join('')}</div>` : ''}<div class="ts">${fmtDateTime(m.ts)}</div></div>`).join('');
}
function renderStaffAttachPreview() {
  const w = document.getElementById('staffAttachPreview');
  if (w) w.innerHTML = pendingStaffAttachments.map((a, i) => `<span class="attach-preview-chip">${icon('paperclip', 11)}<span class="fname">${escapeHtml(a.name)}</span><span class="fsize">${fmtFileSize(a.size)}</span><button onclick="removeStaffAttachment(${i})" title="Remove">${icon('x', 11)}</button></span>`).join('');
}
async function handleStaffFileSelect(el) {
  if (!el.files || !el.files.length) return;
  pendingStaffAttachments.push(...await readFilesAsAttachments(el.files));
  el.value = ''; renderStaffAttachPreview();
}
function removeStaffAttachment(i) { pendingStaffAttachments.splice(i, 1); renderStaffAttachPreview(); }
function sendStaffReply(id) {
  const db = loadDB(), c = db.chats.find(x => x.id === id), text = document.getElementById('staffReplyBox').value.trim();
  if (!c || (!text && !pendingStaffAttachments.length)) return;
  c.messages.push({ id: uid('MSG'), sender: 'staff', senderName: currentUser.fullName, text, ts: new Date(), attachments: pendingStaffAttachments.length ? [...pendingStaffAttachments] : undefined });
  c.visitorUnread = (c.visitorUnread || 0) + 1; c.updatedAt = new Date();
  logActivity(db, currentUser, `Replied to chat ${chatRef(c)} (${c.visitorName})`);
  saveDB(db); pendingStaffAttachments = []; openStaffChat(id);
}
function setChatStatus(id, status) {
  const db = loadDB(), c = db.chats.find(x => x.id === id);
  c.status = status; c.updatedAt = new Date();
  logActivity(db, currentUser, `Marked chat ${chatRef(c)} as ${status}`);
  saveDB(db); renderChatThreadList(); openStaffChat(id);
}
function startMessagesPolling() {
  stopMessagesPolling();
  messagesPollTimer = setInterval(() => {
    if (state_view !== 'messages') return;
    renderChatThreadList();
    if (activeStaffChatId) {
      const c = loadDB().chats.find(x => x.id === activeStaffChatId), area = document.getElementById('chatMsgArea');
      if (c && area && c.messages.length !== area.querySelectorAll('.bubble').length) { area.innerHTML = renderBubbles(c); area.scrollTop = area.scrollHeight; }
    }
  }, 4000);
}
function stopMessagesPolling() { if (messagesPollTimer) { clearInterval(messagesPollTimer); messagesPollTimer = null; } }

const CONFIDENTIAL_SERVICES = ['incident_report', 'concern', 'scholarship_txn', 'excuse_letter'];
const CONF_UNLOCK_MS = 5 * 60 * 1000;
const CONF_REASONS = ['Case review', 'Requested by the student / requestor', 'Audit or compliance', 'Official referral or endorsement', 'Other (explain in note)'];
const confUnlocked = new Map(), confTimers = {};
function isConfidentialTxn(t) { return !!t && CONFIDENTIAL_SERVICES.includes(t.service); }
function hasConfAccess(db) { const u = (db || loadDB()).users.find(x => x.id === currentUser.id); return !!(u && u.confidentialAccess); }
function isTxnLocked(t) {
  if (!isConfidentialTxn(t)) return false;
  const exp = confUnlocked.get(t.id);
  if (exp && exp > Date.now()) return false;
  if (exp) confUnlocked.delete(t.id);
  return true;
}
function lockConfTxn(id) {
  confUnlocked.delete(id);
  if (confTimers[id]) { clearTimeout(confTimers[id]); delete confTimers[id]; }
  const m = document.getElementById('activeModal');
  if (m && m.dataset.conf === id) closeModal();
  if (state_view === 'transactions') renderTxnTable();
  if (state_view === 'dashboard') renderDashboard();
}
function maskName(name) {
  const p = String(name || '').trim().split(/\s+/).filter(Boolean);
  return p.length < 2 ? (p[0] || '—') : `${p[0]} ${p[p.length - 1][0].toUpperCase()}.`;
}
function requireConfUnlock(r, onOk) {
  if (!isTxnLocked(r)) { onOk(); return; }
  const db = loadDB();
  if (!hasConfAccess(db)) {
    logActivity(db, currentUser, `Blocked: tried to open confidential record ${r.code} without access`);
    saveDB(db);
    openModal(`${escapeHtml(r.code)} ${icon('lock', 13)}`, `<div class="alert-banner warn"><div><b>Restricted record</b>This record is confidential and your account does not have Confidential access. Ask a Super Admin if you need it.</div></div>`, []);
    return;
  }
  openModal(`Unlock ${escapeHtml(r.code)}`, `
    <p class="field-hint" style="margin-bottom:12px;">${icon('lock', 11)} This record is confidential. Confirm it is you, then state why you need it. Your name, the reason and the time are saved in the Activity Log, and access closes automatically after 5 minutes.</p>
    <div class="field"><label>Your password</label><input id="mConfPass" type="password" autocomplete="current-password" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;"></div>
    <div class="field"><label>Reason for access</label><select id="mConfReason">${CONF_REASONS.map(x => `<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join('')}</select></div>
    <div class="field"><label>Note</label><textarea id="mConfNote" maxlength="200" placeholder="Short explanation, e.g. reviewing complaint filed on this record"></textarea></div>`, [
    { label: 'Cancel', cls: 'btn-ghost', action: closeModal },
    { label: 'Unlock', cls: 'btn-primary', action: () => {
      const pass = document.getElementById('mConfPass').value, reason = document.getElementById('mConfReason').value, note = document.getElementById('mConfNote').value.trim();
      if (!pass) { toast('Enter your password to continue.', 'err'); return; }
      if (note.length < 5) { toast('Add a short note explaining why you need this record.', 'err'); return; }
      const db2 = loadDB(), me = db2.users.find(x => x.id === currentUser.id);
      if (!me || !me.confidentialAccess) { toast('Your Confidential access was removed.', 'err'); closeModal(); return; }
      if (me.password !== pass) { logActivity(db2, currentUser, `Failed unlock attempt on confidential record ${r.code} &mdash; wrong password`); saveDB(db2); toast('Incorrect password.', 'err'); return; }
      logActivity(db2, currentUser, `Unlocked confidential record ${r.code} &mdash; Reason: ${escapeHtml(reason)} &mdash; Note: ${escapeHtml(note)}`);
      saveDB(db2);
      confUnlocked.set(r.id, Date.now() + CONF_UNLOCK_MS);
      if (confTimers[r.id]) clearTimeout(confTimers[r.id]);
      confTimers[r.id] = setTimeout(() => { lockConfTxn(r.id); toast(`${r.code} locked again (5 minutes passed).`, 'ok'); }, CONF_UNLOCK_MS);
      closeModal();
      if (state_view === 'transactions') renderTxnTable();
      onOk();
    } }]);
}

let txnFilter = 'all';
const TXN_STATUSES = ['Pending', 'Processing', 'Approved', 'Completed'];
const ESCALATABLE_SERVICES = ['incident_report', 'concern'];
function txnRequirements(db, t) {
  if (t.attachments && t.attachments.length) return t.attachments;
  const a = t.appointmentId ? db.appointments.find(x => x.id === t.appointmentId) : null;
  return (a && a.attachments) || [];
}
function escalationPill(status) {
  if (!status || status === 'Normal') return '';
  return `<span class="pill ${{ 'For Review': 'pill-warn', Escalated: 'pill-danger', Resolved: 'pill-ok' }[status] || 'pill-info'}">${escapeHtml(status)}</span>`;
}
function txnScope(db) { return db.transactions.filter(t => (!txnServiceFilter || t.service === txnServiceFilter) && inRange(t.createdAt, RANGES.txn)); }
function serviceSelectOptions(db) {
  const counts = {}; db.services.forEach(s => counts[s.key] = 0);
  db.transactions.forEach(t => { counts[t.service] = (counts[t.service] || 0) + 1; });
  return `<option value="">All Transactions (${db.transactions.length})</option>` + db.services.map(s => `<option value="${s.key}" ${txnServiceFilter === s.key ? 'selected' : ''}>${escapeHtml(s.label)} (${counts[s.key] || 0})</option>`).join('');
}
function renderTransactions() { txnFilter = 'all'; renderTxnCard(false); }
function renderTxnCard(keepSearch) {
  const db = loadDB(), prev = keepSearch ? (document.getElementById('txnSearch')?.value || '') : '';
  const svc = txnServiceFilter ? findService(db, txnServiceFilter) : null, scope = txnScope(db);
  const tabs = [['all', 'All', scope.length], ...TXN_STATUSES.map(s => [s, s, scope.filter(t => t.status === s).length])];
  const title = txnServiceFilter ? serviceLabel(db, txnServiceFilter) : 'All Transactions';
  document.getElementById('content').innerHTML = `
    <div class="card"><div class="card-head"><div><h3>${escapeHtml(title)}</h3><div class="desc">${svc && svc.desc ? escapeHtml(svc.desc) : 'Every service record logged by the office, newest first.'}</div></div>
      <div class="toolbar"><button class="btn btn-primary btn-sm" onclick="printTxnReport(txnServiceFilter || null, 'txn')" title="Print a report of ${escapeHtml(title)} for the selected dates">${icon('print', 14)} Print ${txnServiceFilter ? 'Service' : 'Transactions'} Report</button></div></div>
      <div class="filter-bar">${dateRangeHtml('txn')}<select id="txnSvcSelect" class="filter-select" aria-label="Service" onchange="setTxnService(this.value || null)">${serviceSelectOptions(db)}</select>
        <div class="search-box">${icon('search', 15)}<input id="txnSearch" placeholder="Name, code or visit ID" value="${escapeHtml(prev)}" oninput="renderTxnTable()"></div></div>
      <div class="subnav tab-row" id="txnStatusNav">${tabs.map(([f, label, n]) => `<button data-f="${f}" class="${txnFilter === f ? 'active' : ''}" onclick="setTxnFilter('${f}')">${label}<span class="cnt">${n}</span></button>`).join('')}</div>
      <div class="table-wrap"><table><thead><tr><th>#</th><th>Code</th><th>Requestor</th>${txnServiceFilter ? '' : '<th>Service</th>'}<th>Visit</th><th>Files</th><th>Status</th><th>Logged</th><th></th></tr></thead><tbody id="txnBody"></tbody></table></div></div>`;
  renderTxnTable();
}
function setTxnService(key) { txnServiceFilter = key || undefined; txnFilter = 'all'; renderTxnCard(true); }
function setTxnFilter(f) { txnFilter = f; document.querySelectorAll('#txnStatusNav button').forEach(b => b.classList.toggle('active', b.dataset.f === f)); renderTxnTable(); }
function renderTxnTable() {
  const db = loadDB(), q = (document.getElementById('txnSearch')?.value || '').toLowerCase(), showService = !txnServiceFilter;
  let rows = [...txnScope(db)].sort((a, b) => b.createdAt - a.createdAt);
  if (txnFilter !== 'all') rows = rows.filter(r => r.status === txnFilter);
  if (q) rows = rows.filter(r => isTxnLocked(r) ? r.code.toLowerCase().includes(q) : (r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q) || (r.visitId || '').toLowerCase().includes(q)));
  document.getElementById('txnBody').innerHTML = rows.length ? rows.map((r, i) => {
    const locked = isTxnLocked(r), files = txnRequirements(db, r);
    return `<tr><td class="row-num">${i + 1}</td>
    <td class="mono">${r.code}${isConfidentialTxn(r) ? ` <span class="tag-lock">${icon('lock', 10)}</span>` : ''}</td>
    <td>${locked ? `${escapeHtml(maskName(r.name))}<div class="muted" style="font-size:.72rem;">Confidential</div>` : `${escapeHtml(r.name)}<div class="muted" style="font-size:.72rem;">${escapeHtml(r.idNumber || '')} ${r.section ? '&middot; ' + escapeHtml(r.section) : ''}</div>`}</td>
    ${showService ? `<td>${serviceLabel(db, r.service)}</td>` : ''}
    <td>${locked ? '<span class="muted" style="font-size:.76rem;">Hidden</span>' : (r.visitId ? `<span class="mono" style="font-size:.72rem;">${escapeHtml(r.visitId)}</span>${r.queueNumber ? `<div class="muted" style="font-size:.68rem;">${escapeHtml(r.queueNumber)} &middot; ${escapeHtml(r.entryMethod || '')}</div>` : (r.entryMethod ? `<div class="muted" style="font-size:.68rem;">${escapeHtml(r.entryMethod)}</div>` : '')}` : '<span class="muted" style="font-size:.76rem;">&mdash;</span>')}</td>
    <td>${locked ? '<span class="muted" style="font-size:.76rem;">&bull;&bull;</span>' : (files.length ? `<span class="pill pill-gold">${icon('paperclip', 11)} ${files.length}</span>` : '<span class="muted" style="font-size:.76rem;">&mdash;</span>')}</td>
    <td>${statusPill(r.status)} ${escalationPill(r.escalation)}</td><td class="muted">${fmtDateTime(r.createdAt)}</td>
    <td class="act-cell"><button class="icon-btn kebab-btn" title="Actions" aria-haspopup="true" onclick="toggleKebab(event,'${r.id}')">${icon('dots', 16)}</button>
      <div class="kebab-menu" id="kebab_${r.id}" hidden>
        <button class="kebab-item" onclick="closeKebabs(); openTxnDetail('${r.id}')">${locked ? icon('lock', 14) + ' Unlock' : icon('eye', 14) + ' View'}</button>
        <button class="kebab-item" onclick="closeKebabs(); printTransaction('${r.id}')">${icon('print', 14)} Print Report</button></div></td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="${showService ? 9 : 8}">No matching transactions.</td></tr>`;
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
function openTxnDetail(id) {
  const db = loadDB(), r = db.transactions.find(x => x.id === id);
  if (!r) return;
  if (isTxnLocked(r)) { requireConfUnlock(r, () => openTxnDetail(id)); return; }
  const sensitive = isConfidentialTxn(r), linkedQueue = r.queueId ? db.queues.find(x => x.id === r.queueId) : null, linkedAppt = r.appointmentId ? db.appointments.find(x => x.id === r.appointmentId) : null;
  const files = txnRequirements(db, r), isVisit = !!(linkedQueue || r.visitId), canEscalate = ESCALATABLE_SERVICES.includes(r.service);
  const buttons = [
    ...(sensitive ? [{ label: 'Lock Again', cls: 'btn-ghost', action: () => { lockConfTxn(id); toast('Record locked.', 'ok'); } }] : []),
    ...(canEscalate ? [{ label: 'Save', cls: 'btn-primary', action: () => {
      const db2 = loadDB(), r2 = db2.transactions.find(x => x.id === id), esc = document.getElementById('mTxEscalation').value;
      if (esc !== (r2.escalation || 'Normal')) {
        r2.escalation = esc === 'Normal' ? null : esc; r2.escalatedBy = esc === 'Normal' ? null : currentUser.fullName; r2.escalatedAt = esc === 'Normal' ? null : new Date();
        logActivity(db2, currentUser, `Set escalation for ${r2.code} to ${esc}`);
      }
      r2.updatedAt = new Date(); saveDB(db2); closeModal(); renderTxnTable(); toast('Record updated.', 'ok');
    } }] : [])];
  openModal(`${r.code}${sensitive ? ` ${icon('lock', 13)}` : ''}`, `
    ${sensitive ? `<p class="field-hint" style="margin-bottom:12px;">${icon('lock', 11)} This record is confidential &mdash; visible only to admins with Confidential access. It locks again automatically after 5 minutes.</p>` : ''}
    ${r.possibleDuplicate ? `<div class="dup-warn">${icon('alert', 13)} This visit was originally flagged as a possible duplicate active visit.</div>` : ''}
    <div class="kv"><span>Requestor</span><span>${escapeHtml(requestorLabel(r.name, r.type))}</span></div>
    ${r.idNumber ? `<div class="kv"><span>ID Number</span><span>${escapeHtml(r.idNumber)}</span></div>` : ''}
    ${r.section ? `<div class="kv"><span>Section / Org</span><span>${escapeHtml(r.section)}</span></div>` : ''}
    <div class="kv"><span>Service</span><span>${serviceLabel(db, r.service)}</span></div>
    ${!isVisit && r.details ? `<div class="kv"><span>Details</span><span style="max-width:260px; text-align:right;">${escapeHtml(r.details)}</span></div>` : ''}
    <div class="kv"><span>Status</span><span>${statusPill(r.status)}</span></div>
    ${r.escalation && r.escalation !== 'Normal' ? `<div class="kv"><span>Escalation</span><span>${escalationPill(r.escalation)}${r.escalatedBy ? ` <span class="muted" style="font-size:.72rem;">by ${escapeHtml(r.escalatedBy)}</span>` : ''}</span></div>` : ''}
    <div class="kv"><span>Logged</span><span>${fmtDateTime(r.createdAt)}</span></div>
    ${r.completedAt ? `<div class="kv"><span>Completed</span><span class="mono">${fmtDateTime(r.completedAt)}</span></div>` : ''}
    ${r.servedBy ? `<div class="kv"><span>Served By</span><span>${escapeHtml(r.servedBy)}</span></div>` : ''}
    ${r.visitId ? `<div class="kv"><span>Visit ID</span><span class="mono">${escapeHtml(r.visitId)}</span></div>` : ''}
    ${linkedQueue ? `<div class="kv"><span>Entry Method</span><span>${linkedQueue.number ? `<span class="pill pill-info">${escapeHtml(linkedQueue.number)}</span> ` : ''}${escapeHtml(entryMethodLabel(linkedQueue))}</span></div>` : ''}
    ${linkedAppt ? `<div class="kv"><span>Appointment</span><span>${escapeHtml(linkedAppt.code)}${linkedAppt.date ? ` &middot; ${linkedAppt.date} ${escapeHtml(linkedAppt.time || '')}` : ''}</span></div>` : ''}
    ${feedbackReadoutHtml(linkedQueue)}
    ${linkedQueue ? timelineBlockHtml(linkedQueue, linkedAppt) : ''}
    ${r.waitingTimeMin != null || r.serviceTimeMin != null || r.totalTimeMin != null ? timeMetricsGrid(r.waitingTimeMin, r.serviceTimeMin, r.totalTimeMin) : ''}
    <div class="divider"></div>
    <div class="field"><label>Uploaded Requirements</label>${attachListHtml(files)}</div>
    ${canEscalate ? `<div class="field"><label>Escalation</label><select id="mTxEscalation">${['Normal', 'For Review', 'Escalated', 'Resolved'].map(s => `<option value="${s}" ${(r.escalation || 'Normal') === s ? 'selected' : ''}>${s}</option>`).join('')}</select><div class="field-hint">Manually flag this incident/concern for review or escalation. Never set automatically.</div></div>` : ''}`, buttons);
  if (sensitive) { const m = document.getElementById('activeModal'); if (m) m.dataset.conf = id; }
}
function printTransaction(id) {
  const db = loadDB(), r = db.transactions.find(x => x.id === id);
  if (!r) { toast('Transaction not found.', 'err'); return; }
  if (isTxnLocked(r)) { requireConfUnlock(r, () => printTransaction(id)); return; }
  const sensitive = isConfidentialTxn(r), linkedQueue = r.queueId ? db.queues.find(x => x.id === r.queueId) : null, linkedAppt = r.appointmentId ? db.appointments.find(x => x.id === r.appointmentId) : null;
  const files = txnRequirements(db, r), isVisit = !!(linkedQueue || r.visitId), cg = '<colgroup><col style="width:32%"><col style="width:68%"></colgroup>';
  printInjected(`
    ${reportLetterhead()}
    <div class="doc-title-block"><h2>Transaction Report</h2></div>
    <table class="doc-meta-table"><colgroup><col style="width:17%"><col style="width:33%"><col style="width:17%"><col style="width:33%"></colgroup>
      <tr><th>Transaction No.</th><td>${escapeHtml(r.code)}</td><th>Date Generated</th><td>${fmtDateTime(new Date())}</td></tr></table>
    <table class="doc-form-table"><caption>I. Requestor Details</caption>${cg}
      <tr><th>Full Name</th><td>${escapeHtml(r.name)}</td></tr><tr><th>Type</th><td>${escapeHtml(r.type || '—')}</td></tr><tr><th>ID Number</th><td>${escapeHtml(r.idNumber || '—')}</td></tr>
      ${r.section ? `<tr><th>Section / Org</th><td>${escapeHtml(r.section)}</td></tr>` : ''}</table>
    <table class="doc-form-table"><caption>II. Service Details</caption>${cg}
      <tr><th>Service</th><td>${escapeHtml(serviceLabel(db, r.service))}</td></tr>
      ${!isVisit && r.details ? `<tr><th>Details</th><td>${escapeHtml(r.details)}</td></tr>` : ''}
      <tr><th>Status</th><td>${escapeHtml(r.status)}</td></tr>
      ${r.visitId ? `<tr><th>Visit ID</th><td>${escapeHtml(r.visitId)}</td></tr>` : ''}
      ${linkedQueue ? `<tr><th>Entry Method</th><td>${linkedQueue.number ? escapeHtml(linkedQueue.number) + ' ' : ''}(${escapeHtml(entryMethodLabel(linkedQueue))})</td></tr>` : ''}
      ${linkedAppt ? `<tr><th>Appointment</th><td>${escapeHtml(linkedAppt.code)}${linkedAppt.date ? ` &middot; ${linkedAppt.date} ${escapeHtml(linkedAppt.time || '')}` : ''}</td></tr>` : ''}
      <tr><th>Served By</th><td>${escapeHtml(r.servedBy || '—')}</td></tr><tr><th>Logged</th><td>${fmtDateTime(r.createdAt)}</td></tr>
      ${linkedQueue ? timelinePrintRows(linkedQueue, linkedAppt) : ''}
      ${r.completedAt ? `<tr><th>Completed</th><td>${fmtDateTime(r.completedAt)}</td></tr>` : ''}
      ${r.waitingTimeMin != null ? `<tr><th>Waiting Time</th><td>${fmtMinutes(r.waitingTimeMin)}</td></tr>` : ''}
      ${r.serviceTimeMin != null ? `<tr><th>Service Time</th><td>${fmtMinutes(r.serviceTimeMin)}</td></tr>` : ''}
      ${r.totalTimeMin != null ? `<tr><th>Total Visit Time</th><td>${fmtMinutes(r.totalTimeMin)}</td></tr>` : ''}</table>
    <table class="doc-form-table"><caption>III. Uploaded Requirements</caption>${cg}
      ${files.length ? files.map((f, i) => `<tr><th>File ${i + 1}</th><td>${escapeHtml(f.name)} &mdash; ${fmtFileSize(f.size)}</td></tr>`).join('') : `<tr><th>Files</th><td><em>No files were uploaded with this visit.</em></td></tr>`}</table>
    ${reportSignatureBlock('Served by', 'Verified by, Head, Office of Student Services')}
    <p class="doc-footnote">This report was generated by the OSS UniServe system.</p>`);
  const db2 = loadDB();
  logActivity(db2, currentUser, `Printed ${sensitive ? 'confidential ' : ''}transaction report ${r.code}`);
  saveDB(db2);
}

function askIncludeConf(confCount, cb) {
  const db = loadDB(), gate = { id: 'rpt:all', code: 'confidential records', service: 'incident_report' };
  if (!confCount || !hasConfAccess(db)) { cb(false); return; }
  if (!isTxnLocked(gate)) { cb(true); return; }
  openModal('List confidential records by name?', `<p class="field-hint" style="margin:0;">${confCount} record${confCount === 1 ? ' in this report is' : 's in this report are'} confidential and would be counted only. Unlock to list ${confCount === 1 ? 'it' : 'them'} with the visitor's name.</p>`, [
    { label: 'Print without them', cls: 'btn-ghost', action: () => { closeModal(); cb(false); } },
    { label: 'Unlock & include', cls: 'btn-primary', action: () => { closeModal(); requireConfUnlock(gate, () => cb(true)); } }]);
}
function printTxnReport(serviceKey, which, includeConf) {
  const db = loadDB(), range = which === 'txn' ? RANGES.txn : { from: '', to: '' }, svc = serviceKey ? findService(db, serviceKey) : null;
  const title = svc ? svc.label : 'All Services', period = escapeHtml(rangeLabel(range));
  const gated = !!serviceKey && CONFIDENTIAL_SERVICES.includes(serviceKey);
  if (gated) {
    const gate = { id: 'svc:' + serviceKey, code: title, service: serviceKey };
    if (isTxnLocked(gate)) { requireConfUnlock(gate, () => printTxnReport(serviceKey, which)); return; }
  } else if (includeConf === undefined) {
    const n = db.transactions.filter(t => (!serviceKey || t.service === serviceKey) && inRange(t.createdAt, range) && isConfidentialTxn(t)).length;
    askIncludeConf(n, inc => printTxnReport(serviceKey, which, inc)); return;
  }
  const all = db.transactions.filter(t => (!serviceKey || t.service === serviceKey) && inRange(t.createdAt, range)).sort((a, b) => a.createdAt - b.createdAt);
  const listAll = gated || !!includeConf, confCount = listAll ? 0 : all.filter(isConfidentialTxn).length, rows = listAll ? all : all.filter(t => !isConfidentialTxn(t)), total = all.length;
  const ORDER = ['Completed', 'Approved', 'Processing', 'Pending', 'Rejected'], sc = {}; ORDER.forEach(s => sc[s] = 0);
  all.forEach(t => { if (sc[t.status] !== undefined) sc[t.status]++; });
  const pct = n => total ? Math.round(n / total * 100) : 0, rate = pct(sc.Completed);
  const walkIns = all.filter(t => t.entryMethod && t.entryMethod !== 'Scheduled').length, sched = all.filter(t => t.entryMethod === 'Scheduled').length;
  const timed = all.filter(t => t.totalTimeMin != null), avgOf = k => timed.length ? Math.round(timed.reduce((s, t) => s + (t[k] || 0), 0) / timed.length) : null;
  const byService = db.services.map(s => ({ label: s.label, count: all.filter(t => t.service === s.key).length })).filter(r => r.count).sort((a, b) => b.count - a.count);
  const cg = '<colgroup><col style="width:3%"><col style="width:10%"><col style="width:11%"><col style="width:7%"><col style="width:10%"><col style="width:10%"><col style="width:6%"><col style="width:8%"><col style="width:9%"><col style="width:9%"><col style="width:10%"><col style="width:7%"></colgroup>';
  printInjected(`${reportLetterhead()}
    <div class="report-title-block"><h2>Transaction Report &mdash; ${escapeHtml(title)}</h2><div class="report-meta"><span>Period: ${period}</span><span>Generated: ${fmtDateTime(new Date())} by ${escapeHtml(currentUser.fullName)}</span></div></div>
    ${svc ? `<div class="rpt-section"><h3 class="rpt-h">Service Information</h3>
      <table class="doc-form-table"><colgroup><col style="width:24%"><col style="width:76%"></colgroup>
        <tr><th>Service</th><td>${escapeHtml(svc.label)}</td></tr>
        ${svc.desc ? `<tr><th>Description</th><td>${escapeHtml(svc.desc)}</td></tr>` : ''}
        <tr><th>Requirements</th><td>${svc.requirements && svc.requirements.length ? svc.requirements.map(escapeHtml).join('; ') : 'None required'}</td></tr></table></div>` : ''}
    <div class="rpt-section"><h3 class="rpt-h">Summary</h3><div class="stat-grid rpt-stat-grid">
      <div class="rpt-stat"><div class="rpt-stat-lbl">Total Transactions</div><div class="rpt-stat-val">${total}</div></div>
      <div class="rpt-stat"><div class="rpt-stat-lbl">Completed</div><div class="rpt-stat-val">${sc.Completed}</div></div>
      <div class="rpt-stat"><div class="rpt-stat-lbl">Pending / Processing</div><div class="rpt-stat-val">${sc.Pending + sc.Processing}</div></div>
      <div class="rpt-stat"><div class="rpt-stat-lbl">Completion Rate</div><div class="rpt-stat-val">${rate}%</div></div></div>
      <div class="stat-grid rpt-stat-grid">
      <div class="rpt-stat"><div class="rpt-stat-lbl">Walk-in / Scheduled</div><div class="rpt-stat-val" style="font-size:1.15rem;">${walkIns} / ${sched}</div></div>
      <div class="rpt-stat"><div class="rpt-stat-lbl">Avg. Waiting Time</div><div class="rpt-stat-val" style="font-size:1.15rem;">${fmtMinutes(avgOf('waitingTimeMin'))}</div></div>
      <div class="rpt-stat"><div class="rpt-stat-lbl">Avg. Service Time</div><div class="rpt-stat-val" style="font-size:1.15rem;">${fmtMinutes(avgOf('serviceTimeMin'))}</div></div>
      <div class="rpt-stat"><div class="rpt-stat-lbl">Avg. Total Visit</div><div class="rpt-stat-val" style="font-size:1.15rem;">${fmtMinutes(avgOf('totalTimeMin'))}</div></div></div></div>
    <div class="rpt-section rpt-grid-2"><div class="rpt-table-wrap"><h3 class="rpt-h">Status Breakdown</h3><table class="rpt-table"><colgroup><col style="width:50%"><col style="width:25%"><col style="width:25%"></colgroup><thead><tr><th>Status</th><th>Count</th><th>%</th></tr></thead>
        <tbody>${ORDER.map(s => `<tr><td>${s}</td><td>${sc[s]}</td><td>${pct(sc[s])}%</td></tr>`).join('')}<tr class="rpt-total-row"><td>Total</td><td>${total}</td><td>${total ? '100%' : '0%'}</td></tr></tbody></table></div>
      ${!svc ? `<div class="rpt-table-wrap"><h3 class="rpt-h">By Service</h3><table class="rpt-table"><colgroup><col style="width:64%"><col style="width:18%"><col style="width:18%"></colgroup><thead><tr><th>Service</th><th>Count</th><th>%</th></tr></thead>
        <tbody>${byService.length ? byService.map(r => `<tr><td>${escapeHtml(r.label)}</td><td>${r.count}</td><td>${pct(r.count)}%</td></tr>`).join('') : '<tr class="empty-row"><td colspan="3">No transactions.</td></tr>'}</tbody></table></div>` : '<div></div>'}</div>
    <div class="rpt-section"><h3 class="rpt-h">Detailed Transaction Log</h3>
      <div class="rpt-desc">${rows.length} record${rows.length === 1 ? '' : 's'} itemized &mdash; ${period}, sorted by date logged${confCount ? ` &mdash; ${confCount} record${confCount === 1 ? '' : 's'} counted in the totals above but not listed` : ''}</div>
      <div class="rpt-table-wrap"><table class="rpt-table">${cg}
        <thead><tr><th>#</th><th>Code</th><th>Name</th><th>Type</th><th>ID Number</th><th>Visit ID</th><th>Queue No.</th><th>Entry</th><th>Status</th><th>Served By</th><th>Logged</th><th>Total Time</th></tr></thead>
        <tbody>${rows.length ? rows.map((t, i) => `<tr><td class="mono">${i + 1}</td><td class="mono">${escapeHtml(t.code)}</td><td>${escapeHtml(t.name)}</td><td class="nw">${escapeHtml(t.type || '—')}</td><td class="mono">${escapeHtml(t.idNumber || '—')}${t.section ? `<br>${escapeHtml(t.section)}` : ''}</td><td class="mono">${escapeHtml(t.visitId || '—')}</td><td class="mono nw">${escapeHtml(t.queueNumber || '—')}</td><td class="nw">${escapeHtml(t.entryMethod || '—')}</td><td class="nw">${escapeHtml(t.status)}</td><td>${escapeHtml(t.servedBy || '—')}</td><td class="mono">${fmtDate(t.createdAt)}<br>${fmtTime(t.createdAt)}</td><td>${fmtMinutes(t.totalTimeMin)}</td></tr>`).join('') : `<tr class="empty-row"><td colspan="12">${confCount ? 'The records in this period are not listed.' : 'No transactions recorded for this period.'}</td></tr>`}</tbody></table></div></div>
    ${reportSignatureBlock()}
    <p class="doc-footnote">This report was generated by the OSS UniServe system.</p>`);
  logActivity(db, currentUser, `Printed transaction report &mdash; ${escapeHtml(title)} (${total} record${total === 1 ? '' : 's'}${includeConf ? ', confidential records listed by name' : ''})`, { category: 'Transactions' });
  saveDB(db);
}

function renderFeedback() {
  const db = loadDB(), when = q => new Date(q.completedAt || q.createdAt);
  const rows = feedbackStats(db).rows.filter(q => inRange(when(q), RANGES.fb)).sort((a, b) => when(b) - when(a));
  const avg = rows.length ? (rows.reduce((s, q) => s + q.feedback.rating, 0) / rows.length).toFixed(1) : '—';
  document.getElementById('content').innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="lbl">Responses</div><div class="val">${rows.length}</div></div>
      <div class="stat-card"><div class="lbl">Average Rating</div><div class="val">${avg}</div></div>
      <div class="stat-card"><div class="lbl">Satisfied (4&ndash;5 stars)</div><div class="val">${rows.filter(q => q.feedback.rating >= 4).length}</div></div></div>
    <div class="card"><div class="card-head"><div><h3>Visitor Feedback</h3><div class="desc">${escapeHtml(rangeLabel(RANGES.fb))}</div></div></div>
      <div class="filter-bar">${dateRangeHtml('fb')}</div>
      <div class="table-wrap"><table><thead><tr><th>#</th><th>Visit</th><th>Visitor</th><th>Service</th><th>Rating</th><th>Comment</th><th>Date</th></tr></thead>
      <tbody>${rows.length ? rows.map((q, i) => {
        const txn = q.transactionId ? db.transactions.find(t => t.id === q.transactionId) : null, locked = !!txn && isTxnLocked(txn);
        return `<tr><td class="row-num">${i + 1}</td><td class="mono">${escapeHtml(q.visitId || q.number)}</td><td>${escapeHtml(locked ? maskName(q.name) : (q.name || '—'))}</td><td>${escapeHtml(serviceQueueLabel(db, q))}</td>
          <td><span class="fb-readout"><span class="stars">${STARS(q.feedback.rating)}</span></span></td>
          <td class="fb-comment-cell">${locked ? '<span class="muted">Hidden</span>' : (q.feedback.comment ? feedbackCommentHtml(q.id, q.feedback.comment) : '<span class="muted">&mdash;</span>')}</td><td class="muted nw">${fmtDateTime(when(q))}</td></tr>`;
      }).join('') : '<tr class="empty-row"><td colspan="7">No feedback in this date range.</td></tr>'}</tbody></table></div></div>`;
}

function renderServicesManage() {
  document.getElementById('content').innerHTML = `<div class="card"><div class="card-head"><div><h3>Service Catalog</h3></div><button class="btn btn-primary btn-sm" onclick="openServiceForm()">${icon('plus', 14)} Create Service</button></div><div class="card-pad"><div class="svc-manage-grid" id="svcManageGrid"></div></div></div>`;
  renderSvcManageGrid();
}
function renderSvcManageGrid() {
  const db = loadDB(), grid = document.getElementById('svcManageGrid');
  if (!db.services.length) { grid.innerHTML = `<div class="helper-empty">${icon('folder', 30)}<p>No services yet. Create one to get started.</p></div>`; return; }
  grid.innerHTML = db.services.map(s => `<div class="svc-manage-card">
    <div class="top"><span class="ic">${icon(s.icon || 'home', 18)}</span><div style="display:flex; gap:6px;"><button class="icon-btn" title="Edit" onclick="openServiceForm('${s.key}')">${icon('edit', 14)}</button><button class="icon-btn" title="Delete" onclick="deleteService('${s.key}')">${icon('trash', 14)}</button></div></div>
    <h4>${escapeHtml(s.label)}</h4><div class="desc-txt">${escapeHtml(s.desc || '')}</div>
    <div class="req-mini">${s.requirements && s.requirements.length ? s.requirements.length + ' requirement(s): ' + s.requirements.map(escapeHtml).join(', ') : 'No requirements set'}</div>
    ${(s.templates || []).length ? `<div class="req-mini">${icon('paperclip', 11)} ${s.templates.length} downloadable form(s)</div>` : ''}
    <div class="req-mini mono">${countTxnForService(db, s.key)} transaction(s) logged</div></div>`).join('');
}
let svcFormTemplates = [];
const TPL_MAX = 2 * 1024 * 1024;
async function handleTemplateFiles(el) {
  const files = Array.from(el.files || []);
  el.value = '';
  for (const f of files) {
    if (f.size > TPL_MAX) { toast(`"${escapeHtml(f.name)}" is over 2 MB.`, 'err'); continue; }
    if (svcFormTemplates.some(t => t.name.toLowerCase() === f.name.toLowerCase())) { toast(`"${escapeHtml(f.name)}" is already added.`, 'err'); continue; }
    try { svcFormTemplates.push(await readFileAsDataURL(f)); } catch (e) { toast('Could not read that file.', 'err'); }
  }
  renderSvcTplList();
}
function removeSvcTpl(i) { svcFormTemplates.splice(i, 1); renderSvcTplList(); }
function renderSvcTplList() {
  const w = document.getElementById('svcTplList');
  if (w) w.innerHTML = svcFormTemplates.length ? `<div style="margin-top:8px;">${svcFormTemplates.map((t, i) => `<span class="attach-preview-chip">${icon('paperclip', 11)}<span class="fname">${escapeHtml(t.name)}</span><span class="fsize">${fmtFileSize(t.size)}</span><button type="button" onclick="removeSvcTpl(${i})" title="Remove">${icon('x', 11)}</button></span>`).join('')}</div>` : '';
}
function openServiceForm(key) {
  const db = loadDB(), editing = key ? db.services.find(s => s.key === key) : null;
  svcFormTemplates = editing && editing.templates ? editing.templates.map(t => ({ ...t })) : [];
  openModal(editing ? 'Edit Service' : 'Create Service', `
    <div class="field"><label>Service Name</label><input id="mSvcLabel" value="${editing ? escapeHtml(editing.label) : ''}" placeholder="e.g. Good Moral Character"></div>
    <div class="field"><label>Short Description</label><textarea id="mSvcDesc" placeholder="Shown as the card blurb on the visitor portal">${editing ? escapeHtml(editing.desc || '') : ''}</textarea></div>
    <div class="field"><label>Requirements <span class="muted" style="font-weight:400;">(one per line)</span></label><textarea id="mSvcReq" placeholder="Valid School ID">${editing ? escapeHtml((editing.requirements || []).join('\n')) : ''}</textarea>
      <div class="field-hint">Each requirement is what "Smart Service Readiness" counts against when a visitor uploads files, and what the emailed pass lists under "What to bring".</div></div>
    <div class="field"><label>Downloadable forms <span class="muted" style="font-weight:400;">(optional)</span></label>
      <input type="file" id="mSvcFiles" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,image/*" onchange="handleTemplateFiles(this)">
      <div id="svcTplList"></div>
      <div class="field-hint">Blank forms visitors can download before they come (request form, consent form, etc.). PDF, Word, Excel or image, up to 2 MB each.</div></div>
    <div class="field"><label>Icon</label><div class="icon-picker">${ICON_CHOICES.map(ic => `<label><input type="radio" name="mSvcIcon" value="${ic}" ${(editing ? editing.icon : ICON_CHOICES[0]) === ic ? 'checked' : ''}><span>${icon(ic, 18)}</span></label>`).join('')}</div></div>`, [
    { label: 'Cancel', cls: 'btn-ghost', action: closeModal },
    { label: editing ? 'Save Changes' : 'Create Service', cls: 'btn-primary', action: () => {
      const label = document.getElementById('mSvcLabel').value.trim();
      if (!label) { toast('Service name is required.', 'err'); return; }
      const desc = document.getElementById('mSvcDesc').value.trim(), reqs = document.getElementById('mSvcReq').value.split('\n').map(s => s.trim()).filter(Boolean);
      const iconEl = document.querySelector('input[name="mSvcIcon"]:checked'), iconVal = iconEl ? iconEl.value : 'home', db2 = loadDB();
      if (editing) {
        Object.assign(db2.services.find(s => s.key === editing.key), { label, desc, requirements: reqs, icon: iconVal, templates: svcFormTemplates });
        logActivity(db2, currentUser, `Updated service "${label}"`); toast('Service updated.', 'ok');
      } else {
        const k = slugify(label);
        if (db2.services.some(s => s.key === k)) { toast('A service with a similar name already exists.', 'err'); return; }
        db2.services.push({ key: k, label, desc, requirements: reqs, icon: iconVal, templates: svcFormTemplates });
        logActivity(db2, currentUser, `Created service "${label}"`); toast('Service created.', 'ok');
      }
      try { saveDB(db2); } catch (e) { toast('Storage is full &mdash; remove some forms and try again.', 'err'); return; }
      closeModal(); renderSvcManageGrid(); renderSidebar();
    } }]);
  renderSvcTplList();
}
function deleteService(key) {
  const db = loadDB(), s = db.services.find(x => x.key === key);
  if (!s) return;
  const used = countTxnForService(db, key);
  if (!confirm(`Delete "${s.label}"?${used ? ` ${used} existing transaction(s) will keep the label for reference.` : ''}`)) return;
  db.services = db.services.filter(x => x.key !== key);
  logActivity(db, currentUser, `Deleted service "${s.label}"`);
  if (txnServiceFilter === key) txnServiceFilter = undefined;
  saveDB(db); renderSvcManageGrid(); renderSidebar(); toast('Service deleted.', 'ok');
}

let reportPeriod = 'Daily';
function renderReports() {
  document.getElementById('content').innerHTML = `
    <div class="card card-pad no-print">
      <div class="subnav">${['Daily', 'Weekly', 'Monthly', 'Quarterly'].map((p, i) => `<button class="${i ? '' : 'active'}" onclick="setReportPeriod('${p}',this)">${p}</button>`).join('')}</div>
      <div style="display:flex; gap:10px; flex-wrap:wrap;"><button class="btn btn-primary btn-sm" onclick="printReport()">${icon('print', 14)} Print Report</button><button class="btn btn-ghost btn-sm" onclick="downloadReportCSV()">${icon('download', 14)} Download CSV</button></div></div>
    <div class="card card-pad" id="reportSheet" style="margin-top:16px;">${reportLetterhead()}
      <div class="report-title-block"><h2 id="repTitle">Daily Transaction Report</h2><div class="report-meta"><span id="repPeriodLbl"></span><span id="repGenLbl"></span></div></div>
      <div id="repBody"></div></div>`;
  reportPeriod = 'Daily';
  buildReport();
}
let reportIncludeConf = false;
function printReport(includeConf) {
  const sheet = document.getElementById('reportSheet');
  if (!sheet) return;
  if (includeConf === undefined) {
    const start = periodStart(reportPeriod), n = loadDB().transactions.filter(t => t.createdAt >= start && isConfidentialTxn(t)).length;
    askIncludeConf(n, inc => printReport(inc)); return;
  }
  reportIncludeConf = !!includeConf; buildReport();
  printInjected(sheet.innerHTML);
  reportIncludeConf = false; buildReport();
  const db = loadDB(); logActivity(db, currentUser, `Printed ${reportPeriod} report${includeConf ? ' (confidential records listed by name)' : ''}`); saveDB(db);
}
function setReportPeriod(p, el) { reportPeriod = p; document.querySelectorAll('.subnav button').forEach(b => b.classList.remove('active')); el.classList.add('active'); buildReport(); }
function periodStart(p) { const d = new Date(); if (p === 'Daily') d.setHours(0, 0, 0, 0); else d.setDate(d.getDate() - ({ Weekly: 7, Monthly: 30 }[p] || 90)); return d; }
function buildReport() {
  const db = loadDB(), start = periodStart(reportPeriod);
  document.getElementById('repTitle').textContent = `${reportPeriod} Transaction Report`;
  document.getElementById('repPeriodLbl').textContent = `Period: ${fmtDate(start)} to ${today()}`;
  document.getElementById('repGenLbl').textContent = `Generated: ${fmtDateTime(new Date())} by ${currentUser.fullName}`;
  const txns = db.transactions.filter(t => t.createdAt >= start).sort((a, b) => a.createdAt - b.createdAt), appts = db.appointments.filter(a => a.createdAt && a.createdAt >= start);
  const confCount = reportIncludeConf ? 0 : txns.filter(isConfidentialTxn).length, logTxns = reportIncludeConf ? txns : txns.filter(t => !isConfidentialTxn(t));
  const ORDER = ['Completed', 'Approved', 'Processing', 'Pending', 'Rejected'], sc = {}; ORDER.forEach(s => sc[s] = 0);
  txns.forEach(t => { if (sc[t.status] !== undefined) sc[t.status]++; });
  const svcCounts = {}; db.services.forEach(s => svcCounts[s.key] = 0);
  txns.forEach(t => { svcCounts[t.service] = (svcCounts[t.service] || 0) + 1; });
  const svcRows = db.services.map(s => ({ label: s.label, count: svcCounts[s.key] || 0 })).sort((a, b) => b.count - a.count);
  const trend = buildTrendBuckets(txns, start);
  const total = txns.length, completed = sc.Completed, pending = sc.Pending, rejected = sc.Rejected, rate = total ? Math.round(completed / total * 100) : 0, busiest = svcRows[0];
  const per = trend.values.length ? (total / trend.values.length).toFixed(1) : '0.0';
  const withTimes = txns.filter(t => t.totalTimeMin != null), avgOf = k => withTimes.length ? Math.round(withTimes.reduce((s, t) => s + (t[k] || 0), 0) / withTimes.length) : null;
  const noShows = appts.filter(a => a.status === 'No-show').length, pct = n => total ? Math.round(n / total * 100) : 0;
  const svcKeys = db.services.map(x => x.key); txns.forEach(t => { if (!svcKeys.includes(t.service)) svcKeys.push(t.service); });
  const svcGroups = svcKeys.map(k => {
    const all = txns.filter(t => t.service === k), rows = reportIncludeConf ? all : all.filter(t => !isConfidentialTxn(t));
    return { label: serviceLabel(db, k), rows, total: all.length, hidden: all.length - rows.length };
  }).filter(g => g.total);
  document.getElementById('repBody').innerHTML = `
    <div class="rpt-section"><h3 class="rpt-h">Executive Summary</h3>
      <div class="stat-grid rpt-stat-grid">
        <div class="rpt-stat"><div class="rpt-stat-lbl">Total Transactions</div><div class="rpt-stat-val">${total}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-lbl">Completed</div><div class="rpt-stat-val">${completed}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-lbl">Pending</div><div class="rpt-stat-val">${pending}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-lbl">Completion Rate</div><div class="rpt-stat-val">${rate}%</div></div></div>
      ${withTimes.length ? `<div class="stat-grid rpt-stat-grid">
        <div class="rpt-stat"><div class="rpt-stat-lbl">Avg. Waiting Time</div><div class="rpt-stat-val">${fmtMinutes(avgOf('waitingTimeMin'))}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-lbl">Avg. Service Time</div><div class="rpt-stat-val">${fmtMinutes(avgOf('serviceTimeMin'))}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-lbl">Avg. Total Visit</div><div class="rpt-stat-val">${fmtMinutes(avgOf('totalTimeMin'))}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-lbl">No-Shows</div><div class="rpt-stat-val">${noShows}</div></div></div>` : ''}
      <p class="rpt-narrative">During the period ${fmtDate(start)} to ${today()}, the office logged <strong>${total}</strong> transaction${total === 1 ? '' : 's'} across ${db.services.length} service categories, averaging <strong>${per}</strong> per ${trend.unit}. <strong>${completed}</strong> request${completed === 1 ? '' : 's'} ${completed === 1 ? 'was' : 'were'} completed (${rate}% completion rate), while <strong>${pending}</strong> remain${pending === 1 ? 's' : ''} pending${rejected ? ` and ${rejected} ${rejected === 1 ? 'was' : 'were'} rejected` : ''}.${busiest && busiest.count > 0 ? ` The most requested service was <strong>${busiest.label}</strong> with ${busiest.count} transaction${busiest.count === 1 ? '' : 's'}.` : ''} A total of <strong>${appts.length}</strong> appointment${appts.length === 1 ? '' : 's'} ${appts.length === 1 ? 'was' : 'were'} booked in the same period${noShows ? `, of which ${noShows} resulted in a no-show` : ''}.</p></div>
    <div class="rpt-section"><h3 class="rpt-h">Transaction Trend</h3><div class="rpt-desc">Transactions logged per ${trend.unit} over the reporting period</div>${svgLineChart(trend)}</div>
    <div class="rpt-section rpt-grid-2"><div><h3 class="rpt-h">Status Breakdown</h3>${svgBarChart(ORDER.map(s => ({ label: s, count: sc[s] })))}</div>
      <div class="rpt-table-wrap"><table class="rpt-table"><colgroup><col style="width:50%"><col style="width:25%"><col style="width:25%"></colgroup><thead><tr><th>Status</th><th>Count</th><th>%</th></tr></thead>
        <tbody>${ORDER.map(s => `<tr><td>${s}</td><td>${sc[s]}</td><td>${pct(sc[s])}%</td></tr>`).join('')}<tr class="rpt-total-row"><td>Total</td><td>${total}</td><td>100%</td></tr></tbody></table></div></div>
    <div class="rpt-section"><h3 class="rpt-h">Service Breakdown</h3><div class="rpt-grid-2"><div>${svgBarChart(svcRows, { height: svcRows.length * 26 + 20 })}</div>
      <div class="rpt-table-wrap"><table class="rpt-table"><colgroup><col style="width:60%"><col style="width:20%"><col style="width:20%"></colgroup><thead><tr><th>Service</th><th>Count</th><th>%</th></tr></thead>
        <tbody>${svcRows.map(r => `<tr><td>${r.label}</td><td>${r.count}</td><td>${pct(r.count)}%</td></tr>`).join('')}</tbody></table></div></div></div>
    <div class="rpt-section"><h3 class="rpt-h">Detailed Transaction Log</h3>
      <div class="rpt-desc">${logTxns.length} record${logTxns.length === 1 ? '' : 's'} in period, one table per transaction type, sorted by date logged${confCount ? ` &mdash; ${confCount} record${confCount === 1 ? '' : 's'} counted in the totals above but not listed` : ''}</div></div>
    ${svcGroups.length ? svcGroups.map(g => `<div class="rpt-section rpt-svc-table"><h3 class="rpt-h">${escapeHtml(g.label)} <span class="rpt-h-count">&mdash; ${g.total} transaction${g.total === 1 ? '' : 's'}</span></h3>
      <div class="rpt-table-wrap"><table class="rpt-table"><colgroup><col style="width:4%"><col style="width:11%"><col style="width:15%"><col style="width:9%"><col style="width:12%"><col style="width:13%"><col style="width:8%"><col style="width:11%"><col style="width:17%"></colgroup>
        <thead><tr><th>#</th><th>Code</th><th>Name</th><th>Type</th><th>ID Number</th><th>Visit ID</th><th>Queue No.</th><th>Status</th><th>Logged</th></tr></thead>
        <tbody>${g.rows.map((t, i) => `<tr><td>${i + 1}</td><td class="mono">${escapeHtml(t.code)}</td><td>${escapeHtml(t.name)}</td><td class="nw">${escapeHtml(t.type || '—')}</td><td class="mono">${escapeHtml(t.idNumber || '—')}${t.section ? `<br>${escapeHtml(t.section)}` : ''}</td><td class="mono">${escapeHtml(t.visitId || '—')}</td><td class="mono nw">${escapeHtml(t.queueNumber || '—')}</td><td class="nw">${escapeHtml(t.status)}</td><td class="mono">${fmtDate(t.createdAt)}<br>${fmtTime(t.createdAt)}</td></tr>`).join('')}
        ${g.hidden ? `<tr><td colspan="9"><em>${g.hidden} record${g.hidden === 1 ? '' : 's'} counted in the totals but not listed.</em></td></tr>` : ''}${!g.rows.length && !g.hidden ? '<tr class="empty-row"><td colspan="9">No transactions in this period.</td></tr>' : ''}</tbody></table></div></div>`).join('') : `<div class="rpt-section"><div class="rpt-table-wrap"><table class="rpt-table"><tbody><tr class="empty-row"><td>No transactions in this period.</td></tr></tbody></table></div></div>`}
    ${reportSignatureBlock()}`;
}
function downloadReportCSV() {
  const db = loadDB(), start = periodStart(reportPeriod), txns = db.transactions.filter(t => t.createdAt >= start), counts = {};
  db.services.forEach(s => counts[s.key] = 0);
  txns.forEach(t => { counts[t.service] = (counts[t.service] || 0) + 1; });
  downloadCSV(`OSS_${reportPeriod}_Report_${today()}.csv`, [
    ['Polytechnic University of the Philippines - Santa Maria Campus'], ['Office of the Student Services'], [`${reportPeriod} Transaction Report`], [`Period: ${fmtDate(start)} to ${today()}`],
    [`Generated: ${fmtDateTime(new Date()).replace('&middot;', '-')} by ${currentUser.fullName}`], [],
    ['Summary'], ['Total Transactions', txns.length], ['Completed', txns.filter(t => t.status === 'Completed').length], ['Pending', txns.filter(t => t.status === 'Pending').length],
    ['Records not listed (count only)', txns.filter(isConfidentialTxn).length], ['Chat Conversations Started', db.chats.filter(c => c.createdAt >= start).length], [],
    ['Breakdown by Service'], ['Service', 'Count'], ...db.services.map(s => [s.label, counts[s.key] || 0]),
  ]);
  logActivity(db, currentUser, `Downloaded ${reportPeriod} report`); saveDB(db);
  toast('Report downloaded.', 'ok');
}

function renderProfile() {
  const u = currentUser, initials = u.fullName.split(' ').map(s => s[0]).slice(0, 2).join('');
  document.getElementById('content').innerHTML = `
    <div class="card" style="max-width:560px;">
      <div class="profile-head"><div class="profile-avatar">${initials}</div><div><div style="font-weight:700; font-size:1.05rem;">${escapeHtml(u.fullName)}</div><span class="pill pill-gold">${ROLES[u.role].label}</span></div></div>
      <div class="card-pad">
        <div class="field"><label>Full Name</label><input value="${escapeHtml(u.fullName)}" disabled></div>
        <div class="field"><label>Username</label><input value="${escapeHtml(u.username)}" disabled></div>
        <div class="field"><label>Email</label><input value="${escapeHtml(u.email || 'Not set — ask your Super Admin to add one')}" disabled></div>
        <div class="field-hint" style="margin-top:-8px; margin-bottom:14px;">Full name, username and email are managed by your Super Admin.</div>
        <div class="divider"></div>
        <div class="field-hint" style="margin-bottom:10px;">Enter a new password below.</div>
        <div class="form-row"><div class="field"><label>New Password</label><input id="pfPass" type="password" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;"></div><div class="field"><label>Confirm New Password</label><input id="pfPass2" type="password" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;"></div></div>
        <button class="btn btn-primary btn-block" onclick="saveProfile()">Save Password</button>
      </div></div>`;
}
function saveProfile() {
  const pass = document.getElementById('pfPass').value, pass2 = document.getElementById('pfPass2').value;
  if (!pass && !pass2) { toast('Enter a new password to save changes.', 'err'); return; }
  if (pass.length < 4) { toast('Password should be at least 4 characters.', 'err'); return; }
  if (pass !== pass2) { toast('Passwords do not match.', 'err'); return; }
  const db = loadDB(), u2 = db.users.find(x => x.id === currentUser.id);
  u2.password = pass;
  logActivity(db, currentUser, 'Changed own password');
  saveDB(db); currentUser = u2; saveSession({ currentUser: u2 });
  document.getElementById('pfPass').value = ''; document.getElementById('pfPass2').value = '';
  toast('Password updated.', 'ok');
}

renderSidebar();
navigate('dashboard');