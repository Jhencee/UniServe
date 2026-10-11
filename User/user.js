const DB_KEY = 'ossuniserve_db_v1';

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

const VISITOR_TYPES = [
  { t: 'Student', ic: 'cap', sub: 'Enrolled at PUP' },
  { t: 'Guest', ic: 'users', sub: 'Visiting the campus' },
];
const GUEST_CLASSES = [
  { t: 'Parent/Guardian', ic: 'users', sub: 'Parent or guardian of a PUP student' },
  { t: 'Senior Citizen', ic: 'idcard', sub: 'Senior citizen visitor' },
];
const VALID_ID_TYPES = [
  "Driver's License", 'Passport', 'UMID', 'PhilID (National ID)',
  'Senior Citizen ID', 'PWD ID', "Voter's ID", 'PhilHealth ID', 'Other Government-Issued ID',
];
const UX_STEPS = ['Service', 'Entry method', 'Your details'];
const UX_MAX_FILE = 2 * 1024 * 1024;
const FEEDBACK_MAX = 300;
const uxReq = '<span class="req" aria-hidden="true">*</span>';
const ALLOWED_ATTACHMENT_TYPES = ['image/', 'application/pdf'];

const OFFICE_OPEN_HOUR = 8;
const OFFICE_CLOSE_HOUR = 17;
const QUEUE_AVG_MINUTES = 4;
const DEFAULT_GRACE_MINUTES = 15;
const DEFAULT_NOSHOW_MINUTES = 60;
const AUDIT_MAX_ENTRIES = 2000;

function isOfficeHours(d = new Date()) { const h = d.getHours(); return h >= OFFICE_OPEN_HOUR && h < OFFICE_CLOSE_HOUR; }
function officeHoursLabel() { return '8:00 AM &ndash; 5:00 PM'; }
function nextOpeningLabel(d = new Date()) { return d.getHours() < OFFICE_OPEN_HOUR ? 'today at 8:00 AM' : 'tomorrow at 8:00 AM'; }
function officeHoursBannerHtml(kind) {
  const action = kind === 'chat' ? 'send a message to' : 'submit a request to';
  return isOfficeHours()
    ? `<div class="info-banner">${icon('clock', 14)} OSS is open now. You can ${action} the office until ${officeHoursLabel()}.</div>`
    : `<div class="info-banner warn">${icon('alert', 14)} OSS is currently closed. You can ${action} during office hours (${officeHoursLabel()}).</div>`;
}
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
const randCode = prefix => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = ''; for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}-${s}`;
};
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
function fmtWaitDuration(mins) {
  if (!mins || mins <= 0) return 'a few minutes';
  if (mins < 1) { const s = Math.max(1, Math.round(mins * 60)); return `${s} sec${s === 1 ? '' : 's'}`; }
  if (mins < 60) { const m = Math.round(mins); return `${m} min${m === 1 ? '' : 's'}`; }
  const h = Math.max(1, Math.round(mins / 60));
  return `${h} hr${h === 1 ? '' : 's'}`;
}

function titleCaseWords(s) { return String(s || '').replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1)); }
function joinName(first, last) { return [String(first || '').trim(), String(last || '').trim()].filter(Boolean).join(' '); }
function autoCapitalizeInput(el) {
  if (!el) return;
  const pos = el.selectionStart, before = el.value, after = titleCaseWords(before);
  if (before !== after) { el.value = after; try { el.setSelectionRange(pos, pos); } catch (e) { } }
}
function formatContactInput(el) { el.value = el.value.replace(/[^\d+\-\s]/g, ''); }
const PH_CONTACT_RE = /^(09\d{2}[-\s]?\d{3}[-\s]?\d{4}|\+639\d{2}[-\s]?\d{3}[-\s]?\d{4})$/;
const STUDENT_NO_RE = /^\d{4}-\d{5}-SM-\d$/;
function isValidContact(v) { return PH_CONTACT_RE.test(String(v || '').trim()); }
function isValidEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || '').trim()); }
function isValidPersonName(v) { return String(v || '').trim().length >= 2; }
function isValidIdNumber(v) { return String(v || '').trim().length >= 3; }
function isValidStudentNo(v) { return STUDENT_NO_RE.test(String(v || '').trim().toUpperCase()); }
function maskStudentNo(v) {
  const d = String(v || '').replace(/\D/g, '').slice(0, 10);
  let out = d.slice(0, 4);
  if (d.length > 4) out += '-' + d.slice(4, 9);
  if (d.length > 9) out += '-SM-' + d.slice(9);
  return out;
}
function maskStudentNoInput(el) { el.value = maskStudentNo(el.value); }

function markField(wrapId, ok, message) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return ok;
  wrap.classList.toggle('has-error', !ok);
  const err = wrap.querySelector('.field-error');
  if (err && message) err.textContent = message;
  return ok;
}
function focusFirstError() {
  const el = document.querySelector('.field.has-error input, .field.has-error select, .field.has-error textarea');
  if (!el) return;
  el.focus();
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
function uxEnter(e, fnName) {
  if (e.key === 'Enter' && !['TEXTAREA', 'BUTTON'].includes(e.target.tagName)) { e.preventDefault(); window[fnName](); }
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
    systemSettings: {
      orgName: 'Office of Student Services', supportEmail: 'oss@university.edu.ph',
      supportPhone: '0917-000-0000', timezone: 'Asia/Manila', maintenanceMode: false,
      autoCloseChats: false, sessionTimeout: 30, queuePrefixStudent: 'A', queuePrefixGuest: 'G',
      gracePeriodMinutes: DEFAULT_GRACE_MINUTES, noShowThresholdMinutes: DEFAULT_NOSHOW_MINUTES,
    },
  };
}
function mkAppt(o) { return { id: uid('A'), code: randCode('APT'), visitId: null, queueId: null, queueNumber: null, isSenior: false, readiness: null, arrivalStatus: null, lateMinutes: null, possibleDuplicate: false, ...o }; }
function mkChat(o) { return { id: uid('CH'), status: 'Open', messages: [], staffUnread: 0, visitorUnread: 0, ...o }; }
function mkQueue(o) {
  return { id: uid('Q'), visitId: null, number: null, status: 'Waiting', createdAt: new Date(), checkedInAt: new Date(), scheduledAt: null, calledAt: null, servingAt: null, completedAt: null, assignedAdminId: null, assignedAdminName: null, transactionId: null, appointmentId: null, visitorLogId: null, recallCount: 0, isSenior: false, possibleDuplicate: false, feedback: null, ...o };
}
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
function mkLog(user, role, action, ts) { return { id: uid('L'), user, role, action, ts: ts || new Date() }; }
const VISITOR_ACTOR = { fullName: 'Visitor Portal', role: 'VISITOR' };

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
  db.auditHead = { hash: e.hash };
  if (db.activityLog.length > AUDIT_MAX_ENTRIES) db.activityLog.length = AUDIT_MAX_ENTRIES;
}

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
function peopleAheadOf(db, entryId) {
  const idx = waitingQueueSorted(db).findIndex(q => q.id === entryId);
  return idx < 0 ? 0 : idx;
}
function servingQueueEntries(db) {
  return db.queues.filter(q => q.status === 'Serving' || q.status === 'Called').sort((a, b) => new Date(a.calledAt || 0) - new Date(b.calledAt || 0));
}
function cancelQueue(db, id, actor) {
  const q = db.queues.find(x => x.id === id);
  if (!q) return;
  q.status = 'Cancelled'; q.cancelledAt = new Date();
  const a = q.appointmentId ? db.appointments.find(x => x.id === q.appointmentId) : null;
  if (a) a.status = 'Cancelled';
  if (actor) logActivity(db, actor, `Cancelled ${queueRef(q)} (${q.visitId})`, { category: 'Queue', target: q.visitId });
}
function visitStart(q) {
  const arrived = new Date(q.checkedInAt || q.createdAt);
  return q.source === 'Appointment' && q.scheduledAt && new Date(q.scheduledAt) > arrived ? new Date(q.scheduledAt) : arrived;
}
function findService(db, key) { return db.services.find(x => x.key === key) || db.services.find(x => x.label === key); }
function serviceLabel(db, key) { const s = db.services.find(x => x.key === key); return s ? s.label : key; }
function serviceQueueLabel(db, e) { return e.serviceLabel || (e.serviceKey ? serviceLabel(db, e.serviceKey) : 'General Concern'); }
function addToQueue(db, o) {
  const isAppt = o.source === 'Appointment';
  const num = isAppt ? null : nextQueueNumber(db, o.visitorType);
  const entry = mkQueue({
    visitId: o.visitId || nextVisitId(db),
    number: num ? num.number : null, prefix: num ? num.prefix : null, seq: num ? num.seq : null,
    visitorType: o.visitorType, serviceKey: o.serviceKey || null,
    serviceLabel: o.serviceLabel || (o.serviceKey ? serviceLabel(db, o.serviceKey) : 'General Concern'),
    source: o.source || 'Walk-in', name: o.name || '', idNumber: o.idNumber || '', idType: o.idType || '',
    guestClass: o.guestClass || '', contact: o.contact || '',
    appointmentId: o.appointmentId || null, scheduledAt: o.scheduledAt || null,
    isSenior: !!o.isSenior, checkedInAt: o.checkedInAt || new Date(), possibleDuplicate: !!o.possibleDuplicate,
  });
  db.queues.push(entry);
  return entry;
}

function historicalAvgMinutes(db, svcKeyOrLabel) {
  const m = db.queues.filter(q => q.status === 'Completed' && q.checkedInAt && q.servingAt && (q.serviceKey === svcKeyOrLabel || q.serviceLabel === svcKeyOrLabel));
  if (!m.length) return QUEUE_AVG_MINUTES;
  return Math.max(1, Math.round(m.reduce((s, q) => s + Math.max(1, (new Date(q.servingAt) - visitStart(q)) / 60000), 0) / m.length));
}
function waitEstimateMinutes(db, svcKeyOrLabel) {
  return db.queues.filter(q => q.status === 'Waiting').length * (svcKeyOrLabel ? historicalAvgMinutes(db, svcKeyOrLabel) : QUEUE_AVG_MINUTES);
}
function waitEstimateHtml(db, svcKey) {
  const waiting = db.queues.filter(q => q.status === 'Waiting').length;
  if (!waiting) return `<div class="wait-estimate">${icon('chart', 15)} No one is waiting right now &mdash; you'll be served right away</div>`;
  return `<div class="wait-estimate">${icon('chart', 15)} ${waiting} ${waiting === 1 ? 'person' : 'people'} currently waiting &middot; estimated wait ${fmtWaitDuration(waitEstimateMinutes(db, svcKey))}</div>`;
}
function computeReadiness(svc, attachments) {
  const required = svc && svc.requirements ? svc.requirements.length : 0;
  const have = (attachments || []).length;
  if (!required || have >= required) return { status: 'READY', label: 'Ready' };
  return { status: 'INCOMPLETE', label: `Incomplete — ${have} of ${required} requirement(s) attached` };
}
function readinessPillHtml(r) {
  if (!r) return '';
  const cls = r.status === 'READY' ? 'ready' : (r.status === 'FOR_REVIEW' ? 'review' : 'incomplete');
  return `<span class="readiness-pill ${cls}">${icon(r.status === 'READY' ? 'check' : 'alert', 12)} ${escapeHtml(r.label)}</span>`;
}
function findActiveDuplicate(db, idNumber, svcKeyOrLabel) {
  const id = String(idNumber || '').trim().toLowerCase();
  if (!id) return null;
  const q = db.queues.find(x => (x.idNumber || '').trim().toLowerCase() === id && ['Waiting', 'Called', 'Serving'].includes(x.status) && (x.serviceKey === svcKeyOrLabel || x.serviceLabel === svcKeyOrLabel));
  if (q) return { type: 'queue', entry: q };
  const a = db.appointments.find(x => (x.idNumber || '').trim().toLowerCase() === id && !x.queueId && ['Requested', 'Booked'].includes(x.status) && x.service === svcKeyOrLabel);
  return a ? { type: 'appointment', entry: a } : null;
}
function duplicateWarningHtml(dup) {
  if (!dup) return '';
  const desc = dup.type === 'queue'
    ? `You already have an active visit (${escapeHtml(queueRef(dup.entry))}) for this same service.`
    : `You already have a pending scheduled request (${escapeHtml(dup.entry.code)}) for this same service.`;
  return `<div class="dup-warn">${icon('alert', 13)} Possible duplicate visit: ${desc} You can still continue, and OSS staff will review both if needed.</div>`;
}
function visitorHistoryFor(db, idNumber) {
  const id = String(idNumber || '').trim().toLowerCase();
  if (!id) return [];
  const known = new Set(), rows = [];
  const mine = x => (x.idNumber || '').trim().toLowerCase() === id;
  db.transactions.filter(mine).forEach(t => { if (t.visitId) known.add(t.visitId); rows.push({ when: t.createdAt, label: serviceLabel(db, t.service), status: t.status, ref: t.visitId || t.code }); });
  db.appointments.filter(mine).forEach(a => { if (!known.has(a.visitId)) { known.add(a.visitId); rows.push({ when: a.createdAt, label: a.service, status: a.status, ref: a.visitId || a.code }); } });
  db.queues.filter(mine).forEach(q => { if (!known.has(q.visitId)) rows.push({ when: q.createdAt, label: serviceQueueLabel(db, q), status: q.status, ref: q.visitId || q.number }); });
  return rows.sort((a, b) => new Date(b.when) - new Date(a.when));
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ name: file.name, size: file.size, type: file.type, dataUrl: r.result });
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
async function readFilesAsAttachments(list) { return Promise.all(Array.from(list || []).map(readFileAsDataURL)); }
function attachChip(a) { return `<a class="attach-chip" href="${a.dataUrl}" download="${escapeHtml(a.name)}" target="_blank">${icon('paperclip', 13)}<span class="fname">${escapeHtml(a.name)}</span><span class="fsize">${fmtFileSize(a.size)}</span></a>`; }
function attachListHtml(list, emptyText) {
  if (!list || !list.length) return `<div class="no-attach">${emptyText || 'No files uploaded.'}</div>`;
  return `<div class="attach-list">${list.map(attachChip).join('')}</div>`;
}
function requirementsBoxHtml(svc) {
  return svc && svc.requirements && svc.requirements.length
    ? `<div class="req-box"><div class="req-title">Requirements needed</div><ul>${svc.requirements.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul></div>` : '';
}
function templatesBoxHtml(svc) {
  return svc && svc.templates && svc.templates.length
    ? `<div class="req-box"><div class="req-title">Forms to download</div>${attachListHtml(svc.templates)}</div>` : '';
}
function validateAttachments(files) {
  const problems = [], seen = new Set();
  Array.from(files || []).forEach(f => {
    if (!ALLOWED_ATTACHMENT_TYPES.some(t => f.type && f.type.startsWith(t))) problems.push(`"${f.name}" is not an image or PDF file.`);
    if (seen.has(f.name.toLowerCase())) problems.push(`"${f.name}" was selected more than once.`);
    seen.add(f.name.toLowerCase());
  });
  return problems;
}
function downloadCardAsPng(selector, filename) {
  const el = document.querySelector(selector);
  if (!el) { toast('Could not find the pass to download.', 'err'); return; }
  if (typeof html2canvas === 'undefined') { toast('Download tool failed to load. Check your connection.', 'err'); return; }
  html2canvas(el, { backgroundColor: null, scale: 3, useCORS: true }).then(canvas => {
    const a = document.createElement('a');
    a.download = `${filename}.png`; a.href = canvas.toDataURL('image/png');
    document.body.appendChild(a); a.click(); a.remove();
    toast('Download started.', 'ok');
  }).catch(() => toast('Could not generate the download. Please try again.', 'err'));
}

function icon(name, size = 17) {
  const p = {
    checkin: 'M9 12l2 2 4-4M5 4h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z',
    calendar: 'M8 2v4M16 2v4M3 9h18M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z',
    folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z',
    alert: 'M12 3l9 16H3l9-16zM12 10v4M12 17.5v.01',
    cap: 'M12 3l10 5-10 5L2 8l10-5zM6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5',
    chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
    users: 'M17 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M13 7a4 4 0 11-8 0 4 4 0 018 0M23 21v-2a4 4 0 00-3-3.87M17 3.13a4 4 0 010 7.75',
    search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35',
    idcard: 'M3 5h18v14H3V5zm4 4h.01M7 15h6M14 9h6M14 12h6',
    x: 'M18 6L6 18M6 6l12 12',
    check: 'M20 6L9 17l-5-5',
    chat: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
    paperclip: 'M21 11.5V7a4 4 0 00-8 0v10a3 3 0 006 0V9',
    home: 'M3 12l9-9 9 9M5 10v10h14V10',
    lock: 'M5 11h14v9H5v-9zM8 11V7a4 4 0 118 0v4',
    log: 'M4 4h16v16H4V4zM8 8h8M8 12h8M8 16h5',
    ticket: 'M4 8a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2a2 2 0 000-4V8zM10 6v2M10 11v2M10 16v2',
    megaphone: 'M3 11v2a2 2 0 002 2h1l3 5 1-1-1-4h5l6 4V6l-6 4H6a2 2 0 00-2 2z',
    arrowright: 'M5 12h14M13 5l7 7-7 7',
    download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
    clock: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 6v6l4 2',
  }[name] || 'M12 2v20';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p.split('M').filter(Boolean).map(seg => `<path d="M${seg}"/>`).join('')}</svg>`;
}
function toast(msg, type = 'ok') {
  const wrap = document.getElementById('toastWrap');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', type === 'err' ? 'alert' : 'status');
  el.innerHTML = `<span class="toast-ic">${icon(type === 'err' ? 'x' : 'check', 15)}</span><span class="toast-msg">${msg}</span><button type="button" class="toast-close" aria-label="Dismiss" onclick="this.closest('.toast').remove()">${icon('x', 12)}</button>`;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), type === 'err' ? 5500 : 3500);
}
function openModal(title, bodyHtml, buttons) {
  closeModal();
  const wrap = document.createElement('div');
  wrap.className = 'overlay'; wrap.id = 'activeModal';
  wrap.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" tabindex="-1">
      <div class="modal-head"><h3>${title}</h3><button class="close-x" id="modalCloseX" aria-label="Close">${icon('x', 18)}</button></div>
      <div class="modal-body">${bodyHtml}</div>
      <div class="modal-foot">${buttons.map((b, i) => `<button class="btn ${b.cls} btn-sm" id="modalBtn${i}">${b.label}</button>`).join('')}</div>
    </div>`;
  document.body.appendChild(wrap);
  buttons.forEach((b, i) => document.getElementById(`modalBtn${i}`).onclick = b.action);
  document.getElementById('modalCloseX').onclick = closeModal;
  wrap.addEventListener('click', e => { if (e.target === wrap) closeModal(); });
  wrap.querySelector('.modal').focus();
}
function closeModal() { const m = document.getElementById('activeModal'); if (m) m.remove(); }
function setTheme(t) {
  localStorage.setItem('ossuniserve_theme', t);
  document.documentElement.setAttribute('data-theme', t);
  document.querySelectorAll('[data-theme-btn]').forEach(b => b.classList.toggle('active', b.dataset.themeBtn === t));
}
setTheme(localStorage.getItem('ossuniserve_theme') || 'light');

function confirmSummaryHtml({ intro, notice, sections }) {
  const secs = (sections || []).map(s => {
    const rows = s.rows.filter(r => r[1]);
    if (!rows.length) return '';
    return `<section class="cf-sec"><h4 class="cf-sec-h">${escapeHtml(s.title)}</h4><dl class="cf-list">${rows.map(([l, v, strong]) => `<div class="cf-row${strong ? ' strong' : ''}"><dt>${escapeHtml(l)}</dt><dd>${escapeHtml(v)}</dd></div>`).join('')}</dl></section>`;
  }).join('');
  return `<div class="cf-sum">${intro ? `<p class="cf-intro">${intro}</p>` : ''}${secs}${notice ? `<p class="cf-notice">${icon('clock', 14)}<span>${notice}</span></p>` : ''}</div>`;
}
function confirmAction(title, bodyHtml, confirmLabel, onConfirm, onCancel, cancelLabel) {
  openModal(title, bodyHtml, [
    { label: cancelLabel || 'Cancel', cls: 'btn-ghost', action: () => { closeModal(); if (onCancel) onCancel(); } },
    { label: confirmLabel || 'Confirm', cls: 'btn-primary', action: () => { closeModal(); onConfirm(); } },
  ]);
}

function isSeniorFromClassification(type, guestClass) { return type === 'Guest' && guestClass === 'Senior Citizen'; }
function visitorTypeLabel(type, guestClass) { return guestClass ? `${type} (${guestClass})` : type; }
function idTypeSelectHtml(id) {
  return `<select id="${id}"><option value="" disabled selected>Select ID type</option>${VALID_ID_TYPES.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}</select>`;
}
function statusPill(status) {
  const map = { Open: 'pill-info', Closed: 'pill-danger', Pending: 'pill-warn', Processing: 'pill-info', Approved: 'pill-ok', Completed: 'pill-ok', Rejected: 'pill-danger', Requested: 'pill-warn', Booked: 'pill-info', 'Checked-in': 'pill-gold', Waiting: 'pill-warn', Called: 'pill-gold', Serving: 'pill-info', Skipped: 'pill-danger', Cancelled: 'pill-danger', 'No-show': 'pill-danger' };
  return `<span class="pill ${map[status] || 'pill-info'}">${status}</span>`;
}
function findVisitByRef(db, ref) {
  ref = normVisitRef(ref);
  if (!ref) return null;
  return db.queues.find(q => (q.visitId || '').toUpperCase() === ref) || db.appointments.find(a => (a.visitId || '').toUpperCase() === ref) || null;
}
function copyText(t) {
  const ok = () => toast('Copied.', 'ok'), bad = () => toast('Could not copy.', 'err');
  if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(t).then(ok, bad); return; }
  const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); ok(); } catch (e) { bad(); }
  ta.remove();
}

document.getElementById('crestSlotF').innerHTML = `<img src="pup.jpg" alt="PUP logo" style="width:44px;height:44px;object-fit:contain;">`;

const VISITOR_NAV = [
  { key: 'visit', label: 'Start a Visit', ic: 'ticket' },
  { key: 'checkvisit', label: 'Check My Visit', ic: 'search' },
  { key: 'history', label: 'Visit History', ic: 'log' },
  { key: 'chat', label: 'Chat with OSS', ic: 'chat' },
];
const VISITOR_TITLES = {
  visit: ['Start Your Visit', 'Choose a service and how you want to visit'],
  checkvisit: ['Check My Visit', 'See your live status or check in for an appointment'],
  history: ['Visit History', 'Look up your past visits'],
  chat: ['Chat with OSS', 'Send a message to the office'],
};

let visitorView = 'visit';
let visitStep = sessionStorage.getItem('oss_visitStep') || 'pick';
let visitVisitorType = sessionStorage.getItem('oss_visitVisitorType') || 'Student';
let visitGuestClass = sessionStorage.getItem('oss_visitGuestClass') || null;
let visitSelectedService = (() => {
  try { const k = JSON.parse(sessionStorage.getItem('oss_visitSelectedService') || 'null'); const key = k && typeof k === 'object' ? k.key : k; return key ? findService(loadDB(), key) || null : null; }
  catch (e) { return null; }
})();
let myActiveQueueId = sessionStorage.getItem('oss_myActiveQueueId') || null;
let currentPublicChatId = localStorage.getItem('oss_chat_id') || null;
let ticketPollTimer = null;
let chatPollTimer = null;
let scheduleAttachments = [];
let feedbackStars = 0;
let chatFlow = null;

function persistSession() {
  sessionStorage.setItem('oss_visitStep', visitStep);
  sessionStorage.setItem('oss_visitVisitorType', visitVisitorType);
  sessionStorage.setItem('oss_visitGuestClass', visitGuestClass || '');
  sessionStorage.setItem('oss_visitSelectedService', JSON.stringify(visitSelectedService ? visitSelectedService.key : null));
  sessionStorage.setItem('oss_myActiveQueueId', myActiveQueueId || '');
  localStorage.setItem('oss_chat_id', currentPublicChatId || '');
}
function resetVisit() {
  myActiveQueueId = null; visitStep = 'pick'; visitSelectedService = null;
  persistSession();
  navigateVisitor('visit');
}

(function initFromUrl() {
  const flow = new URLSearchParams(location.search).get('flow');
  if (flow && VISITOR_TITLES[flow]) visitorView = flow;
})();

let portalWasOpen = isOfficeHours();
function hideClosedScreen() { const el = document.getElementById('closedScreen'); if (el) el.remove(); document.body.style.overflow = ''; }
function renderClosedScreen() {
  closeModal();
  stopTicketPolling(); stopChatPolling();
  if (document.getElementById('closedScreen')) return;
  const el = document.createElement('div');
  el.id = 'closedScreen';
  el.setAttribute('role', 'alert');
  el.innerHTML = `
    <div class="closed-card">
      <h1>OSS is closed</h1>
      <p>Open daily, ${officeHoursLabel()}.</p>
      <p>Please come back ${nextOpeningLabel()}.</p>
      <a href="../Landing/landing.html">Back to Home</a>
    </div>`;
  document.body.appendChild(el);
  document.body.style.overflow = 'hidden';
}
function checkPortalHours() {
  const open = isOfficeHours();
  if (open === portalWasOpen) return;
  portalWasOpen = open;
  closeModal();
  if (open) toast('OSS is now open. Welcome!', 'ok');
  navigateVisitor(visitorView);
}
setInterval(checkPortalHours, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkPortalHours(); });

function maintenanceOn() { return !!loadDB().systemSettings.maintenanceMode; }
function renderMaintenanceNotice() {
  document.getElementById('visitorContent').innerHTML = `
    <div class="card card-pad visitor-page-wrap">
      <div class="info-banner warn">${icon('alert', 14)} The visitor portal is closed for maintenance.</div>
      <p style="font-size:.9rem; line-height:1.6; color:var(--text-soft); margin-bottom:16px;">New visits can't be started right now. You can still look up an existing visit, and the front desk can help you in person.</p>
      <button class="btn btn-primary" onclick="navigateVisitor('checkvisit')">${icon('search', 15)} Check My Visit</button>
    </div>`;
}

function navigateVisitor(key) {
  stopTicketPolling(); stopChatPolling();
  visitorView = key;
  document.getElementById('visitorPageTitle').textContent = VISITOR_TITLES[key][0];
  document.getElementById('visitorPageSub').textContent = VISITOR_TITLES[key][1];
  renderVisitorSidebar();
  document.getElementById('visitorSidebar').classList.remove('open');
  portalWasOpen = isOfficeHours();
  if (!portalWasOpen) { renderClosedScreen(); return; }
  hideClosedScreen();
  ({ visit: renderVisitScreen, checkvisit: renderCheckVisitScreen, history: renderHistoryScreen, chat: renderChatScreen })[key]();
}
function renderVisitorSidebar() {
  const db = loadDB();
  const unread = currentPublicChatId ? (db.chats.find(c => c.id === currentPublicChatId)?.visitorUnread || 0) : 0;
  document.getElementById('visitorNavList').innerHTML = VISITOR_NAV.map(n => {
    const badge = n.key === 'chat' ? unread : 0;
    return `<li><button class="nav-item ${visitorView === n.key ? 'active' : ''}" onclick="navigateVisitor('${n.key}')">${icon(n.ic)}<span>${n.label}</span>${badge ? `<span class="nav-badge">${badge}</span>` : ''}</button></li>`;
  }).join('');
}

function stepperHtml(n) {
  return `<nav class="stepper" aria-label="Progress">${UX_STEPS.map((label, i) => {
    const s = i + 1, cls = s < n ? 'done' : (s === n ? 'current' : '');
    const inner = `<span class="stepper-n">${s < n ? icon('check', 11) : s}</span><span class="stepper-l">${label}</span>`;
    const attrs = s < n ? `onclick="uxGoStep(${s})"` : `disabled ${s === n ? 'aria-current="step"' : ''}`;
    return `<button type="button" class="stepper-i ${cls}" ${attrs}>${inner}</button>`;
  }).join('<span class="stepper-sep"></span>')}</nav>`;
}
function uxGoStep(s) { visitStep = s === 1 ? 'pick' : 'choose'; persistSession(); renderVisitScreen(); }

function renderVisitScreen() {
  if (!isOfficeHours()) { renderClosedScreen(); return; }
  if (myActiveQueueId) {
    if (loadDB().queues.some(x => x.id === myActiveQueueId)) { visitStep = 'ticket'; persistSession(); renderQueueTicket(); return; }
    myActiveQueueId = null; persistSession();
  }
  if (maintenanceOn()) { renderMaintenanceNotice(); return; }
  if (visitStep === 'choose' && visitSelectedService) renderVisitChoose();
  else if (visitStep === 'walkin' && visitSelectedService) renderVisitWalkinForm();
  else if (visitStep === 'schedule' && visitSelectedService) renderVisitScheduleForm();
  else { visitStep = 'pick'; renderVisitPicker(); }
}
function renderVisitPicker() {
  const db = loadDB();
  document.getElementById('visitorContent').innerHTML = `
    ${stepperHtml(1)}
    <div class="ux-filters">
      <div class="ux-field">
        <span class="ux-label" id="vtLbl">I am a</span>
        <div class="seg" id="vtChooser" role="radiogroup" aria-labelledby="vtLbl">
          ${VISITOR_TYPES.map(o => `<button type="button" class="seg-btn ${visitVisitorType === o.t ? 'active' : ''}" role="radio" aria-checked="${visitVisitorType === o.t}" data-type="${o.t}" title="${escapeHtml(o.sub)}" onclick="setVisitorType('${o.t}')">${icon(o.ic, 16)}<span>${o.t}</span></button>`).join('')}
        </div>
      </div>
      <div class="ux-field" id="vtGuestClassBlock" ${visitVisitorType === 'Guest' ? '' : 'hidden'}>
        <label class="ux-label" for="guestClassSel">Guest type <em>(optional)</em></label>
        <select class="ux-select" id="guestClassSel" onchange="setGuestClassSel(this.value)">
          <option value="">Not applicable</option>
          ${GUEST_CLASSES.map(o => `<option value="${o.t}" ${visitGuestClass === o.t ? 'selected' : ''}>${o.t}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="ux-search">${icon('search', 18)}<input id="svcSearch" type="search" placeholder="Search services (e.g. good moral, ID, scholarship)" autocomplete="off" aria-label="Search services" oninput="filterServices(this.value)"></div>
    <div class="svc-list" id="svcList">
      ${db.services.map(s => `
        <button type="button" class="svc-item" data-q="${escapeHtml((s.label + ' ' + (s.desc || '')).toLowerCase())}" onclick="pickVisitService('${s.key}')">
          <span class="svc-item-ic">${icon(s.icon || 'home', 20)}</span>
          <span class="svc-item-tx"><b>${escapeHtml(s.label)}</b><small>${escapeHtml(s.desc || '')}</small></span>
          <span class="svc-item-go">${icon('arrowright', 16)}</span>
        </button>`).join('')}
    </div>
    <div class="cvx-empty" id="svcEmpty" hidden>No service matches your search. Try &ldquo;Other Student Services Documentation&rdquo; for anything not listed.</div>`;
}
function filterServices(v) {
  const q = (v || '').trim().toLowerCase();
  let shown = 0;
  document.querySelectorAll('#svcList .svc-item').forEach(el => { const ok = !q || el.dataset.q.includes(q); el.hidden = !ok; if (ok) shown++; });
  const empty = document.getElementById('svcEmpty');
  if (empty) empty.hidden = shown > 0;
}
function setVisitorType(t) {
  visitVisitorType = t;
  if (t !== 'Guest') visitGuestClass = null;
  persistSession();
  document.querySelectorAll('#vtChooser .seg-btn').forEach(b => { const on = b.dataset.type === t; b.classList.toggle('active', on); b.setAttribute('aria-checked', String(on)); });
  const block = document.getElementById('vtGuestClassBlock');
  if (block) { block.hidden = t !== 'Guest'; const sel = document.getElementById('guestClassSel'); if (sel) sel.value = visitGuestClass || ''; }
}
function setGuestClassSel(v) { visitGuestClass = v || null; persistSession(); }
function pickVisitService(key) {
  visitSelectedService = findService(loadDB(), key);
  visitStep = 'choose';
  persistSession();
  renderVisitChoose();
}
function renderVisitChoose() {
  const svc = visitSelectedService, db = loadDB();
  document.getElementById('visitorContent').innerHTML = `
    ${stepperHtml(2)}
    <div class="svc-selected-bar">
      <div class="lbl">${icon(svc.icon || 'home', 16)} &nbsp;${escapeHtml(svc.label)}<small>${escapeHtml(visitorTypeLabel(visitVisitorType, visitGuestClass))} &middot; Selected service</small></div>
      <button class="btn btn-ghost btn-sm" onclick="uxGoStep(1)">Change service</button>
    </div>
    ${requirementsBoxHtml(svc)}${templatesBoxHtml(svc)}
    ${waitEstimateHtml(db, svc.key)}
    <div class="entry-method-grid">
      <button class="svc-card entry-method-card" onclick="startWalkIn()">
        <span class="svc-ic">${icon('ticket', 22)}</span><h3>Walk In</h3>
        <p>Get your Visit Pass and queue number now.</p>
        <span class="svc-go">Get a queue number &rarr;</span>
      </button>
      <button class="svc-card entry-method-card" onclick="startSchedule()">
        <span class="svc-ic">${icon('calendar', 22)}</span><h3>Schedule Ahead</h3>
        <p>Request a slot. Scheduled visits are served before walk-ins.</p>
        <span class="svc-go">Book a date &amp; time &rarr;</span>
      </button>
    </div>`;
}
function selectedBarHtml(ic, title, svc) {
  return `<div class="svc-selected-bar">
      <div class="lbl">${icon(ic, 16)} &nbsp;${title}<small>${escapeHtml(visitorTypeLabel(visitVisitorType, visitGuestClass))} &middot; ${escapeHtml(svc.label)}</small></div>
      <button class="btn btn-ghost btn-sm" onclick="uxGoStep(2)">Change entry method</button>
    </div>`;
}
function visitorFieldsHtml(p, isStudent) {
  const P = p.charAt(0).toUpperCase() + p.slice(1);
  return `
    <div class="form-row">
      <div class="field" id="fw${P}First"><label for="${p}First">First name ${uxReq}</label><input id="${p}First" placeholder="Juan" autocomplete="given-name" oninput="autoCapitalizeInput(this)"><div class="field-error"></div></div>
      <div class="field" id="fw${P}Last"><label for="${p}Last">Last name ${uxReq}</label><input id="${p}Last" placeholder="Dela Cruz" autocomplete="family-name" oninput="autoCapitalizeInput(this)"><div class="field-error"></div></div>
    </div>
    ${isStudent
      ? `<div class="field" id="fw${P}IdNum"><label for="${p}IdNum">Student number ${uxReq}</label><input id="${p}IdNum" inputmode="numeric" maxlength="15" placeholder="0000-00000-SM-0" autocomplete="off" oninput="maskStudentNoInput(this)"><div class="field-error"></div></div>`
      : `<div class="form-row">
          <div class="field" id="fw${P}IdType"><label for="${p}IdType">Valid ID type ${uxReq}</label>${idTypeSelectHtml(p + 'IdType')}<div class="field-error"></div></div>
          <div class="field" id="fw${P}IdNum"><label for="${p}IdNum">Valid ID number ${uxReq}</label><input id="${p}IdNum" placeholder="ID number" autocomplete="off"><div class="field-error"></div></div>
        </div>`}`;
}
function validateVisitorFields(p, isStudent) {
  const P = p.charAt(0).toUpperCase() + p.slice(1);
  const v = id => document.getElementById(p + id).value.trim();
  const first = v('First'), last = v('Last'), contact = v('Contact');
  const idType = isStudent ? '' : document.getElementById(p + 'IdType').value;
  const idNumber = v('IdNum').toUpperCase();
  const email = v('Email');
  let ok = true;
  ok = markField(`fw${P}First`, isValidPersonName(first), 'Enter your first name.') && ok;
  ok = markField(`fw${P}Last`, isValidPersonName(last), 'Enter your last name.') && ok;
  if (isStudent) ok = markField(`fw${P}IdNum`, isValidStudentNo(idNumber), 'Use the format 0000-00000-SM-0.') && ok;
  else {
    ok = markField(`fw${P}IdType`, !!idType, 'Select the type of ID you will present.') && ok;
    ok = markField(`fw${P}IdNum`, isValidIdNumber(idNumber), 'Enter your ID number (at least 3 characters).') && ok;
  }
  ok = markField(`fw${P}Contact`, isValidContact(contact), 'Enter a valid PH mobile number (e.g. 0917-123-4567).') && ok;
  ok = markField(`fw${P}Email`, isValidEmail(email), 'Enter a valid email address.') && ok;
  if (!ok) { toast('Please fix the highlighted fields.', 'err'); focusFirstError(); return null; }
  return { first, last, idType, idNumber, contact, email };
}

function startWalkIn() { visitStep = 'walkin'; persistSession(); renderVisitWalkinForm(); }
function renderVisitWalkinForm() {
  const svc = visitSelectedService, db = loadDB(), isStudent = visitVisitorType === 'Student';
  document.getElementById('visitorContent').innerHTML = `
    ${stepperHtml(3)}
    ${selectedBarHtml('ticket', 'Walk In', svc)}
    <div class="card card-pad visitor-page-wrap" onkeydown="uxEnter(event,'confirmWalkInPrompt')">
      ${waitEstimateHtml(db, svc.key)}
      ${visitorFieldsHtml('q', isStudent)}
      <div class="field" id="fwQContact"><label for="qContact">Contact number ${uxReq}</label><input id="qContact" type="tel" inputmode="tel" autocomplete="tel" maxlength="16" placeholder="09XX-XXX-XXXX" oninput="formatContactInput(this)"><div class="field-error"></div></div>
      <div class="field" id="fwQEmail"><label for="qEmail">Email address ${uxReq}</label><input id="qEmail" type="email" autocomplete="email" placeholder="juan.delacruz@example.com" required><div class="field-error"></div></div>
      <p class="field-hint" style="margin-bottom:14px;">Fields marked * are required. After you get your number, watch the &ldquo;Now Serving&rdquo; board and go to OSS when called.</p>
      <button class="btn btn-gold btn-block" onclick="confirmWalkInPrompt()">${icon('ticket', 16)} Get My Queue Number</button>
    </div>`;
}
function confirmWalkInPrompt() {
  if (!isOfficeHours()) { toast(`Walk-in queue numbers can only be issued ${officeHoursLabel()}.`, 'err'); renderClosedScreen(); return; }
  if (maintenanceOn()) { toast('The visitor portal is closed for maintenance.', 'err'); renderMaintenanceNotice(); return; }
  const svc = visitSelectedService, isStudent = visitVisitorType === 'Student';
  const vals = validateVisitorFields('q', isStudent);
  if (!vals) return;
  const isSenior = isSeniorFromClassification(visitVisitorType, visitGuestClass);
  const name = joinName(vals.first, vals.last);
  const dup = findActiveDuplicate(loadDB(), vals.idNumber, svc.key);
  const body = duplicateWarningHtml(dup) + confirmSummaryHtml({
    intro: 'Please check your details before you get your queue number.',
    sections: [
      { title: 'Your visit', rows: [['Service', svc.label, true], ['Entry method', 'Walk-in'], ['Priority', isSenior ? 'Senior citizen (priority lane)' : '']] },
      { title: 'About you', rows: [['Name', name, true], ['Visitor type', visitorTypeLabel(visitVisitorType, visitGuestClass)], ['ID type', vals.idType], [isStudent ? 'Student number' : 'ID number', vals.idNumber], ['Contact number', vals.contact]] },
    ],
    notice: 'Your queue number is issued right after you confirm.',
  });
  confirmAction('Confirm your walk-in', body, 'Get My Queue Number', () => confirmWalkIn(!!dup, vals, name, isSenior), null, 'Edit details');
}
function confirmWalkIn(possibleDuplicate, vals, name, isSenior) {
  if (!isOfficeHours()) { toast(`Walk-in queue numbers can only be issued ${officeHoursLabel()}.`, 'err'); renderClosedScreen(); return; }
  const svc = visitSelectedService, db = loadDB();
  const entry = addToQueue(db, {
    visitorType: visitVisitorType, serviceKey: svc.key, serviceLabel: svc.label, source: 'Walk-in',
    name, idNumber: vals.idNumber, idType: vals.idType, guestClass: visitGuestClass, contact: vals.contact,
    isSenior, visitId: nextVisitId(db), possibleDuplicate,
  });
  logActivity(db, VISITOR_ACTOR, `Joined queue ${entry.number} (${entry.visitId}) &mdash; walk-in, ${entry.serviceLabel}`, { category: 'Queue', target: entry.visitId });
  saveDB(db);
  myActiveQueueId = entry.id; visitStep = 'ticket'; persistSession();
  toast(`Visit ${entry.visitId} started &mdash; queue number ${entry.number}.`, 'ok');
  renderQueueTicket();
}

function startSchedule() { scheduleAttachments = []; visitStep = 'schedule'; persistSession(); renderVisitScheduleForm(); }
function renderVisitScheduleForm() {
  const svc = visitSelectedService, openNow = isOfficeHours(), isStudent = visitVisitorType === 'Student', reqs = svc.requirements || [];
  document.getElementById('visitorContent').innerHTML = `
    ${stepperHtml(3)}
    ${selectedBarHtml('calendar', 'Schedule Ahead', svc)}
    <div class="card card-pad visitor-page-wrap" onkeydown="uxEnter(event,'confirmSchedulePrompt')">
      ${officeHoursBannerHtml('appointment')}
      ${visitorFieldsHtml('bk', isStudent)}
      <div class="form-row">
        <div class="field" id="fwBkContact"><label for="bkContact">Contact number ${uxReq}</label><input id="bkContact" type="tel" inputmode="tel" autocomplete="tel" maxlength="16" placeholder="09XX-XXX-XXXX" oninput="formatContactInput(this)"><div class="field-error"></div></div>
        <div class="field" id="fwBkEmail"><label for="bkEmail">Email address ${uxReq}</label><input id="bkEmail" type="email" autocomplete="email" placeholder="juan.delacruz@email.com"><div class="field-error"></div></div>
      </div>
      <div class="field">
        <label for="bkFiles">Upload requirements <span class="opt">(PDF or image)</span></label>
        ${templatesBoxHtml(svc)}
        ${reqs.length ? `<div class="req-chips">${reqs.map(r => `<span class="req-chip">${escapeHtml(r)}</span>`).join('')}</div>` : ''}
        <label class="dropzone" for="bkFiles" ondragover="event.preventDefault(); this.classList.add('drag')" ondragleave="this.classList.remove('drag')" ondrop="uxDropFiles(event)">
          ${icon('paperclip', 20)}<span><b>Choose files</b> or drag them here</span><small>PDF, JPG or PNG &middot; up to 2 MB each</small>
        </label>
        <input id="bkFiles" type="file" multiple hidden accept="application/pdf,image/*" onchange="handleScheduleFilesChange(this)">
        <div id="bkReadiness"></div><div id="bkAttachPreview"></div>
      </div>
      <p class="field-hint" style="margin-bottom:14px;">Fields marked * are required. OSS will assign your date and time and email your pass. Scheduled visits are served before walk-ins, when your time arrives.</p>
      <button class="btn btn-primary btn-block" id="bkSubmitBtn" ${openNow ? '' : 'disabled'} onclick="confirmSchedulePrompt()">${openNow ? 'Submit Appointment Request' : 'Available during office hours'}</button>
    </div>`;
  updateScheduleAttachUI();
}
function uxDropFiles(e) { e.preventDefault(); e.currentTarget.classList.remove('drag'); addScheduleFiles(e.dataTransfer.files); }
function handleScheduleFilesChange(inputEl) { const files = Array.from(inputEl.files || []); inputEl.value = ''; return addScheduleFiles(files); }
async function addScheduleFiles(fileList) {
  const accepted = [];
  for (const f of Array.from(fileList || [])) {
    const name = f.name.toLowerCase();
    if (!ALLOWED_ATTACHMENT_TYPES.some(t => f.type && f.type.startsWith(t))) { toast(`"${escapeHtml(f.name)}" is not a PDF or image.`, 'err'); continue; }
    if (f.size > UX_MAX_FILE) { toast(`"${escapeHtml(f.name)}" is over 2 MB.`, 'err'); continue; }
    if (scheduleAttachments.some(a => a.name.toLowerCase() === name) || accepted.some(a => a.name.toLowerCase() === name)) { toast(`"${escapeHtml(f.name)}" is already attached.`, 'err'); continue; }
    accepted.push(f);
  }
  if (!accepted.length) return;
  try { scheduleAttachments = scheduleAttachments.concat(await readFilesAsAttachments(accepted)); }
  catch (e) { toast('Could not read one of the uploaded files.', 'err'); }
  updateScheduleAttachUI();
}
function removeScheduleFile(i) { scheduleAttachments.splice(i, 1); updateScheduleAttachUI(); }
function updateScheduleAttachUI() {
  const prev = document.getElementById('bkAttachPreview');
  if (!prev) return;
  prev.innerHTML = scheduleAttachments.length
    ? `<div class="attach-list">${scheduleAttachments.map((a, i) => `<div class="attach-row">${attachChip(a)}<button type="button" class="attach-x" aria-label="Remove ${escapeHtml(a.name)}" onclick="removeScheduleFile(${i})">${icon('x', 14)}</button></div>`).join('')}</div>` : '';
  const svc = visitSelectedService, r = document.getElementById('bkReadiness');
  if (r) r.innerHTML = svc && svc.requirements && svc.requirements.length ? readinessPillHtml(computeReadiness(svc, scheduleAttachments)) : '';
}
function confirmSchedulePrompt() {
  if (!isOfficeHours()) { toast(`Appointment requests can only be submitted ${officeHoursLabel()}.`, 'err'); renderClosedScreen(); return; }
  if (maintenanceOn()) { toast('The visitor portal is closed for maintenance.', 'err'); renderMaintenanceNotice(); return; }
  const svc = visitSelectedService, isStudent = visitVisitorType === 'Student';
  const vals = validateVisitorFields('bk', isStudent);
  if (!vals) return;
  const isSenior = isSeniorFromClassification(visitVisitorType, visitGuestClass);
  const name = joinName(vals.first, vals.last);
  const dup = findActiveDuplicate(loadDB(), vals.idNumber, svc.label);
  const readiness = computeReadiness(svc, scheduleAttachments);
  const files = scheduleAttachments.length ? scheduleAttachments.map(f => f.name).join(', ') : 'No files uploaded';
  const body = duplicateWarningHtml(dup) + confirmSummaryHtml({
    intro: 'Please check your request before you send it to OSS.',
    sections: [
      { title: 'Your visit', rows: [['Service', svc.label, true], ['Entry method', 'Scheduled appointment'], ['Priority', isSenior ? 'Senior citizen (priority lane)' : '']] },
      { title: 'About you', rows: [['Name', name, true], ['Visitor type', visitorTypeLabel(visitVisitorType, visitGuestClass)], ['ID type', vals.idType], [isStudent ? 'Student number' : 'ID number', vals.idNumber]] },
      { title: 'How we reach you', rows: [['Contact number', vals.contact], ['Email', vals.email, true]] },
      { title: 'Requirements', rows: [['Files', files], ['Status', readiness.label]] },
    ],
    notice: 'OSS will assign your date and time and email your pass. You will not get a queue number &mdash; you are called when your scheduled time arrives.',
  });
  confirmAction('Confirm your appointment request', body, 'Submit Request', () => confirmSchedule(!!dup, readiness.status, vals, name, isSenior), null, 'Edit details');
}
function confirmSchedule(possibleDuplicate, readinessStatus, vals, name, isSenior) {
  if (!isOfficeHours()) { toast(`Appointment requests can only be submitted ${officeHoursLabel()}.`, 'err'); renderClosedScreen(); return; }
  const svc = visitSelectedService, btn = document.getElementById('bkSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }
  const db = loadDB();
  const appt = mkAppt({
    visitId: nextVisitId(db), name, type: visitVisitorType, guestClass: visitGuestClass, idNumber: vals.idNumber, idType: vals.idType,
    contact: vals.contact, email: vals.email, service: svc.label, date: null, time: null, status: 'Requested',
    attachments: scheduleAttachments, isSenior, createdAt: new Date(), readiness: readinessStatus, possibleDuplicate,
  });
  db.appointments.push(appt);
  logActivity(db, VISITOR_ACTOR, `Requested appointment ${appt.visitId} (${appt.code}) &mdash; ${appt.service}`, { category: 'Appointments', target: appt.visitId });
  saveDB(db);
  scheduleAttachments = [];
  toast('Appointment request submitted.', 'ok');
  showPassModal(appt);
}

function appointmentPassHtml(appt) {
  const slot = appt.date ? `${appt.date} &middot; ${escapeHtml(appt.time || '')}` : 'Awaiting date &amp; time from OSS';
  const seniorNote = appt.isSenior && appt.guestClass !== 'Senior Citizen' ? ' &middot; Senior' : '';
  return `
    <div class="printable-ticket">
      <div class="ticket-v2-card">
        <div class="ticket-v2-main">
          <div class="ticket-v2-top">
            <div class="ticket-v2-header">
              <img src="pup.jpg" alt="PUP logo" class="ticket-v2-logo">
              <div class="ticket-v2-org"><div class="ticket-v2-org-uni">Polytechnic University of the Philippines</div><div class="ticket-v2-org-sub">Santa Maria Campus &middot; Office of Student Services</div></div>
              <div class="ticket-v2-issued">Requested<br>${fmtDateTime(appt.createdAt)}</div>
            </div>
            <div class="ticket-v2-body">
              <div class="ticket-v2-line">Scheduled appointment</div>
              <div class="ticket-v2-number">${escapeHtml(appt.visitId)}</div>
              <div class="ticket-v2-service">${escapeHtml(appt.service)}</div>
              <div class="ticket-v2-type">${icon(appt.type === 'Student' ? 'cap' : 'users', 13)} ${escapeHtml(visitorTypeLabel(appt.type, appt.guestClass))}${seniorNote}</div>
            </div>
          </div>
          <div class="ticket-v2-seam"></div>
          <div class="ticket-v2-bottom">
            <div class="ticket-v2-grid">
              <div class="ticket-v2-field"><span class="tvf-lbl">${icon('calendar', 13)} Scheduled</span><span class="tvf-val">${slot}</span></div>
              <div class="ticket-v2-field"><span class="tvf-lbl">${icon('ticket', 13)} Reference</span><span class="tvf-val">${escapeHtml(appt.code)}</span></div>
              <div class="ticket-v2-field"><span class="tvf-lbl">${icon('users', 13)} Visitor</span><span class="tvf-val">${escapeHtml(appt.name)}</span></div>
              <div class="ticket-v2-field"><span class="tvf-lbl">${icon('checkin', 13)} Status</span><span class="tvf-val">${escapeHtml(String(appt.status).toUpperCase())}</span></div>
            </div>
            <p class="ticket-v2-fine-print">No queue number is issued for scheduled visits. Show this Visit ID at the front desk &mdash; you are called when your scheduled time arrives, ahead of walk-ins.</p>
          </div>
        </div>
        <div class="ticket-v2-stub"><div class="ticket-v2-stub-inner"><span class="ticket-v2-stub-lbl">Visit ID</span><span class="ticket-v2-stub-num">${escapeHtml(appt.visitId)}</span><span class="ticket-v2-stub-id">${escapeHtml(appt.code)}</span></div></div>
      </div>
    </div>`;
}
function requirementsBlockHtml(db, appt) {
  const svc = findService(db, appt.service) || { requirements: [] };
  return `<div style="margin-top:14px;"><label style="display:block; font-size:.78rem; font-weight:600; margin-bottom:6px; color:var(--text-soft);">Uploaded requirements</label>${readinessPillHtml(computeReadiness(svc, appt.attachments))}${attachListHtml(appt.attachments, 'No files uploaded with this booking.')}</div>`;
}
function showPassModal(appt) {
  const db = loadDB();
  openModal(`Appointment request sent &mdash; ${escapeHtml(appt.visitId)}`, `
    ${appointmentPassHtml(appt)}
    <p class="field-hint" style="margin-top:14px;">Your request is with OSS. Once a date and time is assigned you will receive your pass at ${escapeHtml(appt.email)}. On the day, show your Visit ID at the front desk. You can look it up anytime under &ldquo;Check My Visit&rdquo; with your Visit ID ${escapeHtml(appt.visitId)}.</p>
    ${requirementsBlockHtml(db, appt)}`, [
    { label: 'Download', cls: 'btn-ghost', action: () => downloadCardAsPng('.printable-ticket', `visit-pass-${appt.visitId}`) },
    { label: 'Done', cls: 'btn-primary', action: () => { closeModal(); resetVisit(); } },
  ]);
}

function timelineStepsHtml(q) {
  const steps = [
    { lbl: 'Checked In', ic: 'checkin', ts: q.checkedInAt || q.createdAt },
    { lbl: 'Called', ic: 'megaphone', ts: q.calledAt },
    { lbl: 'Service Started', ic: 'clock', ts: q.servingAt },
    { lbl: 'Completed', ic: 'check', ts: q.completedAt },
  ];
  let lastDone = -1;
  steps.forEach((s, i) => { if (s.ts) lastDone = i; });
  const allDone = lastDone === steps.length - 1;
  return `<div class="vjt-v">${steps.map((s, i) => {
    const done = !!s.ts, cur = !allDone && i === lastDone;
    return `<div class="vjt-v-step ${done ? 'done' : ''} ${cur ? 'current' : ''}">
      <div class="vjt-v-dotcol"><div class="vjt-v-dot">${icon(done ? 'check' : s.ic, 15)}</div>${i < steps.length - 1 ? '<div class="vjt-v-line"></div>' : ''}</div>
      <div class="vjt-v-body"><div class="vjt-v-lbl">${s.lbl}</div><div class="vjt-v-ts">${s.ts ? fmtDateTime(s.ts) : 'Pending'}</div></div></div>`;
  }).join('')}</div>`;
}
function feedbackSectionHtml(q) {
  if (q.status !== 'Completed') return '';
  if (q.feedback) {
    return `<div class="fb-card fb-card-done"><h3>${icon('check', 12)} Feedback Received</h3>
      <div class="fb-stars fb-stars-static">${[1, 2, 3, 4, 5].map(n => `<span class="fb-star ${n <= q.feedback.rating ? 'on' : ''}">&#9733;</span>`).join('')}</div>
      ${q.feedback.comment ? `<p class="fb-comment-echo">&ldquo;${escapeHtml(q.feedback.comment)}&rdquo;</p>` : ''}
      <p class="fb-thanks">Thank you for helping OSS improve.</p></div>`;
  }
  return `<div class="fb-card"><h3>Rate Your Visit</h3><p class="fb-card-sub">How was your experience with OSS today?</p>
    <div class="fb-stars" id="fbStars">${[1, 2, 3, 4, 5].map(n => `<button type="button" class="fb-star" data-n="${n}" onclick="setFeedbackStars(${n})">&#9733;</button>`).join('')}</div>
    <textarea id="fbComment" maxlength="${FEEDBACK_MAX}" placeholder="Optional comment..."></textarea>
    <button class="btn btn-primary btn-block btn-sm" onclick="submitVisitFeedback('${q.id}')">Submit Feedback</button></div>`;
}
function setFeedbackStars(n) { feedbackStars = n; document.querySelectorAll('#fbStars .fb-star').forEach(b => b.classList.toggle('on', Number(b.dataset.n) <= n)); }
function submitVisitFeedback(queueId) {
  if (!feedbackStars) { toast('Please select a star rating.', 'err'); return; }
  const db = loadDB(), q = db.queues.find(x => x.id === queueId);
  if (!q) return;
  q.feedback = { rating: feedbackStars, comment: (document.getElementById('fbComment')?.value || '').trim().slice(0, FEEDBACK_MAX), submittedAt: new Date() };
  saveDB(db); feedbackStars = 0;
  toast('Thanks for your feedback!', 'ok');
  renderQueueTicket();
}
function renderQueueTicket() {
  if (!isOfficeHours()) { renderClosedScreen(); return; }
  const db = loadDB(), q = db.queues.find(x => x.id === myActiveQueueId);
  if (!q) { resetVisit(); return; }
  const isAppt = q.source === 'Appointment';
  const due = isDue(q);
  const ahead = q.status === 'Waiting' ? peopleAheadOf(db, q.id) : 0;
  const etaMin = ahead * historicalAvgMinutes(db, q.serviceKey || q.serviceLabel);
  const linkedAppt = q.appointmentId ? db.appointments.find(a => a.id === q.appointmentId) : null;
  const slotText = q.scheduledAt ? fmtTime(q.scheduledAt) : '';
  const ref = queueRef(q);

  let topLine = '';
  if (q.status === 'Called') topLine = `<div class="ticket-v2-line ticket-v2-callout">${icon('megaphone', 15)} It's your turn &mdash; proceed to ${escapeHtml(q.assignedAdminName || 'the OSS Admin')}</div>`;
  else if (q.status === 'Serving') topLine = `<div class="ticket-v2-line">Currently being assisted by ${escapeHtml(q.assignedAdminName || 'the OSS Admin')}</div>`;
  else if (q.status === 'Skipped') topLine = `<div class="ticket-v2-line ticket-v2-warn">${icon('alert', 13)} We called you but couldn't reach you &mdash; please see the front desk.</div>`;
  else if (q.status === 'Cancelled') topLine = `<div class="ticket-v2-line ticket-v2-warn">${icon('x', 13)} This visit was cancelled.</div>`;
  else if (isAppt && q.status === 'Waiting') topLine = `<div class="ticket-v2-line">Scheduled appointment</div>`;

  let waitBanner = '';
  if (q.status === 'Waiting') {
    if (isAppt && !due) waitBanner = `<div class="wait-estimate">${icon('clock', 15)} Your slot is at ${slotText} &mdash; you will be called when it arrives</div>`;
    else if (ahead === 0) waitBanner = `<div class="wait-estimate">${icon('clock', 15)} You're next &mdash; no one ahead of you</div>`;
    else waitBanner = `<div class="wait-estimate">${icon('clock', 15)} ${ahead} ${ahead === 1 ? 'person' : 'people'} ahead of you &middot; estimated wait ${fmtWaitDuration(etaMin)}</div>`;
  }

  const finished = ['Completed', 'Skipped', 'Cancelled'].includes(q.status), isDone = q.status === 'Completed';
  const seniorNote = q.isSenior && q.guestClass !== 'Senior Citizen' ? ' &middot; Senior' : '';
  const dupBadge = q.possibleDuplicate ? `<div class="qt-source-note ticket-v2-dup">${icon('alert', 11)} Flagged for OSS review as a possible duplicate visit</div>` : '';
  const firstField = isAppt
    ? `<span class="tvf-lbl">${icon('calendar', 13)} Scheduled</span><span class="tvf-val">${q.scheduledAt ? fmtDateTime(q.scheduledAt) : '&mdash;'}</span>`
    : `<span class="tvf-lbl">${icon('ticket', 13)} Visit ID</span><span class="tvf-val">${escapeHtml(q.visitId)}</span>`;
  const serving = servingQueueEntries(db);
  const nowServing = `<div class="qt-nowserving"><div class="qt-nowserving-head"><span class="qt-live-dot"></span><div class="qt-nowserving-lbl">Now Serving</div></div>
    <div class="qt-nowserving-row">${serving.length ? serving.map(e => `<span class="pill ${e.id === q.id ? 'pill-gold' : 'pill-info'}">${escapeHtml(queueRef(e))}</span>`).join('') : `<span class="qt-empty">No one is being served yet.</span>`}</div></div>`;
  const reqSection = linkedAppt ? `<div class="card card-pad"><label style="display:block; font-size:.78rem; font-weight:600; margin-bottom:6px; color:var(--text-soft);">Your uploaded requirements</label>${attachListHtml(linkedAppt.attachments, 'No files were uploaded with this booking.')}</div>` : '';
  const dl = `<button class="btn btn-ghost btn-block" onclick="downloadCardAsPng('.printable-ticket', 'visit-pass-${q.visitId}')">${icon('download', 16)} Download</button>`;
  const another = `<button class="btn btn-primary btn-block" onclick="resetVisit()">${icon('ticket', 16)} Start Another Visit</button>`;
  const actions = isDone ? another.replace('btn-block', 'btn-block btn-full')
    : finished ? dl + another
    : dl + `<button class="btn btn-danger-ghost btn-block" onclick="confirmCancelQueuePrompt()">${icon('x', 15)} Cancel ${isAppt ? 'visit' : 'queue number'}</button>`;

  document.getElementById('visitorContent').innerHTML = `
    <div class="queue-ticket-wrap">
      ${waitBanner}
      <div class="qt-layout">
        <div class="qt-main ${isDone ? 'qt-main-complete' : ''}">
          <div class="printable-ticket">
            <div class="ticket-v2-card ${isDone ? 'is-complete' : ''}">
              <div class="ticket-v2-main">
                <div class="ticket-v2-top">
                  <div class="ticket-v2-header">
                    <img src="pup.jpg" alt="PUP logo" class="ticket-v2-logo">
                    <div class="ticket-v2-org"><div class="ticket-v2-org-uni">Polytechnic University of the Philippines</div><div class="ticket-v2-org-sub">Santa Maria Campus &middot; Office of Student Services</div></div>
                    <div class="ticket-v2-issued">Issued<br>${fmtDateTime(q.createdAt)}</div>
                  </div>
                  <div class="ticket-v2-body">
                    ${topLine}
                    <div class="ticket-v2-number">${escapeHtml(ref)}</div>
                    <div class="ticket-v2-service">${escapeHtml(serviceQueueLabel(db, q))}</div>
                    <div class="ticket-v2-type">${icon(q.visitorType === 'Student' ? 'cap' : 'users', 13)} ${escapeHtml(visitorTypeLabel(q.visitorType, q.guestClass))}${seniorNote}</div>
                    ${dupBadge}
                  </div>
                </div>
                <div class="ticket-v2-seam"></div>
                <div class="ticket-v2-bottom">
                  <div class="ticket-v2-grid">
                    <div class="ticket-v2-field">${firstField}</div>
                    <div class="ticket-v2-field"><span class="tvf-lbl">${icon('folder', 13)} Service</span><span class="tvf-val">${escapeHtml(serviceQueueLabel(db, q))}</span></div>
                    <div class="ticket-v2-field"><span class="tvf-lbl">${icon('checkin', 13)} Checked-in</span><span class="tvf-val">${fmtTime(q.checkedInAt || q.createdAt)}</span></div>
                    <div class="ticket-v2-field"><span class="tvf-lbl">${icon(isAppt ? 'calendar' : 'ticket', 13)} Entry Method</span><span class="tvf-val">${isAppt ? 'Scheduled' : 'Walk-in'}</span></div>
                  </div>
                  <p class="ticket-v2-fine-print">${isDone ? 'This visit is complete &mdash; this pass has been used and is no longer valid.' : (isAppt ? "This pass is valid for your scheduled visit only and is non-transferable. You are called when your scheduled time arrives." : "This pass is valid for today's visit only and is non-transferable. Please present it at the counter when your number is called.")}</p>
                </div>
                ${isDone ? `<div class="ticket-v2-thanks">${icon('check', 13)} Thank you for visiting OSS!</div>` : ''}
              </div>
              ${isDone ? '' : `<div class="ticket-v2-stub"><div class="ticket-v2-stub-inner"><span class="ticket-v2-stub-lbl">${q.number ? 'Queue No.' : 'Visit ID'}</span><span class="ticket-v2-stub-num">${escapeHtml(ref)}</span><span class="ticket-v2-stub-id">${escapeHtml(q.number ? q.visitId : (slotText || ''))}</span></div></div>`}
              ${isDone ? `<div class="ticket-v2-stamp">${icon('check', 16)} Completed</div>` : ''}
            </div>
          </div>
          <div class="qt-actions">${actions}</div>
        </div>
        <div class="qt-side">
          <div class="vj-card card"><h3>Your Visit Journey</h3>${timelineStepsHtml(q)}</div>
          ${isDone ? '' : nowServing}
          ${feedbackSectionHtml(q)}
        </div>
      </div>
      ${reqSection}
    </div>`;
  if (finished) stopTicketPolling(); else startTicketPolling();
}
function confirmCancelQueuePrompt() {
  const db = loadDB(), q = db.queues.find(x => x.id === myActiveQueueId);
  if (!q) return;
  const body = confirmSummaryHtml({
    intro: 'Are you sure you want to cancel? This cannot be undone and you will need to start a new visit.',
    sections: [{ title: 'Visit to cancel', rows: [['Visit ID', q.visitId, true], ['Queue number', q.number || ''], ['Scheduled', q.scheduledAt ? fmtDateTime(q.scheduledAt).replace('&middot;', '·') : ''], ['Service', serviceQueueLabel(db, q)], ['Name', q.name]] }],
  });
  confirmAction('Cancel this visit?', body, 'Yes, cancel it', cancelMyQueue, null, 'Keep my visit');
}
function cancelMyQueue() {
  const db = loadDB();
  if (myActiveQueueId) { cancelQueue(db, myActiveQueueId, VISITOR_ACTOR); saveDB(db); }
  toast('Visit cancelled.', 'ok');
  resetVisit();
}
function confirmLogout() {
  const body = `<p style="font-size:.88rem; line-height:1.55;">Are you sure you want to go back to Home? ${myActiveQueueId ? 'Your live ticket keeps updating &mdash; return to it anytime from &ldquo;Check My Visit.&rdquo;' : 'Any unsaved details on this page will be lost.'}</p>`;
  confirmAction('Leave Visitor Portal?', body, 'Yes, Go Back', () => { window.location.href = '../Landing/landing.html'; });
}
function startTicketPolling() {
  stopTicketPolling();
  ticketPollTimer = setInterval(() => { if ((visitorView === 'visit' || visitorView === 'checkvisit') && myActiveQueueId && isOfficeHours()) renderQueueTicket(); }, 3000);
}
function stopTicketPolling() { if (ticketPollTimer) { clearInterval(ticketPollTimer); ticketPollTimer = null; } }

function renderCheckVisitScreen() {
  document.getElementById('visitorContent').innerHTML = `
    <div class="cvl">
      <div class="cvl-search">
        <span class="cvl-ic">${icon('search', 20)}</span>
        <input id="cvInput" class="upper" placeholder="Enter your Visit ID (e.g. VIS-K7M2-9QXA)" autocomplete="off" onkeydown="if(event.key==='Enter') lookupMyVisit()">
        <button class="btn btn-primary" onclick="lookupMyVisit()">Check Status</button>
      </div>
      <ol class="cvl-steps">
        <li><span class="cvl-step-num">1</span><h3>Find your Visit ID</h3><p>It is on your Visit Pass and in your confirmation email, for example VIS-K7M2-9QXA. It is new for every visit.</p></li>
        <li><span class="cvl-step-num">2</span><h3>Enter it above</h3><p>Enter your Visit ID and click Check Status. The same ID opens your chat with OSS.</p></li>
        <li><span class="cvl-step-num">3</span><h3>See your status or check in</h3><p>See where you stand in line, or check in when you arrive for your appointment.</p></li>
      </ol>
    </div>`;
}
function lookupMyVisit() {
  if (!isOfficeHours()) { renderClosedScreen(); return; }
  const code = normVisitRef(document.getElementById('cvInput').value);
  if (!code) { toast('Enter your Visit ID.', 'err'); return; }
  const db = loadDB();
  const q = db.queues.find(x => (x.visitId || '').toUpperCase() === code);
  if (q) { myActiveQueueId = q.id; persistSession(); renderQueueTicket(); return; }
  const appt = db.appointments.find(x => (x.visitId || '').toUpperCase() === code);
  if (!appt) { toast('No visit found with that Visit ID.', 'err'); return; }
  if (appt.queueId && db.queues.some(x => x.id === appt.queueId)) { myActiveQueueId = appt.queueId; persistSession(); renderQueueTicket(); return; }
  showPassModalReadonly(appt);
}
function showPassModalReadonly(apptIn) {
  const db = loadDB();
  const appt = db.appointments.find(x => x.id === apptIn.id) || apptIn;
  const linked = appt.queueId ? db.queues.find(q => q.id === appt.queueId) : null;
  const canCheckIn = !linked && appt.status === 'Booked';
  const arrival = canCheckIn ? evaluateArrival(db, appt) : null;
  const sched = apptScheduledDate(appt);
  let banner = '';
  if (canCheckIn && sched && sched > new Date()) banner = `<div class="info-banner">${icon('clock', 13)} Your slot is at ${fmtTime(sched)}. You can check in when you arrive &mdash; you will be called when your time comes.</div>`;
  else if (arrival && arrival.status === 'Late') banner = `<div class="info-banner warn">${icon('alert', 13)} You're about ${arrival.lateMinutes} minutes past your scheduled time. You can still check in &mdash; OSS staff will review your arrival.</div>`;
  else if (arrival && arrival.status === 'PastWindow') banner = `<div class="info-banner danger">${icon('alert', 13)} This appointment's window has passed (${arrival.lateMinutes} minutes late). Please check in and speak with the front desk &mdash; they'll confirm whether you can still be served today.</div>`;

  const notes = {
    Cancelled: 'This scheduled visit has been cancelled. Start a new visit if you still need the service.',
    'No-show': 'This scheduled visit was marked as a no-show. Please see the front desk or start a new visit.',
    Requested: `Your request is still pending. OSS will email you at ${escapeHtml(appt.email || '')} once a date &amp; time is assigned &mdash; check back here with this Visit ID afterward.`,
  };
  const note = linked ? "You've already checked in for this visit." : (notes[appt.status] || 'Arriving now? Tap Check In so OSS knows you are here. You will be called at your scheduled time.');
  const buttons = [{ label: 'Save as image', cls: 'btn-ghost', action: () => downloadCardAsPng('.printable-ticket', `visit-pass-${appt.visitId || appt.code}`) }];
  if (canCheckIn) buttons.push({ label: 'Check In', cls: 'btn-primary', action: () => confirmCheckInPrompt(appt) });
  else if (linked) buttons.push({ label: 'View My Live Pass', cls: 'btn-primary', action: () => { closeModal(); myActiveQueueId = linked.id; persistSession(); renderQueueTicket(); } });

  openModal(`Visit Pass &mdash; ${escapeHtml(appt.visitId || appt.code)}`, `
    ${banner}${appointmentPassHtml(appt)}${requirementsBlockHtml(db, appt)}
    <p class="field-hint" style="margin-top:14px;">${note}</p>`, buttons);
}
function confirmCheckInPrompt(appt) {
  if (!isOfficeHours()) { toast(`Check-in is only available ${officeHoursLabel()}.`, 'err'); renderClosedScreen(); return; }
  const db = loadDB(), arrival = evaluateArrival(db, appt);
  const dup = appt.idNumber ? findActiveDuplicate(db, appt.idNumber, appt.service) : null;
  const arrivalTxt = arrival.status === 'OnTime' ? 'On time / within grace period' : `${arrival.status === 'Late' ? 'Late' : 'Past appointment window'} by ${arrival.lateMinutes} minute(s)`;
  const body = duplicateWarningHtml(dup) + confirmSummaryHtml({
    intro: 'Confirm that you have arrived for this appointment.',
    sections: [
      { title: 'Your visit', rows: [['Visit ID', appt.visitId, true], ['Reference', appt.code], ['Service', appt.service], ['Scheduled', appt.date ? `${appt.date} · ${appt.time}` : ''], ['Arrival', arrivalTxt]] },
      { title: 'About you', rows: [['Name', appt.name, true], ['Visitor type', visitorTypeLabel(appt.type, appt.guestClass)], ['ID type', appt.idType || ''], [appt.type === 'Student' ? 'Student number' : 'ID number', appt.idNumber || ''], ['Contact number', appt.contact]] },
    ],
    notice: 'No queue number is issued. Your place is set by your scheduled time and you are called when it arrives.',
  });
  confirmAction('Confirm check-in', body, 'Check In Now', () => checkInAppointment(appt.id, arrival, !!dup), () => showPassModalReadonly(appt), 'Back');
}
function checkInAppointment(apptId, arrival, possibleDuplicate) {
  if (!isOfficeHours()) { toast(`Check-in is only available ${officeHoursLabel()}.`, 'err'); renderClosedScreen(); return; }
  const db = loadDB(), appt = db.appointments.find(x => x.id === apptId);
  if (!appt) { toast('Visit not found.', 'err'); return; }
  const existing = appt.queueId ? db.queues.find(x => x.id === appt.queueId) : null;
  if (existing) { myActiveQueueId = existing.id; persistSession(); renderQueueTicket(); return; }
  if (appt.status === 'Cancelled') { toast('This scheduled visit was cancelled.', 'err'); return; }
  if (appt.status === 'No-show') { toast('This scheduled visit was marked as a no-show. Please see the front desk.', 'err'); return; }
  if (!appt.visitId) appt.visitId = nextVisitId(db);
  const arr = arrival || evaluateArrival(db, appt), now = new Date(), svc = findService(db, appt.service);
  const entry = addToQueue(db, {
    visitorType: appt.type, serviceKey: svc ? svc.key : null, serviceLabel: appt.service, source: 'Appointment',
    name: appt.name, idNumber: appt.idNumber, idType: appt.idType || '', guestClass: appt.guestClass, contact: appt.contact,
    appointmentId: appt.id, scheduledAt: apptScheduledDate(appt), isSenior: appt.isSenior,
    visitId: appt.visitId, checkedInAt: now, possibleDuplicate,
  });
  Object.assign(appt, { status: 'Checked-in', checkedInAt: now, arrivalStatus: arr.status === 'PastWindow' ? 'Late' : arr.status, lateMinutes: arr.lateMinutes, queueId: entry.id });
  logActivity(db, VISITOR_ACTOR, `Checked in ${appt.visitId} (${appt.code}) &mdash; self check-in${arr.status !== 'OnTime' ? `, ${arr.lateMinutes} min late` : ''}`, { category: 'Queue', target: appt.visitId });
  saveDB(db);
  myActiveQueueId = entry.id; visitStep = 'ticket'; persistSession();
  toast(`Checked in &mdash; ${escapeHtml(entry.visitId)}. You will be called at your scheduled time.`, 'ok');
  renderQueueTicket();
}

function renderHistoryScreen() {
  document.getElementById('visitorContent').innerHTML = `
    <div class="cvl">
      <div class="cvl-search">
        <span class="cvl-ic">${icon('log', 20)}</span>
        <input id="hsInput" class="upper" placeholder="Enter any of your Visit IDs (e.g. VIS-K7M2-9QXA)" autocomplete="off" onkeydown="if(event.key==='Enter') lookupMyHistory()">
        <button class="btn btn-primary" onclick="lookupMyHistory()">Find My Visits</button>
      </div>
      <div id="hsResults"></div>
      <ol class="cvl-steps">
        <li><span class="cvl-step-num">1</span><h3>Find your Visit ID</h3><p>It is on your Visit Pass and in your confirmation email, for example VIS-K7M2-9QXA. Any Visit ID from a past visit works.</p></li>
        <li><span class="cvl-step-num">2</span><h3>Enter it above</h3><p>Enter your Visit ID and click Find My Visits. We match it to the ID number you used.</p></li>
        <li><span class="cvl-step-num">3</span><h3>See your past visits</h3><p>View every visit made with the same ID, with its service, date and current status.</p></li>
      </ol>
    </div>`;
}
function historyForVisitId(db, ref) {
  const src = findVisitByRef(db, ref) || db.transactions.find(t => (t.visitId || '').toUpperCase() === ref);
  if (!src) return [];
  if (src.idNumber) return visitorHistoryFor(db, src.idNumber);
  const mine = x => (x.visitId || '').toUpperCase() === ref, rows = [], known = new Set();
  db.transactions.filter(mine).forEach(t => { known.add(t.visitId); rows.push({ when: t.createdAt, label: serviceLabel(db, t.service), status: t.status, ref: t.visitId }); });
  db.appointments.filter(mine).forEach(a => { if (!known.has(a.visitId)) { known.add(a.visitId); rows.push({ when: a.createdAt, label: a.service, status: a.status, ref: a.visitId }); } });
  db.queues.filter(mine).forEach(q => { if (!known.has(q.visitId)) rows.push({ when: q.createdAt, label: serviceQueueLabel(db, q), status: q.status, ref: q.visitId }); });
  return rows.sort((a, b) => new Date(b.when) - new Date(a.when));
}
function lookupMyHistory() {
  if (!isOfficeHours()) { renderClosedScreen(); return; }
  const id = normVisitRef(document.getElementById('hsInput').value);
  const wrap = document.getElementById('hsResults');
  if (!id) { toast('Enter your Visit ID.', 'err'); return; }
  const rows = historyForVisitId(loadDB(), id);
  if (!rows.length) { wrap.innerHTML = `<div class="cvx-empty">No visit found with that Visit ID.</div>`; return; }
  wrap.innerHTML = `<section class="cvx-results">
    <div class="cvx-results-head"><h3>Your visits</h3><span>${rows.length} ${rows.length === 1 ? 'visit' : 'visits'} found</span></div>
    ${rows.map(r => `<div class="cvx-row"><div class="cvx-row-main"><b>${escapeHtml(r.label)}</b><div class="cvx-row-sub mono">${escapeHtml(r.ref)} &middot; ${fmtDateTime(r.when)}</div></div>${statusPill(r.status)}</div>`).join('')}</section>`;
}

const CHAT_PROMPTS = {
  visit: 'Hi! Enter your Visit ID (e.g. VIS-K7M2-9QXA) to open your chat. You can find it on your Visit Pass.',
  message: 'What would you like to ask or report to OSS?',
};
function initChatFlow() {
  chatFlow = { step: 'visit', visitRef: '', message: '', bubbles: [{ sender: 'staff', text: CHAT_PROMPTS.visit }] };
  renderChatFlowScreen();
}
function submitChatFlowText() {
  const raw = (document.getElementById('cfText').value || '').trim();
  if (chatFlow.step === 'visit') {
    const ref = normVisitRef(raw);
    if (!ref) { toast('Please enter your Visit ID.', 'err'); return; }
    if (!findVisitByRef(loadDB(), ref)) { toast('No visit found with that Visit ID. Check it and try again.', 'err'); return; }
    chatFlow.visitRef = ref;
    chatFlow.bubbles.push({ sender: 'visitor', text: ref }, { sender: 'staff', text: CHAT_PROMPTS.message });
    chatFlow.step = 'message';
    renderChatFlowScreen();
    return;
  }
  if (!raw) { toast('Please type a message.', 'err'); return; }
  chatFlow.message = raw;
  chatFlow.bubbles.push({ sender: 'visitor', text: raw });
  finalizeChatFlow();
}
async function finalizeChatFlow() {
  if (!isOfficeHours()) { toast(`Messages to OSS can only be sent ${officeHoursLabel()}.`, 'err'); renderClosedScreen(); return; }
  let attachments = [];
  const fi = document.getElementById('cfFiles');
  if (fi && fi.files && fi.files.length) {
    validateAttachments(fi.files).forEach(p => toast(p, 'err'));
    try { attachments = await readFilesAsAttachments(fi.files); } catch (e) { toast('Could not read one of the uploaded files.', 'err'); }
  }
  const db = loadDB(), src = findVisitByRef(db, chatFlow.visitRef);
  if (!src) { toast('No visit found with that Visit ID.', 'err'); chatFlow = null; renderChatScreen(); return; }
  const msg = { id: uid('MSG'), sender: 'visitor', senderName: 'Visitor', text: chatFlow.message, ts: new Date(), attachments };
  let chat = db.chats.find(c => c.visitId === src.visitId && c.status === 'Open');
  if (chat) { chat.messages.push(msg); chat.staffUnread = (chat.staffUnread || 0) + 1; chat.updatedAt = new Date(); }
  else {
    chat = mkChat({ visitId: src.visitId, visitorName: src.name || 'Visitor', visitorType: src.visitorType || src.type || '', contact: src.contact || '', createdAt: new Date(), updatedAt: new Date() });
    chat.messages.push(msg);
    chat.staffUnread = 1;
    db.chats.push(chat);
  }
  saveDB(db);
  currentPublicChatId = chat.id; persistSession();
  chatFlow = null;
  renderChatScreen(); renderVisitorSidebar();
}
function renderChatFlowInput(openNow) {
  const isMessage = chatFlow.step === 'message';
  return `<div class="chx-composer-row">
    ${isMessage ? `<label class="chx-attach" for="cfFiles" title="Attach files">${icon('paperclip', 18)}<span class="chx-attach-count" id="cfAttachCount"></span></label>
      <input id="cfFiles" type="file" multiple hidden onchange="var n=this.files.length; var b=document.getElementById('cfAttachCount'); b.textContent=n; b.classList.toggle('on', n>0)">` : ''}
    <textarea id="cfText" rows="1" placeholder="${isMessage ? 'Type your message...' : 'VIS-XXXX-XXXX'}" ${openNow ? '' : 'disabled'} ${isMessage ? '' : 'style="text-transform:uppercase"'} onkeydown="if(event.key==='Enter' &amp;&amp; !event.shiftKey){event.preventDefault(); submitChatFlowText();}"></textarea>
    <button class="btn btn-gold chx-send" ${openNow ? '' : 'disabled'} onclick="submitChatFlowText()">${openNow ? icon('arrowright', 16) : 'Closed'}</button></div>`;
}
function renderChatFlowScreen() {
  const openNow = isOfficeHours();
  document.getElementById('visitorContent').innerHTML = `
    <div class="chx-window chs-start">
      <header class="chx-win-head">
        <div class="chx-win-who"><span class="chx-avatar">${icon('chat', 20)}</span><div><h3>Office of Student Services</h3>
          <div class="chs-sub"><span class="chs-dot ${openNow ? 'open' : 'closed'}"></span>${openNow ? 'Open now' : 'Closed'} &middot; ${officeHoursLabel()}</div></div></div>
        <div class="chx-win-actions"><button type="button" class="btn btn-ghost btn-sm" onclick="toggleChatResume()">Resume a chat</button></div>
      </header>
      <div class="chs-resume" id="chResumeBox" hidden><div class="chs-resume-row">
        <input id="chResume" placeholder="Your Visit ID (VIS-XXXX-XXXX)" autocomplete="off" onkeydown="if(event.key==='Enter') resumeChat()">
        <button type="button" class="btn btn-primary" onclick="resumeChat()">Resume</button></div></div>
      <div class="chat-messages chx-msgs" id="chatFlowMsgs">${chatFlow.bubbles.map(b => `<div class="bubble ${b.sender}"><div class="who">${b.sender === 'staff' ? 'OSS UniServe' : 'You'}</div><div>${escapeHtml(b.text)}</div></div>`).join('')}</div>
      <div class="chx-composer">${openNow ? '' : officeHoursBannerHtml('chat')}${renderChatFlowInput(openNow)}</div>
    </div>`;
  const area = document.getElementById('chatFlowMsgs');
  if (area) area.scrollTop = area.scrollHeight;
  const inp = document.getElementById('cfText');
  if (inp) inp.focus();
}
function renderChatScreen() {
  if (!isOfficeHours()) { renderClosedScreen(); return; }
  if (currentPublicChatId) {
    const c = loadDB().chats.find(x => x.id === currentPublicChatId);
    if (c) { renderPublicChatThread(c); return; }
    currentPublicChatId = null; persistSession();
  }
  if (!chatFlow) initChatFlow(); else renderChatFlowScreen();
}
function renderBubbles(c) {
  if (!c.messages.length) return `<div class="muted" style="font-size:.8rem; padding:10px;">No messages yet.</div>`;
  return c.messages.map(m => `<div class="bubble ${m.sender}"><div class="who">${m.sender === 'staff' ? 'OSS Staff' : 'Visitor'}</div><div>${escapeHtml(m.text)}</div>${m.attachments && m.attachments.length ? `<div class="attach-list">${m.attachments.map(attachChip).join('')}</div>` : ''}<div class="ts">${fmtDateTime(m.ts)}</div></div>`).join('');
}
function toggleChatResume() {
  const box = document.getElementById('chResumeBox');
  if (!box) return;
  box.hidden = !box.hidden;
  if (!box.hidden) document.getElementById('chResume').focus();
}
function resumeChat() {
  const code = normVisitRef(document.getElementById('chResume').value);
  if (!code) { toast('Enter your Visit ID.', 'err'); return; }
  const db = loadDB();
  if (!findVisitByRef(db, code)) { toast('No visit found with that Visit ID.', 'err'); return; }
  const c = db.chats.filter(x => (x.visitId || '').toUpperCase() === code).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (!c) { toast('No conversation yet for this Visit ID. Close this box and send your first message.', 'err'); return; }
  currentPublicChatId = c.id; persistSession();
  renderChatScreen(); renderVisitorSidebar();
}
function renderPublicChatThread(c) {
  const db = loadDB(), fresh = db.chats.find(x => x.id === c.id);
  if (fresh) { fresh.visitorUnread = 0; saveDB(db); c = fresh; }
  renderVisitorSidebar();
  const openNow = isOfficeHours();
  document.getElementById('visitorContent').innerHTML = `
    <div class="chx-window" data-chat-status="${c.status}">
      <header class="chx-win-head">
        <div class="chx-win-who"><span class="chx-avatar">${icon('chat', 20)}</span><div><h3>Your conversation</h3><div class="chx-win-code">${escapeHtml(c.visitId || '')}</div></div></div>
        <div class="chx-win-actions">${statusPill(c.status)}<button class="btn btn-ghost btn-sm" onclick="currentPublicChatId=null; persistSession(); renderChatScreen(); renderVisitorSidebar();">New conversation</button></div>
      </header>
      <div class="chx-code-bar"><span>Your Visit ID: <b class="mono">${escapeHtml(c.visitId || '')}</b></span><button type="button" class="btn btn-ghost btn-sm" onclick="copyText('${escapeHtml(c.visitId || '')}')">Copy Visit ID</button></div>
      <div class="chat-messages chx-msgs" id="chatMsgArea">${renderBubbles(c)}</div>
      ${c.status === 'Open' ? `<div class="chx-composer">${openNow ? '' : officeHoursBannerHtml('chat')}
        <div class="chx-composer-row">
          <label class="chx-attach" for="chReplyFiles" title="Attach files">${icon('paperclip', 18)}<span class="chx-attach-count" id="chAttachCount"></span></label>
          <input id="chReplyFiles" type="file" multiple hidden onchange="var n=this.files.length; var b=document.getElementById('chAttachCount'); b.textContent=n; b.classList.toggle('on', n>0)">
          <textarea id="chReply" rows="1" placeholder="Type a message..." onkeydown="if(event.key==='Enter' &amp;&amp; !event.shiftKey){event.preventDefault(); sendVisitorMessage('${c.id}');}"></textarea>
          <button class="btn btn-gold chx-send" id="chReplyBtn" ${openNow ? '' : 'disabled'} onclick="sendVisitorMessage('${c.id}')">${openNow ? `Send ${icon('arrowright', 16)}` : 'Closed'}</button>
        </div></div>` : `<p class="chx-closed">This conversation has been closed by OSS staff.</p>`}
    </div>
    <p class="field-hint chx-save-hint">Keep your Visit ID &mdash; use it under &ldquo;Resume a chat&rdquo; to reopen this conversation on any device.</p>`;
  const area = document.getElementById('chatMsgArea');
  if (area) area.scrollTop = area.scrollHeight;
  startChatPolling(c.id);
}
function refreshChatIfNeeded(chatId) {
  const c = loadDB().chats.find(x => x.id === chatId);
  if (!c) return;
  const wrap = document.querySelector('#visitorContent [data-chat-status]');
  if (!wrap || wrap.dataset.chatStatus !== c.status) { renderPublicChatThread(c); return; }
  const area = document.getElementById('chatMsgArea');
  if (area && c.messages.length !== area.querySelectorAll('.bubble').length) { area.innerHTML = renderBubbles(c); area.scrollTop = area.scrollHeight; }
}
async function sendVisitorMessage(id) {
  if (!isOfficeHours()) { toast(`Messages to OSS can only be sent ${officeHoursLabel()}.`, 'err'); renderClosedScreen(); return; }
  const db = loadDB(), c = db.chats.find(x => x.id === id), text = document.getElementById('chReply').value.trim();
  if (!c || !text) return;
  const btn = document.getElementById('chReplyBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
  let attachments = [];
  try { attachments = await readFilesAsAttachments(document.getElementById('chReplyFiles')?.files); } catch (e) { toast('Could not read one of the uploaded files.', 'err'); }
  c.messages.push({ id: uid('MSG'), sender: 'visitor', senderName: 'Visitor', text, ts: new Date(), attachments });
  c.staffUnread = (c.staffUnread || 0) + 1;
  c.updatedAt = new Date();
  saveDB(db);
  renderPublicChatThread(c);
}
function startChatPolling(chatId) {
  stopChatPolling();
  chatPollTimer = setInterval(() => { if (visitorView === 'chat' && currentPublicChatId === chatId && isOfficeHours()) refreshChatIfNeeded(chatId); }, 4000);
}
function stopChatPolling() { if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; } }

document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.getElementById('activeModal')) closeModal(); });
['input', 'change'].forEach(evt => document.addEventListener(evt, e => {
  const f = e.target.closest && e.target.closest('.field.has-error');
  if (f) f.classList.remove('has-error');
}));
document.addEventListener('click', e => {
  const sb = document.getElementById('visitorSidebar');
  if (sb && sb.classList.contains('open') && !sb.contains(e.target) && !e.target.closest('.menu-btn')) sb.classList.remove('open');
});

renderVisitorSidebar();
navigateVisitor(visitorView);