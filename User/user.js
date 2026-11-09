// Use the shared modal, toast and status controls before page initialization.
UniServeUX.install();
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
const UX_MAX_FILE = 5 * 1024 * 1024;
const FEEDBACK_MAX = 300;
const uxReq = '<span class="req" aria-hidden="true">*</span>';
const ALLOWED_ATTACHMENT_TYPES = ['image/', 'application/pdf'];

const QUEUE_AVG_MINUTES = 4;
const DEFAULT_GRACE_MINUTES = 15;
const DEFAULT_NOSHOW_MINUTES = 60;
const AUDIT_MAX_ENTRIES = 2000;

function isOfficeHours(d = new Date()) { return OfficeCalendar.status(d).open; }
function officeHoursLabel() { return escapeHtml(OfficeCalendar.label()); }
function nextOpeningLabel(d = new Date()) { return OfficeCalendar.status(d).nextLabel; }
function officeHoursBannerHtml(kind) {
  const action = kind === 'chat' ? 'send a message to' : 'submit a request to';
  return isOfficeHours()
    ? `<div class="info-banner">${icon('clock', 14)} OSS is open now. ${officeHoursLabel()}</div>`
    : `<div class="info-banner warn">${icon('alert', 14)} ${escapeHtml(OfficeCalendar.status().message)}. Next opening: ${escapeHtml(nextOpeningLabel())}.</div>`;
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
  if (mins < 1) { const s = Math.max(1, Math.round(mins * 60)); return `${s} second${s === 1 ? '' : 's'}`; }
  if (mins < 60) { const m = Math.round(mins); return `${m} minute${m === 1 ? '' : 's'}`; }
  const h = Math.max(1, Math.round(mins / 60));
  return `${h} hour${h === 1 ? '' : 's'}`;
}

function titleCaseWords(s) { return String(s || '').replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1)); }
function joinName(first, last) { return [String(first || '').trim(), String(last || '').trim()].filter(Boolean).join(' '); }
function autoCapitalizeInput(el) {
  if (!el) return;
  const pos = el.selectionStart, before = el.value, after = titleCaseWords(before);
  if (before !== after) { el.value = after; try { el.setSelectionRange(pos, pos); } catch (e) { } }
}
function formatContactInput(el) {
  const before = el.value;
  const cursor = el.selectionStart;
  let digits = before.replace(/\D/g, '');
  if (digits.startsWith('63')) digits = digits.slice(2);
  digits = digits.replace(/^0+/, '');
  digits = digits.slice(0, 10);
  const groups = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6)].filter(Boolean);
  const formatted = '+63' + (groups.length ? ' ' + groups.join(' ') : '');
  if (before === formatted) return;
  // Preserve the editing position by counting digits before the caret.
  const digitsBefore = cursor == null ? null : before.slice(0, cursor).replace(/\D/g, '').length;
  el.value = formatted;
  if (digitsBefore != null && cursor < before.length) {
    let position = 0, count = 0;
    const prefixDigits = before.replace(/\D/g, '').startsWith('63') ? 0 : before.replace(/\D/g, '').startsWith('0') ? 1 : 2;
    const target = Math.max(2, digitsBefore + (prefixDigits === 1 ? 1 : prefixDigits));
    while (position < formatted.length && count < target) {
      if (/\d/.test(formatted[position])) count++;
      position++;
    }
    try { el.setSelectionRange(position, position); } catch (e) { }
  }
}
const PH_CONTACT_RE = /^(09\d{2}[-\s]?\d{3}[-\s]?\d{4}|\+639\d{2}[-\s]?\d{3}[-\s]?\d{4})$/;
const STUDENT_NO_RE = /^\d{4}-\d{5}-SM-\d$/;
function isValidContact(v) { return PH_CONTACT_RE.test(String(v || '').trim()) || /^9\d{9}$/.test(String(v || '').trim()); }
function normEmail(v) { return String(v || '').trim().toLowerCase(); }
function isValidEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(normEmail(v)); }
function isValidPersonName(v) { return String(v || '').trim().length >= 2; }
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
  return ['appointments', 'queues', 'transactions', 'visitorLog', 'chats'].some(k => (db[k] || []).some(x => String(x.visitId || '').replace(/-/g, '') === String(id).replace(/-/g, '')));
}
function nextVisitId(db) {
  let id;
  do { const s = randomVisitSuffix(8); id = `VIS-${s}`; } while (visitIdExists(db, id));
  return id;
}
function normVisitRef(s) {
  const raw = String(s || '').trim().toUpperCase(), c = raw.replace(/[^A-Z0-9]/g, '');
  return /^VIS[A-Z0-9]{8}$/.test(c) && !/^VIS-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(raw) ? `VIS-${c.slice(3)}` : raw;
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
  (db.appointments || []).forEach(a => { if (!a.visitId && !a.shared) { a.visitId = nextVisitId(db); changed = true; } });
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
function mkChat(o) { return { id: uid('CH'), status: 'Open', messages: [], staffUnread: 0, visitorUnread: 0, ...o }; }
function mkQueue(o) {
  return { id: uid('Q'), visitId: null, number: null, status: 'Waiting', createdAt: new Date(), checkedInAt: new Date(), scheduledAt: null, calledAt: null, servingAt: null, completedAt: null, assignedAdminId: null, assignedAdminName: null, transactionId: null, appointmentId: null, visitorLogId: null, recallCount: 0, isSenior: false, isPWD: false, possibleDuplicate: false, feedback: null, ...o };
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
function findService(db, key) { return db.services.find(x => x.key === key) || db.services.find(x => x.label === key); }
function serviceLabel(db, key) { const s = db.services.find(x => x.key === key); return s ? s.label : key; }
function serviceQueueLabel(db, e) { return e.serviceLabel || (e.serviceKey ? serviceLabel(db, e.serviceKey) : 'General Concern'); }

function computeReadiness(svc, attachments) {
  const required=svc?.requirements?.length||0, files=attachments||[];
  const accepted=files.filter(file=>file.review?.status==='Accepted').length;
  if(files.some(file=>file.review?.status==='Needs correction'))return {status:'INCOMPLETE',label:'Needs correction'};
  if(!required&&!files.length)return {status:'READY',label:'No uploads required'};
  if(files.length<required)return {status:'INCOMPLETE',label:`Incomplete — ${files.length} of ${required} requirements uploaded`};
  if(files.some(file=>file.review?.status!=='Accepted'))return {status:'FOR_REVIEW',label:'Pending review'};
  return {status:'READY',label:`Accepted — ${accepted} ${accepted===1?'file':'files'}`};
}
function readinessPillHtml(r) {
  if (!r) return '';
  const cls = r.status === 'READY' ? 'ready' : (r.status === 'FOR_REVIEW' ? 'review' : 'incomplete');
  return `<span class="readiness-pill ${cls}">${escapeHtml(r.label)}</span>`;
}
function findActiveDuplicate(db, idNumber, svcKeyOrLabel, email) {
  const id = String(idNumber || '').trim().toLowerCase();
  const em = normEmail(email);
  if (!id && !em) return null;
  const same = x => (id && (x.idNumber || '').trim().toLowerCase() === id) || (em && normEmail(x.email) === em);
  const q = db.queues.find(x => same(x) && ['Waiting', 'Called', 'Serving'].includes(x.status) && (x.serviceKey === svcKeyOrLabel || x.serviceLabel === svcKeyOrLabel));
  if (q) return { type: 'queue', entry: q };
  const a = db.appointments.find(x => same(x) && !x.queueId && ['Requested', 'Booked'].includes(x.status) && x.service === svcKeyOrLabel);
  return a ? { type: 'appointment', entry: a } : null;
}
function duplicateWarningHtml(dup) {
  if (!dup) return '';
  const desc = dup.type === 'queue'
    ? `You already have an active visit (${escapeHtml(queueRef(dup.entry))}) for this same service.`
    : `You already have a pending scheduled request (${escapeHtml(dup.entry.code)}) for this same service.`;
  return `<div class="dup-warn">${icon('alert', 13)} Possible duplicate visit: ${desc} Open your existing request first, or continue only if you need a separate visit. <button class="btn btn-ghost btn-sm" onclick="openExistingDuplicate('${dup.type}','${dup.entry.id}')">Open existing request</button></div>`;
}
function openExistingDuplicate(type,id) {
  const db=loadDB();closeModal();
  if(type==='queue'){const q=db.queues.find(q=>q.id===id);if(q){myActiveQueueId=q.id;persistSession();renderQueueTicket();}}
  else {const a=db.appointments.find(a=>a.id===id);if(a)showPassModalReadonly(a,true);}
}
function visitorHistoryFor(db, email) {
  const em = normEmail(email);
  if (!em) return [];
  const known = new Set(), rows = [];
  const emailVisitIds = new Set();
  db.queues.concat(db.appointments).forEach(x => { if (normEmail(x.email) === em && x.visitId) emailVisitIds.add(x.visitId); });
  const mine = x => normEmail(x.email) === em || (x.visitId && emailVisitIds.has(x.visitId));
  db.transactions.filter(mine).forEach(t => { if (t.visitId) known.add(t.visitId); rows.push({ when: t.createdAt, label: serviceLabel(db, t.service), status: t.status, ref: t.visitId || t.code }); });
  db.appointments.filter(mine).forEach(a => { if (!known.has(a.visitId||a.code)) { known.add(a.visitId||a.code); rows.push({ when: a.createdAt, label: a.service, status: a.status, ref: a.visitId || a.code }); } });
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
function attachChip(a) { return `<a class="attach-chip" href="${a.dataUrl}" download="${escapeHtml(a.name)}" target="_blank" rel="noopener noreferrer">${icon('paperclip', 13)}<span class="fname">${escapeHtml(a.name)}</span><span class="fsize">${fmtFileSize(a.size)}</span></a>`; }
function attachListHtml(list, emptyText) {
  if (!list || !list.length) return `<div class="no-attach">${emptyText || 'No files uploaded.'}</div>`;
  return `<div class="attach-list">${list.map(attachChip).join('')}</div>`;
}
function requirementsBoxHtml(svc) {
  return svc && svc.requirements && svc.requirements.length
    ? `<div class="req-box"><div class="req-title">Documents to bring</div><ul>${svc.requirements.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul></div>` : '';
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

function visitorTermsHtml(prefix) {
  return `<div class="visitor-terms"><div class="visitor-terms-row"><input type="checkbox" id="${prefix}TermsAccepted" aria-describedby="${prefix}TermsStatus" onchange="document.getElementById('${prefix}TermsStatus').textContent='';if(this.checked){this.checked=false;openVisitorTerms('${prefix}');}"><span><label for="${prefix}TermsAccepted">I accept the </label><button type="button" class="visitor-terms-link" onclick="openVisitorTerms('${prefix}')">Terms &amp; Conditions</button>.</span></div><p class="field-hint" id="${prefix}TermsStatus" role="status"></p></div>`;
}

async function openVisitorTerms(prefix) {
  const checkbox = document.getElementById(prefix + 'TermsAccepted');
  if (!checkbox) return;
  try {
    const response = await fetch('../Landing/terms.html');
    if (!response.ok) throw new Error('Terms unavailable');
    const page = new DOMParser().parseFromString(await response.text(), 'text/html');
    const article = page.querySelector('.terms-body');
    if (!article || !checkbox.isConnected) throw new Error('Terms unavailable');
    // Keep the policy inside this dialog rather than navigating away from the form.
    article.querySelectorAll('a').forEach(link => link.replaceWith(document.createTextNode(link.textContent)));
    const decide = accepted => {
      checkbox.checked = accepted;
      document.getElementById(prefix + 'TermsStatus').textContent = accepted
        ? ''
        : 'Terms declined. You must accept before submitting a visit.';
      closeModal();
    };
    openModal('Terms &amp; Conditions', `<div class="visitor-terms-content"><p>Please read these portal usage guidelines before submitting your visit.</p>${article.innerHTML}</div>`, [
      { label: 'Decline', cls: 'btn-ghost', action: () => decide(false) },
      { label: 'Accept', cls: 'btn-primary', action: () => decide(true) },
    ]);
  } catch (error) {
    toast('Could not load the Terms & Conditions. Please try again.', 'err');
  }
}

function requireVisitorTerms(prefix) {
  if (document.getElementById(prefix + 'TermsAccepted')?.checked) return true;
  const status = document.getElementById(prefix + 'TermsStatus');
  if (status) status.textContent = 'Please accept the Terms & Conditions before continuing.';
  toast('Please read and accept the Terms & Conditions before continuing.', 'err');
  openVisitorTerms(prefix);
  return false;
}

function isSeniorFromClassification(type, guestClass) { return type === 'Guest' && guestClass === 'Senior Citizen'; }
function visitorTypeLabel(type, guestClass) { return guestClass ? `${type} (${guestClass})` : type; }
function idTypeSelectHtml(id) {
  return `<select id="${id}"><option value="" disabled selected>Select ID type</option>${VALID_ID_TYPES.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')}</select>`;
}
function findVisitByRef(db, ref) {
  ref = normVisitRef(ref);
  if (!ref) return null;
  return db.queues.find(q => (q.visitId || '').toUpperCase() === ref) || db.appointments.find(a => (a.visitId || '').toUpperCase() === ref) || null;
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
  checkvisit: ['Check My Visit', 'See your appointment schedule or live queue status'],
  history: ['Visit History', 'Verify your email to see your past visits'],
  chat: ['Chat with OSS', 'Send a message to the office'],
};

let visitorView = 'visit';
let visitorHubOpen = true;
let visitorNavigationVersion = 0;
let visitStep = sessionStorage.getItem('oss_visitStep') || 'pick';
let visitVisitorType = sessionStorage.getItem('oss_visitVisitorType') || 'Student';
let visitGuestClass = sessionStorage.getItem('oss_visitGuestClass') || null;
let visitSelectedService = (() => {
  try { const k = JSON.parse(sessionStorage.getItem('oss_visitSelectedService') || 'null'); const key = k && typeof k === 'object' ? k.key : k; return key ? findService(loadDB(), key) || null : null; }
  catch (e) { return null; }
})();
let myActiveQueueId = sessionStorage.getItem('oss_myActiveQueueId') || null;
let currentPublicChatId = sessionStorage.getItem('oss_chat_id') || null;
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
  sessionStorage.setItem('oss_chat_id', currentPublicChatId || '');
}
function resetVisit() {
  clearVisitorDraft(); sessionStorage.removeItem('oss_activeAppointmentId'); scheduleAttachments = [];
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
function visitTrackingAvailable() { return ["visit", "checkvisit", "history"].includes(visitorView); }
function renderClosedScreen() {
  if (visitorHubOpen) { hideClosedScreen(); return; }
  if (visitTrackingAvailable()) { hideClosedScreen(); return; }
  closeModal();
  stopTicketPolling(); stopChatPolling();
  hideClosedScreen();
  const el = document.createElement('div');
  el.id = 'closedScreen';
  el.setAttribute('role', 'status');
  el.innerHTML = `
    <div class="closed-card">
      <span class="closed-notice-icon" aria-hidden="true">${icon('clock', 20)}</span>
      <h2>${escapeHtml(OfficeCalendar.status().message)}</h2>
      <p>Walk-ins and visitor messages are available during office hours. Appointment requests and visit tracking remain available.</p>
      <div class="closed-next-opening"><span>Next opening</span><strong>${escapeHtml(nextOpeningLabel())}</strong></div>
      <div class="visit-pass-actions"><button class="btn btn-primary" onclick="navigateVisitor('visit');setVisitMethod('appointment')">Request an appointment</button><button class="btn btn-ghost" onclick="navigateVisitor('checkvisit')">Check my visit</button></div>
    </div>`;
  document.getElementById('visitorContent').replaceChildren(el);
}
function checkPortalHours() {
  const open = isOfficeHours();
  renderHubOfficeNotice();
  if (open === portalWasOpen) return;
  portalWasOpen = open;
  closeModal();
  if (open) toast('OSS is now open. Welcome!', 'ok');
  if(visitorHubOpen)return;
  if (sessionStorage.getItem('oss_activeAppointmentId')) { refreshAppointmentPass(); return; }
  if (myActiveQueueId) { renderQueueTicket(); return; }
  navigateVisitor(visitorView);
}
setInterval(checkPortalHours, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkPortalHours(); });

function maintenanceOn() { return !!loadDB().systemSettings.maintenanceMode; }
function renderMaintenanceNotice() {
  document.getElementById('visitorContent').innerHTML = `
    <div class="card card-pad visitor-page-wrap">
      <div class="info-banner warn">${icon('alert', 14)} The visitor portal is closed for maintenance.</div>
      <p style="font-size:.9rem; line-height:1.6; color:var(--text-soft); margin-bottom:16px;">New visits are unavailable during maintenance. You can still check an existing visit or view your history. Please contact the front desk for assistance.</p>
      <a class="btn system-back-link" href="../Landing/landing.html">Back to home</a>
    </div>`;
}

function setVisitorHubState(open) {
  visitorHubOpen=open;
  const hub=document.getElementById('visitorHub'),content=document.getElementById('visitorContent'),bar=document.getElementById('visitorSectionBar');
  if(hub)hub.hidden=!open;
  if(content)content.hidden=open;
  if(bar)bar.hidden=open;
}
function renderHubOfficeNotice() {
  const notice = document.getElementById('visitorHubOfficeNotice');
  if (!notice) return;
  notice.hidden = isOfficeHours();
  notice.innerHTML = notice.hidden ? '' : `${icon('clock',18)}<span><strong>The office is closed.</strong> You can still request an appointment or check your visit.</span>`;
}
function updateVisitorBackButton() {
  const button=document.querySelector('#visitorSectionBar button');
  if(button)button.textContent=window.historyVisitOpen?'Back to records':'Back to services';
}
function visitorSectionBack() {
  if(window.historyVisitOpen){
    window.historyVisitOpen=false;stopTicketPolling();myActiveQueueId=null;
    sessionStorage.removeItem('oss_activeAppointmentId');persistSession();updateVisitorBackButton();navigateVisitor('history');
  }else showVisitorHub();
}
function showVisitorHub() {
  visitorNavigationVersion++;
  window.historyVisitOpen=false;updateVisitorBackButton();
  captureVisitorDraft();stopTicketPolling();stopChatPolling();closeModal();hideClosedScreen();
  setVisitorHubState(true);
  renderHubOfficeNotice();
  document.getElementById('visitorContent').innerHTML='';
  renderVisitorSidebar();
}
function navigateVisitor(key) {
  if(key==='history'&&typeof window!=='undefined'&&!window.visitorHistoryGateEntering){
    if(typeof window.openVerifiedVisitorHistory==='function')window.openVerifiedVisitorHistory();
    else {window.pendingVisitorHistory=true;showVisitorHub();}
    return;
  }
  if(key==='chat'&&typeof window!=='undefined'&&!window.visitorChatGateEntering){
    if(typeof window.openVerifiedVisitorChat==='function')window.openVerifiedVisitorChat();
    else {window.pendingVisitorChat=true;showVisitorHub();}
    return;
  }
  visitorNavigationVersion++;
  if(typeof setVisitorHubState==='function')setVisitorHubState(false);
  captureVisitorDraft();
  stopTicketPolling(); stopChatPolling();
  visitorView = key;
  document.getElementById('visitorPageTitle').textContent = VISITOR_TITLES[key][0];
  document.getElementById('visitorPageSub').textContent = VISITOR_TITLES[key][1];
  renderVisitorSidebar();
  portalWasOpen = isOfficeHours();
  if (!portalWasOpen && !visitTrackingAvailable()) { renderClosedScreen(); return; }
  hideClosedScreen();
  ({ visit: renderVisitScreen, checkvisit: renderCheckVisitScreen, history: renderHistoryScreen, chat: renderChatScreen })[key]();
}
function renderVisitorSidebar() {
  const db = loadDB();
  const unread = currentPublicChatId ? (db.chats.find(c => c.id === currentPublicChatId)?.visitorUnread || 0) : 0;
  const descriptions={visit:'Choose a service and plan your visit.',checkvisit:'Track your queue or appointment.',history:'View your previous visits securely.',chat:'Ask a question or follow up with OSS.'};
  document.getElementById('visitorNavList').innerHTML = VISITOR_NAV.map(n => {
    const badge = n.key === 'chat' ? unread : 0;
    return `<li><button data-service="${n.key}" class="nav-item ${!visitorHubOpen&&visitorView === n.key ? 'active' : ''}" ${!visitorHubOpen&&visitorView===n.key?'aria-current="page"':''} onclick="navigateVisitor('${n.key}')"><span class="visitor-hub-icon">${icon(n.ic,21)}</span><span class="visitor-hub-label"><b>${n.label}</b><small>${descriptions[n.key]}</small></span>${badge ? `<span class="nav-badge">${badge}</span>` : ''}</button></li>`;
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
function uxGoStep(s) { captureVisitorDraft(); visitStep = s === 1 ? 'pick' : 'choose'; persistSession(); renderVisitScreen(); }

function renderVisitScreen() {
  if(visitorHubOpen)return;
  hideClosedScreen();
  if (myActiveQueueId) {
    if (loadDB().queues.some(x => x.id === myActiveQueueId)) { visitStep = 'ticket'; persistSession(); renderQueueTicket(); return; }
    myActiveQueueId = null; persistSession();
  }
  if (maintenanceOn()) { renderMaintenanceNotice(); return; }
  if (visitStep === 'pass' && sessionStorage.getItem('oss_activeAppointmentId')) { refreshAppointmentPass(); return; }
  if (visitStep === 'choose' && visitSelectedService) renderVisitChoose();
  else if (visitStep === 'walkin' && visitSelectedService) renderVisitWalkinForm();
  else if (visitStep === 'schedule' && visitSelectedService) renderVisitScheduleForm();
  else { visitStep = 'pick'; renderVisitPicker(); }
}
let visitEntryMethod = new URLSearchParams(location.search).get('entry') || '';
function setVisitMethod(method) { captureVisitorDraft(); visitEntryMethod=method; visitStep='pick'; visitSelectedService=null; persistSession(); renderVisitPicker(); }
function renderVisitPicker() {
  const db = loadDB();
  document.getElementById('visitorContent').innerHTML = `
    <section class="visit-start-page" aria-label="Start your visit">
    ${stepperHtml(1)}
    ${!isOfficeHours()?`<div class="info-banner visit-closed-notice" role="status"><span class="visit-closed-icon" aria-hidden="true">${icon('clock',18)}</span><span><strong>The office is closed.</strong> You can still request an appointment.</span></div>`:''}
    <div class="visit-entry-heading visitor-page-wrap"><h3>Choose a service</h3><p>Select your visitor type, then choose the service you need.</p></div>
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

        </button>`).join('')}
    </div>
    <div class="cvx-empty" id="svcEmpty" hidden>No service matches your search. Try &ldquo;Other Student Services Documentation&rdquo; for anything not listed.</div>
    </section>`;
}
function filterServices(v) {
  const q = (v || '').trim().toLowerCase();
  let shown = 0;
  document.querySelectorAll('#svcList .svc-item').forEach(el => { const ok = !q || el.dataset.q.includes(q); el.hidden = !ok; if (ok) shown++; });
  const empty = document.getElementById('svcEmpty');
  if (empty) empty.hidden = shown > 0;
}
function setVisitorType(t) {
  captureVisitorDraft();
  visitVisitorType = t;
  if (t !== 'Guest') visitGuestClass = null;
  persistSession();
  document.querySelectorAll('#vtChooser .seg-btn').forEach(b => { const on = b.dataset.type === t; b.classList.toggle('active', on); b.setAttribute('aria-checked', String(on)); });
  const block = document.getElementById('vtGuestClassBlock');
  if (block) { block.hidden = t !== 'Guest'; const sel = document.getElementById('guestClassSel'); if (sel) sel.value = visitGuestClass || ''; }
}
function setGuestClassSel(v) { visitGuestClass = v || null; persistSession(); }
function pickVisitService(key) {
  if (visitSelectedService?.key !== key) scheduleAttachments = [];
  visitSelectedService = findService(loadDB(), key);
  visitStep = 'choose';
  persistSession();
  if(visitEntryMethod==='appointment')startSchedule(); else if(visitEntryMethod==='walkin')startWalkIn(); else renderVisitChoose();
}
function renderVisitChoose() {
  const svc = visitSelectedService, db = loadDB();
  document.getElementById('visitorContent').innerHTML = `
    <section class="visit-choose-page" aria-label="Choose how to visit">
    ${stepperHtml(2)}
    <div class="svc-selected-bar">
      <div class="lbl">${icon(svc.icon || 'home', 16)} &nbsp;${escapeHtml(svc.label)}<small>${escapeHtml(visitorTypeLabel(visitVisitorType, visitGuestClass))} &middot; Selected service</small></div>
      <button class="btn btn-ghost btn-sm" onclick="uxGoStep(1)">Change service</button>
    </div>
    ${serviceNoticeHtml(svc)}${requirementsBoxHtml(svc)}${templatesBoxHtml(svc)}
    <div class="visit-entry-heading visitor-page-wrap"><h3>How would you like to visit?</h3><p>Review the documents above, then choose an entry method.</p></div>
    <div class="entry-method-grid">
      <button class="svc-card entry-method-card" onclick="startWalkIn()">
        <span class="svc-ic">${icon('ticket', 22)}</span><h3>Walk in today</h3>
        <p>Get your Visit Pass and queue number now.</p>
        <span class="svc-go">Get a queue number</span>
      </button>
      <button class="svc-card entry-method-card" onclick="startSchedule()">
        <span class="svc-ic">${icon('calendar', 22)}</span><h3>Request an appointment</h3>
        <p>Choose your preferred date and an available slot. Staff approve or reschedule your request.</p>
        <span class="svc-go">Request an appointment</span>
      </button>
    </div><div class="visitor-page-wrap visit-calendar-link"><span class="field-hint">Check opening days</span><button class="btn btn-ghost btn-sm" onclick="UniServeUX.visitorCalendar()">View office calendar</button></div>
    </section>`;
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
      : `<div class="field" id="fw${P}IdType"><label for="${p}IdType">Valid ID type ${uxReq}</label>${idTypeSelectHtml(p + 'IdType')}<div class="field-error"></div></div>`}`;
}
function validateVisitorFields(p, isStudent) {
  const P = p.charAt(0).toUpperCase() + p.slice(1);
  const v = id => document.getElementById(p + id).value.trim();
  const first = v('First'), last = v('Last'), contact = '+63' + v('Contact').replace(/\D/g,'').replace(/^(?:63|0)/,'');
  const idType = isStudent ? '' : document.getElementById(p + 'IdType').value;
  const idNumber = isStudent ? v('IdNum').toUpperCase() : '';
  const email = normEmail(v('Email'));
  let ok = true;
  ok = markField(`fw${P}First`, isValidPersonName(first), 'Enter your first name.') && ok;
  ok = markField(`fw${P}Last`, isValidPersonName(last), 'Enter your last name.') && ok;
  if (isStudent) ok = markField(`fw${P}IdNum`, isValidStudentNo(idNumber), 'Use the format 0000-00000-SM-0.') && ok;
  else ok = markField(`fw${P}IdType`, !!idType, 'Select the type of ID you will present.') && ok;
  ok = markField(`fw${P}Contact`, isValidContact(contact), 'Enter a valid PH mobile number (e.g. +639171234567).') && ok;
  ok = markField(`fw${P}Email`, isValidEmail(email), 'Enter a valid email address (e.g. juan.delacruz@gmail.com).') && ok;
  if (!ok) { toast('Please fix the highlighted fields.', 'err'); focusFirstError(); return null; }
  return { first, last, idType, idNumber, contact, email, isPWD: !!document.getElementById(p + 'PWD')?.checked };
}

async function startWalkIn() {
  try{const capacity=await UniServeUX.request('/walk-in-capacity');if(!capacity.accepting){openModal('Walk-ins closed',`<p>${escapeHtml(capacity.message)}</p>${capacity.closedTime?`<p>Walk-in intake closed at <b>${escapeHtml(capacity.closedTime)}</b>.</p>`:''}`,[{label:'Back',cls:'btn-ghost',action:closeModal},{label:'Book appointment',cls:'btn-primary',action:()=>{closeModal();startSchedule();}}]);return;}}catch(e){toast(escapeHtml(e.message),'err');return;} captureVisitorDraft(); visitStep = 'walkin'; persistSession(); renderVisitWalkinForm(); }
function renderVisitWalkinForm() {
  const svc = visitSelectedService, db = loadDB(), isStudent = visitVisitorType === 'Student';
  document.getElementById('visitorContent').innerHTML = `
    ${stepperHtml(3)}
    ${selectedBarHtml('ticket', 'Walk in today', svc)}
    <div class="card card-pad visitor-page-wrap visit-details-form" onkeydown="uxEnter(event,'confirmWalkInPrompt')"><div class="chat-contact-head"><h3>Your details</h3><p>Complete your information, then review it before getting your queue number.</p></div>
      <fieldset class="visitor-form-section"><legend>Personal details</legend>${visitorFieldsHtml('q', isStudent)}
      ${disabilityPriorityHtml('q')}</fieldset>
      <fieldset class="visitor-form-section"><legend>Contact details</legend>
      <div class="field" id="fwQContact"><label for="qContact">Contact number ${uxReq}</label><div class="ph-phone-input"><span class="ph-phone-prefix" title="Philippines (+63)"><span class="ph-phone-flag" aria-hidden="true"><svg viewBox="0 0 30 20" width="24" height="16"><path fill="#0038a8" d="M0 0h30v10H0z"/><path fill="#ce1126" d="M0 10h30v10H0z"/><path fill="#fff" d="M0 0l17 10L0 20z"/><g fill="#fcd116"><circle cx="5.5" cy="10" r="2.2"/><path d="M5 6h1v8H5zM1.5 9.5h8v1h-8zM2.3 7.3l.7-.7 5.7 5.7-.7.7zM2.3 12.7L8 7l.7.7L3 13.4z"/><circle cx="2.4" cy="3.2" r=".8"/><circle cx="2.4" cy="16.8" r=".8"/><circle cx="13" cy="10" r=".8"/></g></svg></span><span class="sr-only">Philippines country code +63</span></span><input id="qContact" type="tel" inputmode="tel" autocomplete="tel" maxlength="17" placeholder="+63 917 123 4567" aria-label="Philippine mobile number, country code +63" onfocus="if (!this.value) this.value='+63'" oninput="formatContactInput(this)"></div><div class="field-error"></div></div>
      <div class="field" id="fwQEmail"><label for="qEmail">Email address ${uxReq}</label><input id="qEmail" type="email" autocomplete="email" placeholder="juan.delacruz@gmail.com" required><p class="field-hint">Email verification is required before continuing.</p><div class="field-error"></div></div>
      </fieldset><p class="field-hint" style="margin-bottom:14px;">Fields marked * are required. After you get your number, watch the &ldquo;Now Serving&rdquo; board and go to OSS when called.</p>
      ${visitorTermsHtml('q')}
      <button class="btn btn-gold btn-block" onclick="confirmWalkInPrompt()">${icon('check', 16)} Review details</button>
    </div>`;
  restoreVisitorDraft('q');
}
async function confirmWalkInPrompt() {
  if (!requireVisitorTerms('q')) return;
  if (!isOfficeHours()) { toast(`Walk-in queue numbers can only be issued ${officeHoursLabel()}.`, 'err'); renderClosedScreen(); return; }
  if (maintenanceOn()) { toast('The visitor portal is closed for maintenance.', 'err'); renderMaintenanceNotice(); return; }
  const svc = visitSelectedService, isStudent = visitVisitorType === 'Student';
  const vals = validateVisitorFields('q', isStudent);
  if (!vals) return;
  try { if(!await SharedAppointments.ensureEmail(vals.email,confirmWalkInPrompt)) return; }
  catch(error) { toast(escapeHtml(error.message),'err'); return; }
  const isSenior = isSeniorFromClassification(visitVisitorType, visitGuestClass);
  const name = joinName(vals.first, vals.last);
  const dup = findActiveDuplicate(loadDB(), vals.idNumber, svc.key, vals.email);
  const body = duplicateWarningHtml(dup) + confirmSummaryHtml({
    intro: 'Please check your details before you get your queue number.',
    sections: [
      { title: 'Your visit', rows: [['Service', svc.label, true], ['Entry method', 'Walk-in'], ['Priority', [isSenior ? 'Senior citizen' : '', vals.isPWD ? 'Person with disability' : ''].filter(Boolean).join(' / ')]] },
      { title: 'About you', rows: [['Name', name, true], ['Visitor type', visitorTypeLabel(visitVisitorType, visitGuestClass)], ['ID type', vals.idType], [isStudent ? 'Student number' : 'ID number', vals.idNumber], ['Contact number', vals.contact], ['Email', vals.email, true]] },
    ],
    notice: 'Your queue number is issued right after you confirm.',
  });
  confirmAction('Review your walk-in', body, 'Get My Queue Number', () => confirmWalkIn(!!dup, vals, name, isSenior), null, 'Edit details');
}
let walkInPending = false;
async function confirmWalkIn(possibleDuplicate, vals, name, isSenior) {
  if (!requireVisitorTerms('q')) return;
  try { if(!await SharedAppointments.ensureEmail(vals.email,()=>confirmWalkIn(possibleDuplicate,vals,name,isSenior))) return; }
  catch(error) { toast(escapeHtml(error.message),'err'); return; }
  if (walkInPending) return;
  if (!isOfficeHours()) { toast(`Walk-in queue numbers can only be issued ${officeHoursLabel()}.`, 'err'); renderClosedScreen(); return; }
  const svc = visitSelectedService, db = loadDB();
  let entry;
  walkInPending = true;
  try {
    const response = await fetch((globalThis.UniServeConfig?.apiBase||'http://127.0.0.1:8000/api')+'/visits', {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
    visitorType: visitVisitorType, serviceKey: svc.key, serviceLabel: svc.label, source: 'Walk-in',
    name, idNumber: vals.idNumber, idType: vals.idType, guestClass: visitGuestClass, contact: vals.contact, email: vals.email,
    isSenior, isPWD: !!vals.isPWD, possibleDuplicate,
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(Object.values(result.errors || {}).flat().join(' ') || result.message || 'Could not start the visit.');
    entry = result.queue;
  } catch (error) { toast(escapeHtml(error instanceof TypeError ? 'We could not start your visit. Check your connection and try again.' : error.message), 'err'); return; }
  finally { walkInPending = false; }
  db.queues.push(entry);
  logActivity(db, VISITOR_ACTOR, `Joined queue ${entry.number} (${entry.visitId}) &mdash; walk-in, ${entry.serviceLabel}`, { category: 'Queue', target: entry.visitId });
  saveDB(db);
  clearVisitorDraft();
  myActiveQueueId = entry.id; visitStep = 'ticket'; persistSession();
  toast(`Visit ${entry.visitId} started &mdash; queue number ${entry.number}.`, 'ok');
  renderQueueTicket();
}

function startSchedule() { captureVisitorDraft(); visitStep = 'schedule'; persistSession(); renderVisitScheduleForm(); }
function renderVisitScheduleForm() {
  const svc = visitSelectedService, isStudent = visitVisitorType === 'Student', reqs = svc.requirements || [];
  document.getElementById('visitorContent').innerHTML = `
    ${stepperHtml(3)}
    ${selectedBarHtml('calendar', 'Request an appointment', svc)}
    <div class="card card-pad visitor-page-wrap visit-details-form" onkeydown="uxEnter(event,'confirmSchedulePrompt')"><div class="chat-contact-head"><h3>Your appointment details</h3><p>Choose your preferred date and available time. Staff will approve or reschedule your request.</p></div>
      <fieldset class="visitor-form-section"><legend>Schedule</legend><input id="bkOffice" type="hidden" value="">
      <div class="form-row"><div class="field"><label for="bkDate">Preferred date *</label><input id="bkDate" type="date" min="${OfficeCalendar.parts().date}" onchange="refreshBookingSlots()" required></div><div class="field"><label for="bkTime">Available time slot *</label><select id="bkTime" required disabled><option value="">Choose a date first</option></select></div></div><p id="bkSlotStatus" class="field-hint" role="status" aria-live="polite"></p>
      </fieldset><fieldset class="visitor-form-section"><legend>Personal details</legend>${visitorFieldsHtml('bk', isStudent)}
      ${disabilityPriorityHtml('bk')}</fieldset>
      <fieldset class="visitor-form-section"><legend>Contact details</legend>
      <div class="form-row">
        <div class="field" id="fwBkContact"><label for="bkContact">Contact number ${uxReq}</label><div class="ph-phone-input"><span class="ph-phone-prefix" title="Philippines (+63)"><span class="ph-phone-flag" aria-hidden="true"><svg viewBox="0 0 30 20" width="24" height="16"><path fill="#0038a8" d="M0 0h30v10H0z"/><path fill="#ce1126" d="M0 10h30v10H0z"/><path fill="#fff" d="M0 0l17 10L0 20z"/><g fill="#fcd116"><circle cx="5.5" cy="10" r="2.2"/><path d="M5 6h1v8H5zM1.5 9.5h8v1h-8zM2.3 7.3l.7-.7 5.7 5.7-.7.7zM2.3 12.7L8 7l.7.7L3 13.4z"/><circle cx="2.4" cy="3.2" r=".8"/><circle cx="2.4" cy="16.8" r=".8"/><circle cx="13" cy="10" r=".8"/></g></svg></span><span class="sr-only">Philippines country code +63</span></span><input id="bkContact" type="tel" inputmode="tel" autocomplete="tel" maxlength="17" placeholder="+63 917 123 4567" aria-label="Philippine mobile number, country code +63" onfocus="if (!this.value) this.value='+63'" oninput="formatContactInput(this)"></div><div class="field-error"></div></div>
        <div class="field" id="fwBkEmail"><label for="bkEmail">Email address ${uxReq}</label><input id="bkEmail" type="email" autocomplete="email" placeholder="juan.delacruz@gmail.com"><p class="field-hint">Email verification is required before continuing.</p><div class="field-error"></div></div>
      </div>
      </fieldset><fieldset class="visitor-form-section"><legend>Supporting documents <span class="opt">(optional)</span></legend>
      <div class="field">
        ${templatesBoxHtml(svc)}
        ${reqs.length ? `<ul class="visitor-requirements">${reqs.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` : ''}
        <label class="dropzone" for="bkFiles" ondragover="event.preventDefault(); this.classList.add('drag')" ondragleave="this.classList.remove('drag')" ondrop="uxDropFiles(event)">
          ${icon('paperclip', 20)}<span><b>Choose files</b> or drag them here</span><small>PDF, JPG or PNG &middot; up to 5 MB each</small>
        </label>
        <input id="bkFiles" type="file" multiple hidden accept="application/pdf,image/png,image/jpeg" onchange="handleScheduleFilesChange(this)">
        <p class="field-hint">Uploads are optional. Bring the required documents when you visit OSS.</p><div id="bkReadiness"></div><div id="bkAttachPreview"></div>
      </div>
      </fieldset><p class="field-hint" style="margin-bottom:14px;">* Required fields. We will email you when OSS approves or reschedules your request.</p>
      ${visitorTermsHtml('bk')}
      <button class="btn btn-primary btn-block" id="bkSubmitBtn" onclick="confirmSchedulePrompt()">Review details</button>
    </div>`;
  restoreVisitorDraft('bk');
  loadBookingOffices();
  updateScheduleAttachUI();
}
let bookingSlotVersion=0;
async function loadBookingOffices(){
  const input=document.getElementById('bkOffice');
  try{const result=await SharedAppointments.request('/appointment-offices');if(!input.isConnected)return;input.value=result.offices.includes('Office of Student Services')?'Office of Student Services':(result.offices[0]||'');await refreshBookingSlots();}
  catch(error){if(input.isConnected){document.getElementById('bkSlotStatus').textContent='Could not load appointment availability. Please try again.';toast(escapeHtml(error.message),'err');}}
}
async function refreshBookingSlots(){
  const version=++bookingSlotVersion,office=document.getElementById('bkOffice')?.value,date=document.getElementById('bkDate')?.value,input=document.getElementById('bkTime'),status=document.getElementById('bkSlotStatus');
  if(!input)return;input.disabled=true;input.innerHTML='<option value="">'+(office&&date?'Loading available slots...':'Choose a date first')+'</option>';
  if(!office||!date)return;
  try{const result=await SharedAppointments.request('/appointment-slots?'+new URLSearchParams({office,date}));if(version!==bookingSlotVersion||!input.isConnected)return;input.innerHTML='<option value="">'+(result.slots.length?'Select a time':'No available slots')+'</option>'+result.slots.map(time=>'<option value="'+time+'">'+escapeHtml(UniServeUX.timeLabel(time))+'</option>').join('');input.disabled=!result.slots.length;status.textContent=result.slots.length?'':'No slots available for this office and date. Choose another date.';}
  catch(error){if(version!==bookingSlotVersion||!input.isConnected)return;status.textContent=error.message;input.innerHTML='<option value="">Availability could not be loaded</option>';}
}
function uxDropFiles(e) { e.preventDefault(); e.currentTarget.classList.remove('drag'); addScheduleFiles(e.dataTransfer.files); }
function handleScheduleFilesChange(inputEl) { const files = Array.from(inputEl.files || []); inputEl.value = ''; return addScheduleFiles(files); }
async function addScheduleFiles(fileList) {
  const accepted = [];
  for (const f of Array.from(fileList || [])) {
    const name = f.name.toLowerCase();
    if (!ALLOWED_ATTACHMENT_TYPES.some(t => f.type && f.type.startsWith(t))) { toast(`"${escapeHtml(f.name)}" is not a PDF or image.`, 'err'); continue; }
    if (f.size > UX_MAX_FILE) { toast(`"${escapeHtml(f.name)}" is over 5 MB.`, 'err'); continue; }
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
async function confirmSchedulePrompt() {
  if (!requireVisitorTerms('bk')) return;
  if (maintenanceOn()) { toast('The visitor portal is closed for maintenance.', 'err'); renderMaintenanceNotice(); return; }
  const svc = visitSelectedService, isStudent = visitVisitorType === 'Student';
  const vals = validateVisitorFields('bk', isStudent);
  if (!vals) return;
  const office=document.getElementById('bkOffice').value,date=document.getElementById('bkDate').value,time=document.getElementById('bkTime').value;
  if(!office||!date||!time){toast('Choose your date and an available time slot.','err');return;}
  Object.assign(vals,{office,date,time});
  try { if(!await SharedAppointments.ensureEmail(vals.email,confirmSchedulePrompt)) return; }
  catch(error) { toast(escapeHtml(error.message),'err'); return; }
  const isSenior = isSeniorFromClassification(visitVisitorType, visitGuestClass);
  const name = joinName(vals.first, vals.last);
  const dup = findActiveDuplicate(loadDB(), vals.idNumber, svc.label, vals.email);
  const readiness = computeReadiness(svc, scheduleAttachments);
  const files = scheduleAttachments.length ? scheduleAttachments.map(f => f.name).join(', ') : 'No files uploaded';
  const body = duplicateWarningHtml(dup) + confirmSummaryHtml({
    intro: 'Please check your request before you send it to OSS.',
    sections: [
      { title: 'Your visit', rows: [['Service', svc.label, true], ['Office', vals.office], ['Preferred schedule', vals.date+' '+UniServeUX.timeLabel(vals.time)], ['Entry method', 'Appointment request'], ['Priority', [isSenior ? 'Senior citizen' : '', vals.isPWD ? 'Person with disability' : ''].filter(Boolean).join(' / ')]] },
      { title: 'About you', rows: [['Name', name, true], ['Visitor type', visitorTypeLabel(visitVisitorType, visitGuestClass)], ['ID type', vals.idType], [isStudent ? 'Student number' : 'ID number', vals.idNumber]] },
      { title: 'How we reach you', rows: [['Contact number', vals.contact], ['Email', vals.email, true]] },
      { title: 'Requirements', rows: [['Files', files], ['Status', readiness.label]] },
    ],
    notice: 'Your selected slot will be reserved while staff review your request. Wait for approval or a rescheduled time and your Visit ID before travelling. On arrival, show that Visit ID to the Admin for check-in.',
  });
  confirmAction('Review your appointment request', body, 'Submit Request', () => confirmSchedule(!!dup, readiness.status, vals, name, isSenior), null, 'Edit details');
}
async function confirmSchedule(possibleDuplicate, readinessStatus, vals, name, isSenior) {
  if (!requireVisitorTerms('bk')) return;
  try { if(!await SharedAppointments.ensureEmail(vals.email,()=>confirmSchedule(possibleDuplicate,readinessStatus,vals,name,isSenior))) return; }
  catch(error) { toast(escapeHtml(error.message),'err'); return; }
  if (maintenanceOn()) { renderMaintenanceNotice(); return; }
  const svc = visitSelectedService, btn = document.getElementById('bkSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }
  const db = loadDB();
  let appt;
  try {
    const submissionKey=sessionStorage.getItem('oss_appointment_submission')||crypto.randomUUID();sessionStorage.setItem('oss_appointment_submission',submissionKey);
    const result = await SharedAppointments.request('/appointments', 'POST', {submissionKey,
      name, type: visitVisitorType, guestClass: visitGuestClass, idNumber: vals.idNumber,
      idType: vals.idType, contact: vals.contact, email: vals.email, serviceKey: svc.key,
      office:vals.office, date:vals.date, time:vals.time, isSenior, isPWD: !!vals.isPWD, attachments: scheduleAttachments
    });
    SharedAppointments.cache(result); appt = result.appointment;sessionStorage.removeItem('oss_appointment_submission');
  } catch (error) {
    toast(escapeHtml(error.message), 'err');
    if(error.status===409){sessionStorage.removeItem('oss_appointment_submission');await refreshBookingSlots();}
    if (btn) { btn.disabled=false; btn.textContent='Review details'; }
    return;
  }
  scheduleAttachments = [];
  toast('Appointment request submitted.', 'ok');
  clearVisitorDraft(); visitStep = 'pass'; persistSession();
  showPassModalReadonly(appt, true);
}

function appointmentPassHtml(appt) {
  if (appt.ticketHtml) return `<div class="printable-ticket">${appt.ticketHtml.replace(/ style="[^"]*"/g, '')}</div>`;
  const slot = appt.date ? `${appt.date} &middot; ${escapeHtml(UniServeUX.timeLabel(appt.time))}` : 'Pending';
  const seniorNote = (appt.isSenior && appt.guestClass !== 'Senior Citizen' ? ' &middot; Senior' : '') + (appt.isPWD ? ' &middot; PWD priority' : '');
  return `
    <div class="printable-ticket">
      <div class="ticket-v2-card">
        <div class="ticket-v2-main">
          <div class="ticket-v2-top">
            <div class="ticket-v2-header">
              <img src="pup.jpg" alt="PUP logo" class="ticket-v2-logo">
              <div class="ticket-v2-org"><div class="ticket-v2-org-uni">Polytechnic University of the Philippines</div><div class="ticket-v2-org-sub">Santa Maria Campus<br>Office of Student Services</div></div>
              <div class="ticket-v2-issued">Requested<br>${fmtDateTime(appt.createdAt)}</div>
            </div>
            <div class="ticket-v2-body">
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
              <div class="ticket-v2-field"><span class="tvf-lbl">${icon('checkin', 13)} Status</span><span class="tvf-val">${escapeHtml(String(appt.status))}</span></div>
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
  const files = appt.attachments || [];
  const rows = files.map((file,index) => {
    const review = file.review || {}, status = review.status || 'Pending review';
    const tone = status === 'Accepted' ? 'pill-ok' : status === 'Needs correction' ? 'pill-danger' : 'pill-warn';
    return `<li class="requirement-file"><div class="requirement-file-row">${attachChip(file)}<span class="pill ${tone}">${escapeHtml(status)}</span></div>${review.reason ? `<p class="requirement-feedback">${escapeHtml(review.reason)}</p>` : ''}${review.reviewedAt ? `<p class="requirement-reviewed">Reviewed ${escapeHtml(String(fmtDateTime(review.reviewedAt)).replace(/&middot;/g, '\u00b7'))}</p>` : ''}${status==='Needs correction'&&['Requested','Booked'].includes(appt.status)?`<div class="field"><label for="replacement${index}">Corrected document</label><input id="replacement${index}" type="file" accept="application/pdf,image/png,image/jpeg"><button type="button" class="btn btn-ghost btn-sm" data-visit-id="${escapeHtml(appt.id)}" data-index="${index}" onclick="replaceVisitDocument(this)">Submit replacement</button></div>`:''}</li>`;
  }).join('');
  return `<section class="appointment-requirements" aria-label="Uploaded requirements"><div class="requirements-heading"><h4>Uploaded requirements</h4>${readinessPillHtml(computeReadiness(svc, files))}</div>${files.length ? `<ul class="requirement-files">${rows}</ul>` : '<p class="requirements-note">No files uploaded with this booking.</p>'}</section>`;
}

function timelineStepsHtml(q, appointment = null) {
  const steps = [
    ...(appointment ? [{ lbl: 'Requested', ic: 'calendar', ts: appointment.createdAt }, ...(appointment.scheduledConfirmedAt ? [{ lbl: 'Schedule Confirmed', ic: 'calendar', ts: appointment.scheduledConfirmedAt }] : [])] : []),
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
let sharedTicketLoading = false;
let lastTicketRender = {id:null,status:null};
async function renderQueueTicket() {
  if (sharedTicketLoading) return;
  const selectedQueueId=myActiveQueueId,navigation=typeof visitorNavigationVersion==='undefined'?0:visitorNavigationVersion;
  const local = loadDB().queues.find(q => q.id === selectedQueueId);
  if (local?.shared) {
    sharedTicketLoading = true;
    try {
      const api=globalThis.UniServeConfig?.apiBase||'http://127.0.0.1:8000/api';
      const [response,capacity]=await Promise.all([fetch(api+'/visits/'+encodeURIComponent(local.visitId),{headers:{Accept:'application/json'}}),fetch(api+'/walk-in-capacity').then(r=>r.ok?r.json():null).catch(()=>null)]);
      window.UniServeWalkInCapacity=capacity;
      const result = await response.json();
      if (response.ok) {
        const latest = loadDB();
        latest.queues = latest.queues.filter(q => q.id !== result.queue.id).concat(result.queue);
        saveDB(latest);
      }
    } catch (_) { /* Keep the last known ticket until the next poll. */ }
    finally { sharedTicketLoading = false; }
    if (!['visit', 'checkvisit'].includes(visitorView)) return;
  }
  if(myActiveQueueId!==selectedQueueId||(typeof visitorNavigationVersion!=='undefined'&&visitorNavigationVersion!==navigation)||(typeof visitorHubOpen!=='undefined'&&visitorHubOpen))return;
  const db = loadDB(), q = db.queues.find(x => x.id === selectedQueueId);
  if (!q) { resetVisit(); return; }
  const isAppt = q.source === 'Appointment';
  const due = isDue(q);
  const ahead = q.status === 'Waiting' ? (window.UniServeWalkInCapacity?.peopleAhead?.[q.id] ?? null) : 0;
  if(q.status==='Waiting'&&isDue(q)&&Number.isFinite(ahead)&&ahead<=2)notifyNearTurn(q,ahead);
  const etaMin = window.UniServeWalkInCapacity?.waitEstimates?.[q.id];
  const linkedAppt = q.appointmentId ? db.appointments.find(a => a.id === q.appointmentId) : null;
  const slotText = q.scheduledAt ? fmtTime(q.scheduledAt) : '';
  const ref = queueRef(q);

  let topLine = '';
  if (q.status === 'Called') topLine = `<div class="ticket-v2-line ticket-v2-callout">${icon('megaphone', 15)} It's your turn &mdash; proceed to ${escapeHtml(q.assignedAdminName || 'the OSS Admin')}</div>`;
  else if (q.status === 'Serving') topLine = `<div class="ticket-v2-line">Currently being assisted by ${escapeHtml(q.assignedAdminName || 'the OSS Admin')}</div>`;
  else if (q.status === 'Unfinished') topLine = `<div class="ticket-v2-line ticket-v2-warn">This visit was unfinished on a previous day. Please start a new visit. Your old record remains in history.</div>`;
  else if (q.status === 'Skipped') topLine = `<div class="ticket-v2-line ticket-v2-warn">${icon('alert', 13)} We called you but couldn't reach you &mdash; please see the front desk.</div>`;
  else if (q.status === 'Cancelled') topLine = `<div class="ticket-v2-line ticket-v2-warn">${icon('x', 13)} This visit was cancelled.${q.closureReason?' '+escapeHtml(q.closureReason):''}</div>`;
  else if (q.status === 'Waiting') topLine = `<div class="ticket-v2-line">You are in the queue. Wait for OSS to call you.</div>`;

  let waitBanner = '';
  if (q.status === 'Waiting') {
    if (isAppt && !due) waitBanner = `<div class="wait-estimate">Your slot is at ${slotText} &mdash; you will be called when it arrives</div>`;
    else if (!Number.isFinite(ahead)) waitBanner = '<div class="wait-estimate">Queue estimate temporarily unavailable. Stay near OSS and watch for your call.</div>';
    else waitBanner = `<div class="wait-estimate"><div class="wait-estimate-copy"><span class="wait-estimate-label">${ahead} ${ahead === 1 ? 'person' : 'people'} ahead of you</span><strong>Estimated wait: ${Number.isFinite(etaMin) ? fmtWaitDuration(etaMin) : 'unavailable'}</strong><span class="wait-estimate-note">Timing may change as priority visits arrive.</span></div></div>`;
  }

  const finished = ['Completed', 'Skipped', 'Cancelled', 'Unfinished'].includes(q.status), isDone = q.status === 'Completed';
  const justCompleted=isDone&&lastTicketRender.id===q.id&&lastTicketRender.status!=='Completed';
  const seniorNote = (q.isSenior && q.guestClass !== 'Senior Citizen' ? ' &middot; Senior' : '') + (q.isPWD ? ' &middot; PWD priority' : '');
  const dupBadge = q.possibleDuplicate ? `<div class="qt-source-note ticket-v2-dup">${icon('alert', 11)} Flagged for OSS review as a possible duplicate visit</div>` : '';
  const firstField = isAppt
    ? `<span class="tvf-lbl">${icon('calendar', 13)} Scheduled</span><span class="tvf-val">${q.scheduledAt ? fmtDateTime(q.scheduledAt) : '&mdash;'}</span>`
    : `<span class="tvf-lbl">${icon('ticket', 13)} Visit ID</span><span class="tvf-val">${escapeHtml(q.visitId)}</span>`;
  const serving = servingQueueEntries(db);
  const nowServing = `<div class="qt-nowserving"><div class="qt-nowserving-head"><span class="qt-live-dot"></span><div class="qt-nowserving-lbl">Now Serving</div></div>
    <div class="qt-nowserving-row">${serving.length ? serving.map(e => `<span class="pill ${e.id === q.id ? 'pill-gold' : 'pill-info'}">${escapeHtml(queueRef(e))}</span>`).join('') : `<span class="qt-empty">No one is being served yet.</span>`}</div></div>`;
  const reqSection = linkedAppt ? `<div class="card card-pad"><label style="display:block; font-size:.78rem; font-weight:600; margin-bottom:6px; color:var(--text-soft);">Your uploaded requirements</label>${attachListHtml(linkedAppt.attachments, 'No files were uploaded with this booking.')}${documentReviewHtml(linkedAppt)}${visitExtrasHtml({...linkedAppt,followUpTask:Object.prototype.hasOwnProperty.call(q,'followUpTask')?q.followUpTask:linkedAppt.followUpTask})}</div>` : (q.followUpTask?`<div class="card card-pad">${visitExtrasHtml(q)}</div>`:'');
  const another = `<button class="btn btn-primary" onclick="resetVisit()">Start another visit</button>`;
  const download = isDone ? '' : `<button type="button" class="btn btn-ghost ticket-download-action" onclick="downloadVisitorTicket(this)">Download ticket</button>`;
  const nextStep = isDone ? 'Your visit is complete. Share feedback about your service below.' : q.status==='Called' ? 'Proceed to '+(q.assignedAdminName || 'the OSS counter')+' now and show your Visit ID.' : q.status==='Serving' ? 'Your service is in progress. Follow the instructions from OSS staff.' : q.status==='Skipped' ? 'Speak with the OSS front desk to review your missed call.' : q.status==='Cancelled' ? 'Start another visit if you still need assistance.' : q.status==='Unfinished' ? 'Start a new visit. Your previous record remains in visit history.' : 'Stay near OSS and watch for your queue number to be called.';
  document.getElementById('visitorContent').innerHTML = `
    <div class="visitor-page-wrap"><div class="card card-pad queue-record"><h3>Your Visit Pass</h3><p class="field-hint">Keep your Visit ID to return to this status screen.</p><section class="visit-status-summary" aria-label="Current visit status"><span class="visit-status-caption">Current status</span><h4>${escapeHtml(q.status)}</h4><p><strong>Next step:</strong> ${escapeHtml(nextStep)}</p></section><div class="queue-ticket-wrap">
      ${waitBanner}
      <div class="qt-layout">
        <div class="qt-main ${isDone ? 'qt-main-complete' : ''}">
          <div class="printable-ticket">
            <div class="ticket-v2-card ${isDone ? 'is-complete' : ''}">
              <div class="ticket-v2-main">
                <div class="ticket-v2-top">
                  <div class="ticket-v2-header">
                    <img src="pup.jpg" alt="PUP logo" class="ticket-v2-logo">
                    <div class="ticket-v2-org"><div class="ticket-v2-org-uni">Polytechnic University of the Philippines</div><div class="ticket-v2-org-sub">Santa Maria Campus<br>Office of Student Services</div></div>
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
                  ${isDone?'<div class="ticket-completion-mark"><div class="ticket-v2-stamp" role="img" aria-label="Visit completed"><span class="ticket-stamp-caption">OSS &middot; Visit record</span><strong>Completed</strong>'+(q.completedAt?'<span class="ticket-stamp-date">'+escapeHtml(fmtDate(q.completedAt))+'</span>':'')+'</div></div>':''}
                  <div class="ticket-v2-grid">
                    <div class="ticket-v2-field">${firstField}</div>
                    <div class="ticket-v2-field"><span class="tvf-lbl">${icon('folder', 13)} Service</span><span class="tvf-val">${escapeHtml(serviceQueueLabel(db, q))}</span></div>
                    <div class="ticket-v2-field"><span class="tvf-lbl">${icon('checkin', 13)} Checked-in</span><span class="tvf-val">${fmtTime(q.checkedInAt || q.createdAt)}</span></div>
                    <div class="ticket-v2-field"><span class="tvf-lbl">${icon(isAppt ? 'calendar' : 'ticket', 13)} Entry Method</span><span class="tvf-val">${isAppt ? 'Scheduled' : 'Walk-in'}</span></div>
                  </div>
                  <p class="ticket-v2-fine-print">${isDone ? 'This visit is complete &mdash; this pass has been used and is no longer valid.' : (isAppt ? "This pass is valid for your scheduled visit only and is non-transferable. You are called when your scheduled time arrives." : "This pass is valid for today's visit only and is non-transferable. Please present it at the counter when your number is called.")}</p>
                </div>
              </div>
              <div class="ticket-v2-stub"><div class="ticket-v2-stub-inner"><span class="ticket-v2-stub-lbl">${q.number ? 'Queue No.' : 'Visit ID'}</span><span class="ticket-v2-stub-num">${escapeHtml(ref)}</span><span class="ticket-v2-stub-id">${escapeHtml(q.number ? q.visitId : (slotText || ''))}</span></div></div>
            </div>
          </div>
        </div>
        <div class="qt-side">
          ${feedbackSectionHtml(q)}
          <details class="visit-journey queue-visit-journey" ${isDone?'':'open'}><summary><span class="visit-journey-title">Visit progress</span><span class="visit-journey-status">${escapeHtml(q.status)}</span><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m6 9 6 6 6-6"/></svg></summary><div class="queue-journey-body">${timelineStepsHtml(q, q.appointmentProgress || linkedAppt)}</div></details>
          ${isDone ? '' : nowServing}
          ${q.caseStatus?`<div class="card card-pad"><h3>Case follow-up</h3><p>Visit: Completed &middot; Case: ${escapeHtml(q.caseStatus)}</p><p class="field-hint">${q.caseStatus==='Resolved'?'Your concern has been resolved.':'Your visit is complete. Your concern remains under review.'}</p></div>`:''}
        </div>
      </div>
      ${reqSection}
      ${typeof flowServiceHistory==='function'?flowServiceHistory(q.serviceHistory):''}
      <div class="appointment-pass-actions">
        <div class="pass-actions-main">${finished?another:'<button type="button" class="btn btn-primary" onclick="renderQueueTicket()">Refresh status</button>'}</div>
        <div class="pass-actions-secondary">${download}${q.status==='Unfinished'&&linkedAppt?'<button type="button" class="btn btn-ghost" onclick="showPassModalReadonly(loadDB().appointments.find(a=>a.id===loadDB().queues.find(q=>q.id===myActiveQueueId).appointmentId),true)">View appointment</button>':''}</div>
        ${!finished&&q.status!=='Serving'?'<div class="pass-actions-footer"><button type="button" class="btn btn-danger-ghost" onclick="confirmCancelQueuePrompt()">Cancel visit</button></div>':''}
      </div>
    </div></div></div>`;
  lastTicketRender={id:q.id,status:q.status};
  if(justCompleted)document.querySelector('.queue-record')?.scrollIntoView({block:'start',behavior:'smooth'});
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
async function cancelMyQueue() {
  const pendingDb = loadDB(), pendingQueue = pendingDb.queues.find(q=>q.id===myActiveQueueId), appointment = pendingDb.appointments.find(a=>a.id===pendingQueue?.appointmentId);
  if(appointment?.notificationCancelToken){try{await UniServeUX.request('/notifications/cancel-token','POST',{token:appointment.notificationCancelToken});}catch(error){toast(escapeHtml(error.message),'err');return;}}
  const db = loadDB();
  const entry = db.queues.find(q => q.id === myActiveQueueId);
  if (entry?.shared) {
    try {
      const response = await fetch((globalThis.UniServeConfig?.apiBase||'http://127.0.0.1:8000/api')+'/visits/' + encodeURIComponent(entry.visitId) + '/cancel', { method: 'POST', headers: { Accept: 'application/json' } });
      const result = await response.json();
      if (!response.ok) { toast(escapeHtml(result.message || 'Cannot cancel this visit.'), 'err'); return; }
    } catch (_) { toast('Cannot reach the queue service. Please try again.', 'err'); return; }
  }
  if (myActiveQueueId) { cancelQueue(db, myActiveQueueId, VISITOR_ACTOR); saveDB(db); }
  toast('Visit cancelled.', 'ok');
  resetVisit();
}
function startTicketPolling() {
  stopTicketPolling();
  ticketPollTimer = setInterval(() => { if ((!window.UniServeRealtime?.connected || document.visibilityState === 'hidden') && (visitorView === 'visit' || visitorView === 'checkvisit') && myActiveQueueId) renderQueueTicket(); }, 3000);
}
function stopTicketPolling() { if (ticketPollTimer) { clearInterval(ticketPollTimer); ticketPollTimer = null; } }

function renderCheckVisitScreen() {
  document.getElementById('visitorContent').innerHTML=`<div class="card card-pad visitor-page-wrap"><div class="chat-contact-head"><h3>Find your visit</h3><p>Enter your Visit ID to see your pass, queue status or appointment.</p></div><div class="field"><label for="cvInput">Visit ID</label><input id="cvInput" class="upper" placeholder="VIS-K7M29QXA" autocomplete="off" aria-describedby="visitorLookupError" onkeydown="if(event.key==='Enter')lookupMyVisit()"><div class="field-error" id="visitorLookupError" role="alert" hidden></div></div><button class="btn btn-primary btn-block" onclick="lookupMyVisit()">View Visit Pass</button><details class="visitor-form-help"><summary>Where is my Visit ID?</summary><p>Find it on your Visit Pass or confirmation email. Each visit has its own ID. You can enter older Visit IDs too.</p></details></div>`;
}

async function lookupMyVisit() {
  const code = normVisitRef(document.getElementById('cvInput').value);
  if (!code) { visitorFormError('Enter your Visit ID.', 'visitorLookupError'); return; }
  const db = loadDB();
  const savedAppointment = db.appointments.find(a => (a.visitId || a.requestReference || a.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === code.replace(/[^A-Z0-9]/g, ''));
  if (savedAppointment && !savedAppointment.queueId) {showPassModalReadonly(savedAppointment, true);return;}
  const q = db.queues.find(x => (x.visitId || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === code.replace(/[^A-Z0-9]/g, ''));
  if (q) { myActiveQueueId = q.id; persistSession(); renderQueueTicket(); return; }
  try {
    const response = await fetch((globalThis.UniServeConfig?.apiBase||'http://127.0.0.1:8000/api')+'/visits/' + encodeURIComponent(code), { headers: { Accept: 'application/json' } });
    if (response.ok) {
      const result = await response.json();
      db.queues.push(result.queue); saveDB(db);
      myActiveQueueId = result.queue.id; persistSession(); renderQueueTicket(); return;
    }
  } catch (_) { visitorFormError('Cannot reach the queue service. Please try again.', 'visitorLookupError'); return; }
  const appt = db.appointments.find(x => (x.visitId || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === code.replace(/[^A-Z0-9]/g, ''));
  if (!appt) { visitorFormError('No visit found with that Visit ID.', 'visitorLookupError'); return; }
  if (appt.queueId && db.queues.some(x => x.id === appt.queueId)) { myActiveQueueId = appt.queueId; persistSession(); renderQueueTicket(); return; }
  showPassModalReadonly(appt, true);
}
function showPassModalReadonly(apptIn, embedded = false) {
  const db = loadDB();
  const appt = db.appointments.find(x => x.id === apptIn.id) || apptIn;
  const linked = appt.queueId && ['Checked-in','Completed'].includes(appt.status) ? db.queues.find(q => q.id === appt.queueId) : null;
  if(embedded&&linked?.status==='Completed'){
    visitorView='checkvisit';visitStep='ticket';myActiveQueueId=linked.id;
    if(typeof setVisitorHubState==='function')setVisitorHubState(false);
    sessionStorage.removeItem('oss_activeAppointmentId');persistSession();renderVisitorSidebar();renderQueueTicket();return;
  }
  const bookingConflict = UniServeUX.conflict(appt);
  const canCheckIn = !linked && appt.status === 'Booked' && !bookingConflict && appt.date === OfficeCalendar.parts().date;
  const arrival = canCheckIn ? evaluateArrival(db, appt) : null;
  const sched = apptScheduledDate(appt);
  let banner = '';
  if (canCheckIn && sched && sched > new Date()) banner = `<div class="info-banner">${icon('clock', 13)} Your slot is at ${fmtTime(sched)}. Show your Visit ID at the OSS counter when you arrive.</div>`;
  else if (arrival && arrival.status === 'Late') banner = `<div class="info-banner warn">${icon('alert', 13)} You're about ${arrival.lateMinutes} minutes past your scheduled time. Please speak with OSS staff so they can review your arrival.</div>`;
  else if (arrival && arrival.status === 'PastWindow') banner = `<div class="info-banner danger">${icon('alert', 13)} This appointment's window has passed (${arrival.lateMinutes} minutes late). Please speak with the front desk &mdash; they'll confirm whether you can still be served today.</div>`;

  if (bookingConflict) banner = `<div class="info-banner warn"><span><b>Your appointment needs rescheduling.</b><br>${escapeHtml(bookingConflict)}. Contact OSS to confirm a new date and time. Your booking has not been cancelled.</span></div>`;
  const notes = {
    Cancelled: 'This scheduled visit has been cancelled. Start a new visit if you still need the service.',
    'No-show': 'You missed this appointment. Request a new schedule below; your details and uploads are retained.',
    Unfinished: 'Your visit was not finished. Request a new schedule or show this Visit ID to OSS to resume it.',
    Requested: `Your request is still pending. OSS will email you at ${escapeHtml(appt.email || '')} when staff approve or reschedule your selected slot. Use your request reference to check updates and wait for confirmation before travelling.`,
  };
  notes.Completed = 'Your visit is complete. Open your visit to leave feedback about the service.';
  notes['Checked-in'] = 'You are checked in. Follow your queue status and wait for OSS to call you.';
  const note = bookingConflict ? 'Contact OSS before travelling to the office; your scheduled slot is unavailable.' : linked ? (linked.status === 'Completed' ? notes.Completed : notes['Checked-in']) : (notes[appt.status] || (appt.status === 'Booked' && !canCheckIn ? 'Show your Visit ID at the OSS counter on your appointment day. An Admin will check you in when you arrive.' : '') || 'Show your Visit ID at the OSS counter. An Admin will check you in when you arrive.');
  const buttons = appt.status==='Completed'||linked?.status==='Completed'?[]:[{label:'Download ticket',cls:'btn-ghost',action:()=>downloadVisitorTicket()}];
  if (appt.shared && ['Requested','Booked'].includes(appt.status)) buttons.push({label:'Cancel appointment',cls:'btn-danger-ghost',action:()=>cancelSharedAppointment(appt.id)});
  if(appt.shared&&['Requested','Booked','No-show','Unfinished'].includes(appt.status)) buttons.push({label:appt.rescheduleRequested?'Update reschedule request':'Request new schedule',cls:'btn-ghost',action:()=>requestNewSchedule(appt.id)});
  if (bookingConflict) buttons.push({label:'Contact OSS',cls:'btn-primary',action:()=>navigateVisitor('chat')});
  if (linked) buttons.push({ label: linked.status === 'Completed' ? 'View visit' : 'View live queue', cls: 'btn-primary', action: () => { closeModal(); myActiveQueueId = linked.id; persistSession(); renderQueueTicket(); } });

  const statusLabel = (bookingConflict||appt.needsRescheduling) ? 'Needs rescheduling' : linked ? linked.status : ({Requested:'Awaiting approval',Booked:'Appointment confirmed','Checked-in':'Checked in',Completed:'Visit completed',Cancelled:'Appointment cancelled','No-show':'Appointment missed',Unfinished:'Visit unfinished'}[appt.status] || appt.status);
  const summary = '<section class="visit-status-summary" aria-label="Current appointment status"><span class="visit-status-caption">Current status</span><h4>'+escapeHtml(statusLabel)+'</h4><p><strong>Next step:</strong> '+note+'</p></section>';
  const body = `${summary}${banner}${appt.rescheduleRequested?'<div class="reschedule-pending-note" role="status"><span class="reschedule-note-icon" aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span><div><strong>Schedule change requested</strong><p>'+ (appt.needsRescheduling?'The previous requested slot has been released. Wait for OSS to confirm a new time.':'Waiting for OSS confirmation. Your current appointment stays the same for now.') +'</p></div></div>':''}${appointmentPassHtml(appt)}${appointmentJourneyHtml(appt)}${visitExtrasHtml(appt)}${requirementsBlockHtml(db, appt)}`;
  if (embedded) {
    visitorView = 'checkvisit';
    if (typeof setVisitorHubState === 'function') setVisitorHubState(false);
    renderVisitorSidebar();
    visitStep = 'pass';
    stopTicketPolling();
    persistSession();
    if(typeof myActiveQueueId!=='undefined'){myActiveQueueId=null;persistSession();}
    closeModal(); sessionStorage.setItem('oss_activeAppointmentId', appt.id);
    window.dispatchEvent(new CustomEvent('uniserve:visit-selected'));
    visitorPassActions = [...buttons, {label:'Refresh status',cls:canCheckIn || linked || bookingConflict ? 'btn-ghost' : 'btn-primary',action:refreshAppointmentPass}];
    const primaryAction = visitorPassActions.findIndex(button=>button.cls==='btn-primary');
    const primaryIndex = primaryAction < 0 ? visitorPassActions.length-1 : primaryAction;
    const actionButton = (button,i)=>`<button type="button" class="btn ${button.cls}" onclick="runVisitorPassAction(${i})">${button.label}</button>`;
    const secondaryActions = visitorPassActions.map((button,i)=>i!==primaryIndex&&!button.cls.includes('danger')?actionButton(button,i):'').join('');
    const cancelActions = visitorPassActions.map((button,i)=>button.cls.includes('danger')?actionButton(button,i):'').join('');
    document.getElementById('visitorContent').innerHTML = `<div class="visitor-page-wrap"><div class="card card-pad"><h3>${appt.status === 'Requested' ? 'Awaiting schedule confirmation' : bookingConflict ? 'Needs rescheduling' : 'Your Visit Pass'}</h3><p class="field-hint">Keep your ${appt.visitId ? 'Visit ID' : 'request reference'} to return to this status screen.</p>${body}<div class="appointment-pass-actions"><div class="pass-actions-main">${actionButton(visitorPassActions[primaryIndex],primaryIndex)}</div>${secondaryActions?`<div class="pass-actions-secondary">${secondaryActions}</div>`:''}<div class="pass-actions-footer"><button type="button" class="btn btn-ghost" onclick="if(window.historyVisitOpen){visitorSectionBack();}else{sessionStorage.removeItem('oss_activeAppointmentId');navigateVisitor('checkvisit');}">${window.historyVisitOpen?'Back to records':'Check another Visit ID'}</button>${cancelActions}</div></div></div></div>`;
  } else openModal(`Visit Pass &mdash; ${escapeHtml(appt.visitId || appt.code)}`, body, buttons);
}
const HISTORY_RESEND_COOLDOWN_MS = 60 * 1000;
let historyFlow = null;


function renderHistoryScreen() {
  if(window.visitorHistoryGateEntering&&historyFlow?.step==='verified'){renderHistoryStep();return;}
  if(sessionStorage.getItem('ossuniserve_visitor_token')&&typeof window.openVerifiedVisitorHistory==='function'){window.openVerifiedVisitorHistory();return;}
  historyFlow = { step: 'email', email: '', code: '', expiresAt: 0, sentAt: 0, attempts: 0 };
  renderHistoryStep();
}
function renderHistoryStep() {
  const f=historyFlow,wrap=document.getElementById('visitorContent');
  const stages=`<div class="visitor-history-stages" aria-label="History verification progress">${[['email','Email'],['code','Verify code'],['verified','Your visits']].map(([key,label])=>`<span class="${f.step===key?'current':''}" ${f.step===key?'aria-current="step"':''}>${label}</span>`).join('')}</div>`;
  const head=f.step==='code'?`<div class="modal-head"><h3>Verify your email</h3><button type="button" class="close-x" aria-label="Cancel verification" onclick="changeHistoryEmail()">&times;</button></div>`:`<div class="chat-contact-head"><h3>${f.step==='verified'?'Your visit history':f.step==='code'?'Verify your email':'Find your visit history'}</h3><p>${f.step==='verified'?'Visits associated with '+escapeHtml(f.email):'Verify your email to view your past visits.'}</p></div>${f.step==='verified'?'':stages}`;
  const error='<div class="field-error" id="historyInlineError" role="alert" hidden></div>';
  let body='';
  if(f.step==='email')body=`<div class="field"><label for="hsEmail">Email</label><input id="hsEmail" type="email" autocomplete="email" placeholder="name@gmail.com" value="${escapeHtml(f.email)}" aria-describedby="historyInlineError" onkeydown="if(event.key==='Enter')sendHistoryCode()">${error}</div><button class="btn btn-primary btn-block" onclick="sendHistoryCode()">Send verification code</button><p class="field-hint">Use the email address you provided when starting your visit.</p>`;
  else if(f.step==='code')body=`<div class="modal-body"><div class="history-code-note"><p>A verification code has been requested for ${escapeHtml(f.email)}. Check your inbox or spam folder.</p></div><div class="field history-code-field"><label for="hsCode">Verification code</label><input id="hsCode" class="verification-code-input" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000" aria-describedby="historyInlineError" oninput="clearHistoryCodeError(this)" onkeydown="if(event.key==='Enter')verifyHistoryCode()">${error}</div><div class="history-resend-row"><button class="btn btn-ghost btn-sm resend-text" onclick="resendHistoryCode()">Resend code</button></div></div><div class="modal-foot"><button class="btn btn-ghost" onclick="changeHistoryEmail()">Cancel</button><button id="hsVerifyButton" class="btn btn-primary history-verify-button" onclick="verifyHistoryCode()">Verify</button></div>`;
  else {
    const db=loadDB(),rows=visitorHistoryFor(db,f.email);
    body=rows.length?`<div class="visitor-history-list">${rows.map(r=>{
      const appt=db.appointments.find(a=>(a.visitId||a.requestReference||a.code)===r.ref),queue=db.queues.find(q=>q.visitId===r.ref);
      return `<article class="visitor-history-item"><div class="visitor-history-icon" aria-hidden="true">${icon(appt?'calendar':'ticket',18)}</div><div class="visitor-history-detail"><div class="visitor-history-title"><b>${escapeHtml(r.label)}</b>${statusPill(r.status)}</div><div class="visitor-history-meta"><span>${escapeHtml(String(fmtDateTime(r.when)).replace(/&middot;/g,String.fromCharCode(183)))}</span><span class="visitor-history-ref">${escapeHtml(r.ref)}</span><span>${appt?'Appointment':'Walk-in'}</span></div></div><div class="visitor-history-actions">${appt||queue?`<button class="btn btn-ghost btn-sm" onclick="openHistoryVisit('${escapeHtml(r.ref)}')">View visit</button>`:''}</div></article>`;
    }).join('')}</div>`:'<p class="field-hint">No visits were found for this email yet.</p>';
    body+='<div class="visitor-history-footer"><button class="btn btn-ghost btn-sm" onclick="changeHistoryEmail()">Use a different email</button></div>';
  }
  if(f.step==='email')body=body.replace('<button class="btn btn-primary btn-block" onclick="sendHistoryCode()">',VisitorTurnstile.markup('historySecurity')+'<button class="btn btn-primary btn-block" onclick="sendHistoryCode()">');
  wrap.innerHTML=`<div class="card card-pad visitor-page-wrap history-page${f.step==='code'?' history-code-page':''}">${head}${body}</div>`;
  if(f.step==='email')VisitorTurnstile.mount('historySecurity');
  if(f.step==='code')window.CodeCooldown?.bind(document.querySelector('#visitorContent button[onclick="resendHistoryCode()"]'),'visitor:'+f.email);
  document.getElementById(f.step==='code'?'hsCode':'hsEmail')?.focus();
}

let historyRequestBusy = false;
async function issueHistoryCode() {
  if (historyRequestBusy) return false;
  const remaining=window.CodeCooldown?.remaining('visitor:'+historyFlow.email)||0;
  if(remaining){visitorFormError(`Please wait ${remaining} seconds before requesting a new code.`, 'historyInlineError');return false;}
  historyRequestBusy = true; const f = historyFlow;
  const buttons=Array.from(document.querySelectorAll('#visitorContent button'));
  const labels=buttons.map(button=>button.textContent);buttons.forEach(button=>button.disabled=true);
  if(buttons[0])buttons[0].textContent='Preparing code…';
  try {
    const turnstileToken=await VisitorTurnstile.getToken('historySecurity');
    let result;
    try { result=await UniServeUX.request('/history/code','POST',{email:f.email,turnstileToken}); }
    finally { VisitorTurnstile.reset('historySecurity'); }
    if (historyFlow !== f) return false;
    f.challengeId = result.challengeId; f.expiresAt = Date.now()+result.expiresIn*1000; f.sentAt = Date.now(); f.attempts=0;
    window.CodeCooldown?.start('visitor:'+f.email);
    return true;
  } catch(error) {visitorFormError(escapeHtml(error.message), 'historyInlineError');return false;}
  finally {historyRequestBusy=false;buttons.forEach((button,index)=>{button.disabled=false;button.textContent=labels[index];});}
}
async function sendHistoryCode() {
  if (historyRequestBusy) return;
  const email = normEmail(document.getElementById('hsEmail').value);
  if (!email) { visitorFormError('Enter your email address.', 'historyInlineError'); return; }
  if (!isValidEmail(email)) { visitorFormError('Enter a valid email address (e.g. juan.delacruz@gmail.com).', 'historyInlineError'); return; }
  historyFlow.email = email;
  if (!await issueHistoryCode()) return;
  historyFlow.step = 'code';
  toast(`A verification code has been requested for ${escapeHtml(email)}.`, 'ok');
  renderHistoryStep();
}
async function resendHistoryCode() {
  const f=historyFlow,wait=f.sentAt+HISTORY_RESEND_COOLDOWN_MS-Date.now();
  if(wait>0){visitorFormError(`Please wait ${Math.ceil(wait/1000)} seconds before requesting a new code.`,'historyInlineError');return;}
  openModal('Resend verification code', '<p class="field-hint">Send a new code to '+escapeHtml(f.email)+'.</p>'+VisitorTurnstile.markup('historySecurity'),[
    {label:'Cancel',cls:'btn-ghost',action:closeModal},
    {label:'Send code',cls:'btn-primary',action:async()=>{
      if(historyFlow!==f)return;
      if(!await issueHistoryCode())return;
      closeModal();toast('A new verification code has been requested for '+escapeHtml(f.email)+'.','ok');renderHistoryStep();
    }}
  ]);
  VisitorTurnstile.mount('historySecurity');
}
function clearVisitorIdentity() {
  window.visitorIdentityVersion=(window.visitorIdentityVersion||0)+1;
  visitorNavigationVersion++;
  stopTicketPolling();stopChatPolling();closeModal();
  for(const key of Object.keys(sessionStorage))if(/^(?:ossuniserve_visitor_token|visit-token:|chat-token:|oss_(?:visit|visitor|myActiveQueueId|chat_id|activeAppointmentId|appointment_submission))/.test(key))sessionStorage.removeItem(key);
  sessionStorage.removeItem('ossuniserve_visitor_token');
  if(typeof clearVisitorDraft==='function')clearVisitorDraft();
  window.SecureState?.clear();window.SharedAppointments?.clearPrivateCache?.();
  const db=loadDB();
  for(const key of ['appointments','queues','transactions','visitorLog','chats','activityLog'])db[key]=[];
  saveDB(db);
  myActiveQueueId=null;currentPublicChatId=null;chatFlow=null;historyFlow=null;
  visitStep='pick';visitSelectedService=null;visitVisitorType='Student';visitGuestClass=null;
  scheduleAttachments=[];visitorPassActions=[];feedbackStars=0;window.historyVisitOpen=false;
  window.dispatchEvent(new Event('uniserve:visitor-identity-cleared'));
}
function changeHistoryEmail() {
  if(typeof clearVisitorIdentity==='function')clearVisitorIdentity();
  else sessionStorage.removeItem('ossuniserve_visitor_token');
  historyFlow = { step: 'email', email: '', code: '', expiresAt: 0, sentAt: 0, attempts: 0 };
  renderHistoryStep();
}
async function verifyHistoryCode() {
  if (historyRequestBusy) return;
  const f=historyFlow, entered=(document.getElementById('hsCode').value||'').trim();
  if (!/^\d{6}$/.test(entered)) {visitorFormError('Enter the 6-digit code.', 'historyInlineError');return;}
  historyRequestBusy=true;
  const verifyButton=document.getElementById('hsVerifyButton');
  if(verifyButton){verifyButton.disabled=true;verifyButton.textContent='Verifying…';}
  try {
    const result=await UniServeUX.request('/history/verify','POST',{challengeId:f.challengeId,code:entered});
    if(historyFlow!==f)return;
    if(result.visitorToken) sessionStorage.setItem('ossuniserve_visitor_token',result.visitorToken); if(result.appointments) SharedAppointments.cache({appointments:result.appointments});const db=loadDB();for(const queue of result.queues){db.queues=db.queues.filter(q=>q.id!==queue.id).concat(queue);}saveDB(db);
    f.step='verified';f.code='';renderHistoryStep();
  }catch(error){if(historyFlow===f)visitorFormError(error.message||'Could not verify the code. Please try again.', 'historyInlineError');}
  finally{historyRequestBusy=false;if(verifyButton){verifyButton.disabled=false;verifyButton.textContent='Verify';}}
}

function submitChatFlowText() {
  const raw = (document.getElementById('cfText').value || '').trim();
  if (!raw) { toast('Please type a message.', 'err'); return; }
  chatFlow.message = raw;
  chatFlow.bubbles.push({ sender: 'visitor', text: raw });
  finalizeChatFlow();
}
function renderChatFlowInput(openNow) {
  const isMessage = chatFlow.step === 'message';
  return `<div class="chx-composer-row">
    ${isMessage ? `<label class="chx-attach" for="cfFiles" title="Attach files">${icon('paperclip', 18)}<span class="chx-attach-count" id="cfAttachCount"></span></label>
      <input id="cfFiles" type="file" multiple hidden onchange="var n=this.files.length; var b=document.getElementById('cfAttachCount'); b.textContent=n; b.classList.toggle('on', n>0)">` : ''}
    <textarea id="cfText" rows="1" placeholder="${isMessage ? 'Type your message...' : 'VIS-XXXXXXXX'}" ${openNow ? '' : 'disabled'} ${isMessage ? '' : 'style="text-transform:uppercase"'} onkeydown="if(event.key==='Enter' &amp;&amp; !event.shiftKey){event.preventDefault(); submitChatFlowText();}"></textarea>
    <button class="btn btn-gold chx-send" ${openNow ? '' : 'disabled'} onclick="submitChatFlowText()">${openNow ? 'Send' : 'Closed'}</button></div>`;
}
function chatOfficeHoursHtml() {
  return '<button type="button" class="chat-calendar-button" onclick="UniServeUX.visitorCalendar()" aria-label="View office hours and calendar" title="Office hours and calendar"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-11 4h4"/></svg></button>';
}
function renderChatFlowScreen() {
  const openNow = isOfficeHours();
  document.getElementById('visitorContent').innerHTML = `
    <div class="chx-window chs-start">
      <header class="chx-win-head">
        <div class="chx-win-who"><span class="chx-avatar">${icon('chat', 20)}</span><div><h3>Office of Student Services</h3>
          <div class="chs-sub"><span class="chs-dot ${openNow ? 'open' : 'closed'}"></span>${openNow ? 'Open now' : 'Closed'} · Questions and concerns</div></div></div>
        <div class="chx-win-actions">${chatOfficeHoursHtml()}<button type="button" class="btn btn-ghost btn-sm" onclick="toggleChatResume()">Resume a chat</button></div>
      </header>
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
  if (!chatFlow) initChatFlow(); else if (chatFlow.step === 'identity') renderChatIdentity(); else renderChatFlowScreen();
}
function renderBubbles(c) {
  if (!c.messages.length) return `<div class="muted" style="font-size:.8rem; padding:10px;">No messages yet.</div>`;
  return c.messages.map(m => `<div class="bubble ${m.sender}"><div class="who">${m.sender === 'staff' ? 'OSS Staff' : 'Visitor'}</div><div>${escapeHtml(m.text)}</div>${m.attachments && m.attachments.length ? `<div class="attach-list">${m.attachments.map(attachChip).join('')}</div>` : ''}<div class="ts">${fmtDateTime(m.ts)}</div></div>`).join('');
}
function renderPublicChatThread(c) {
  const db = loadDB(), fresh = db.chats.find(x => x.id === c.id);
  if (fresh) { fresh.visitorUnread = 0; saveDB(db); c = fresh; }
  renderVisitorSidebar();
  const openNow = isOfficeHours();
  document.getElementById('visitorContent').innerHTML = `
    <div class="chx-window" data-chat-status="${c.status}">
      <header class="chx-win-head">
        <div class="chx-win-who"><span class="chx-avatar">${icon('chat', 20)}</span><div><h3>Your conversation</h3><div class="chx-win-code">${escapeHtml(c.email || c.visitorName || '')}</div></div></div>
        <div class="chx-win-actions">${chatOfficeHoursHtml()}${statusPill(c.status)}<button class="btn btn-ghost btn-sm" onclick="currentPublicChatId=null; persistSession(); renderChatScreen(); renderVisitorSidebar();">New conversation</button></div>
      </header>
      <div class="chx-code-bar"><span><b>${escapeHtml(c.visitorName)}</b> &middot; ${escapeHtml(c.email || '')}</span></div>
      <div class="chat-messages chx-msgs" id="chatMsgArea">${renderBubbles(c)}</div>
      ${c.status === 'Open' ? `<div class="chx-composer">${openNow ? '' : officeHoursBannerHtml('chat')}
        <div class="chx-composer-row">
          <label class="chx-attach" for="chReplyFiles" title="Attach files">${icon('paperclip', 18)}<span class="chx-attach-count" id="chAttachCount"></span></label>
          <input id="chReplyFiles" type="file" multiple hidden onchange="var n=this.files.length; var b=document.getElementById('chAttachCount'); b.textContent=n; b.classList.toggle('on', n>0)">
          <textarea id="chReply" rows="1" placeholder="Type a message..." onkeydown="if(event.key==='Enter' &amp;&amp; !event.shiftKey){event.preventDefault(); sendVisitorMessage('${c.id}');}"></textarea>
          <button class="btn btn-gold chx-send" id="chReplyBtn" ${openNow ? '' : 'disabled'} onclick="sendVisitorMessage('${c.id}')">${openNow ? `Send` : 'Closed'}</button>
        </div></div>` : `<p class="chx-closed">This conversation has been closed by OSS staff.</p>`}
    </div>
    <p class="field-hint chx-save-hint">Use your email and its verification code to resume this conversation.</p>`;
  const area = document.getElementById('chatMsgArea');
  if (area) area.scrollTop = area.scrollHeight;
  startChatPolling(c.id);
}
function startChatPolling(chatId) {
  stopChatPolling();
  chatPollTimer = setInterval(() => { if (!window.UniServeRealtime?.connected && visitorView === 'chat' && currentPublicChatId === chatId && isOfficeHours()) refreshChatIfNeeded(chatId); }, 4000);
}
function stopChatPolling() { if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; } }


['input', 'change'].forEach(evt => document.addEventListener(evt, e => {
  const f = e.target.closest && e.target.closest('.field.has-error');
  if (f) f.classList.remove('has-error');
}));

function visitorFormError(message,id) {
  const error=document.getElementById(id||'visitorLookupError');
  if(error){error.textContent=message;error.hidden=false;const field=error.closest('.field');field?.classList.add('has-error');field?.querySelector('input')?.setAttribute('aria-invalid','true');}else toast(escapeHtml(message),'err');
}
function clearHistoryCodeError(input){
  input.value=input.value.replace(/[^0-9]/g,'');input.removeAttribute('aria-invalid');input.closest('.field')?.classList.remove('has-error');
  const error=document.getElementById('historyInlineError');if(error){error.hidden=true;error.textContent='';}
}
function openHistoryVisit(ref) {
  window.historyVisitOpen=true;updateVisitorBackButton();
  const db=loadDB(),queue=db.queues.find(q=>q.visitId===ref),appt=db.appointments.find(a=>(a.visitId||a.requestReference||a.code)===ref);
  if(queue){myActiveQueueId=queue.id;visitorView='checkvisit';persistSession();renderVisitorSidebar();renderQueueTicket();}
  else if(appt)showPassModalReadonly(appt,true);
}

const initialVisitorParams = new URLSearchParams(location.search);
const initialServiceKey = initialVisitorParams.get('service');
const initialService = initialServiceKey ? findService(loadDB(), initialServiceKey) : null;
const initialVisitorFlow = initialVisitorParams.get('flow');
if (initialService) {
  visitSelectedService = initialService;
  visitStep = 'choose';
  myActiveQueueId = null;
  scheduleAttachments = [];
  sessionStorage.removeItem('oss_activeAppointmentId');
  persistSession();
  navigateVisitor('visit');
} else if (initialVisitorFlow && Object.prototype.hasOwnProperty.call(VISITOR_TITLES, initialVisitorFlow)) {
  navigateVisitor(initialVisitorFlow);
} else {
  showVisitorHub();
}

window.addEventListener('office-calendar-change', () => { renderHubOfficeNotice(); if (!isOfficeHours()) renderClosedScreen(); else checkPortalHours(); });

function disabilityPriorityHtml(prefix) { return '<div class="field disability-priority"><label for="'+prefix+'PWD"><input type="checkbox" id="'+prefix+'PWD"> Person with disability (PWD)</label><div class="field-hint">Priority service for students and guests with disabilities.</div></div>'; }
