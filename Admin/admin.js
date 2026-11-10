let reportOutputActive = false;
let reportOutputBusy = false;
async function authorizedReportOutput(options, render) {
  if (reportOutputBusy) { toast('A report is already being prepared.', 'info'); return; }
  reportOutputBusy = true;
  try {
    const snapshot = await SharedAppointments.request('/report-data', 'POST', options);
    const originalLoad = loadDB, originalSave = saveDB;
    reviveDates(snapshot);
    const base = originalLoad();
    const data = {...base};
    for (const key of ['transactions','appointments','queues','visitorLog']) if (Array.isArray(snapshot[key])) data[key] = snapshot[key];
    loadDB = () => data; saveDB = () => {}; reportOutputActive = true;
    try { render(); } finally { loadDB = originalLoad; saveDB = originalSave; reportOutputActive = false; if(document.getElementById('reportSheet')) buildReport(); }
  } catch(error) { toast(error.message || 'Could not authorize report output. Please try again.', 'err'); } finally { reportOutputBusy = false; }
}
function averageReportMetric(rows, key) {
  const values = rows.map(row => row[key]).filter(value => typeof value === 'number' && Number.isFinite(value) && value >= 0);
  return values.length ? values.reduce((sum,value) => sum + value, 0) / values.length : null;
}
const DB_KEY = 'ossuniserve_db_v1';
// Use shared controls before page initialization.
UniServeUX.install();
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
const QUEUE_STATUS_LABEL = { Waiting: 'Waiting', Called: 'Called', Serving: 'Serving', Completed: 'Completed', Unfinished: 'Unfinished', Skipped: 'Skipped', Cancelled: 'Cancelled' };

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
    if (a.shared || a.queueId || a.status !== 'Booked') return;
    if (typeof UniServeUX !== 'undefined' && UniServeUX.conflict(a)) return;
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
 if(m==null)return '&mdash;';
 const seconds=Math.max(0,Math.round(Number(m)*60));
 const h=Math.floor(seconds/3600),n=Math.floor(seconds%3600/60),sec=seconds%60;
 return [h?h+' '+'hrs':'',n?n+' '+'mins':'',sec?sec+' '+'secs':''].filter(Boolean).join(' ')||'0 secs';
}
function fmtCompactMinutes(m) {
  if(m==null||!Number.isFinite(Number(m)))return '&mdash;';
  const total=Math.max(0,Math.round(Number(m))),h=Math.floor(total/60),mins=total%60;
  return h?`${h}h${mins?` ${mins}m`:''}`:`${total}m`;
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
  return ['appointments', 'queues', 'transactions', 'visitorLog', 'chats'].some(k => (db[k] || []).some(x => String(x.visitId || '').replace(/-/g, '') === String(id).replace(/-/g, '')));
}
function nextVisitId(db) {
  let id;
  do { const s = randomVisitSuffix(8); id = `VIS-${s}`; } while (visitIdExists(db, id));
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
      { id: 'u1', username: 'admin', fullName: 'System Administrator', role: 'SUPER_ADMIN', active: true, email: 'sysadmin@oss.edu.ph', confidentialAccess: false },
    ],
    services: DEFAULT_SERVICES.map(s => ({ ...s, requirements: [...s.requirements] })),
    transactions: [], appointments: [], chats: [],
    activityLog: [], queues: [], queueCounters: {}, visitorLog: [], visitCounter: 0,
    systemSettings: { orgName: 'Office of Student Services', supportEmail: 'oss@university.edu.ph', supportPhone: '0917-000-0000', timezone: 'Asia/Manila', maintenanceMode: false, autoCloseChats: false, sessionTimeout: 30, queuePrefixStudent: 'A', queuePrefixGuest: 'G', gracePeriodMinutes: DEFAULT_GRACE_MINUTES, noShowThresholdMinutes: DEFAULT_NOSHOW_MINUTES },
  };
}
function mkLog(user, role, action, ts) { return { id: uid('L'), user, role, action, ts: ts || new Date() }; }
function mkChat(o) { return { id: uid('C'), status: 'Open', messages: [], staffUnread: 0, visitorUnread: 0, createdAt: new Date(), updatedAt: new Date(), ...o }; }
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
const sharedQueueSnapshot = new Map();
let sharedQueueWrites = Promise.resolve();
function saveDB(s) {
  localStorage.setItem(DB_KEY, JSON.stringify(s));
  for (const q of s.queues || []) {
    // Previous-day closure is server-owned; cached unfinished records are read-only here.
    if (!q.shared || q.status === 'Unfinished') continue;
    const snapshot = JSON.stringify(q);
    if (!sharedQueueSnapshot.has(q.id) || sharedQueueSnapshot.get(q.id) === snapshot) continue;
    const previous=JSON.parse(sharedQueueSnapshot.get(q.id));
    const writable=['status','serviceKey','serviceLabel','calledAt','servingAt','completedAt','recalledAt','transferredAt','recallCount','closureReason'];
    // Redaction, permission flags and cache metadata are not queue mutations.
    if(!writable.some(key=>Object.prototype.hasOwnProperty.call(q,key)&&JSON.stringify(q[key])!==JSON.stringify(previous[key])))continue;
    sharedQueueSnapshot.set(q.id, snapshot);
    const changes=Object.fromEntries(writable.filter(key=>Object.prototype.hasOwnProperty.call(q,key)).map(key=>[key,q[key]]));
    sharedQueueWrites = sharedQueueWrites.then(async () => {
      const response = await fetch((globalThis.UniServeConfig?.apiBase||'http://127.0.0.1:8000/api')+'/queue/' + encodeURIComponent(q.id), {
        method: 'PATCH', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: 'Bearer ' + (loadSession().token || '') },
        body: JSON.stringify(changes)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Could not update the shared queue.');
    }).catch(error => { toast(escapeHtml(error.message || 'Cannot reach the queue service.'), 'err'); });
  }
}
let sharedQueueLoading = false;
async function loadSharedQueue() {
  const snapshotsAtStart = new Map(sharedQueueSnapshot);
  const response = await fetch((globalThis.UniServeConfig?.apiBase||'http://127.0.0.1:8000/api')+'/queue', { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json', Authorization: 'Bearer ' + (loadSession().token || '') } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || 'Could not load the queue.');
  const db = loadDB();
  // A read started before a confirmed action must not restore its older status.
  result.queues = result.queues.map(q => {
    if (sharedQueueSnapshot.get(q.id) !== snapshotsAtStart.get(q.id)) {
      return db.queues.find(cached => cached.id === q.id) || q;
    }
    return q;
  });
  db.queues = db.queues.filter(q => !q.shared && !result.queues.some(server => server.id === q.id || (server.visitId && server.visitId === q.visitId))).concat(result.queues);
  for (const q of result.queues) sharedQueueSnapshot.set(q.id, JSON.stringify(q));
  if(window.SecureState)SecureState.persist(db);else localStorage.setItem(DB_KEY,JSON.stringify(db));
}
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
function findService(db, key) { return db.services.find(x => x.key === key) || db.services.find(x => x.label === key); }
function serviceLabel(db, key) { const s = db.services.find(x => x.key === key); return s ? s.label : key; }
function serviceQueueLabel(db, e) { return e.serviceLabel || (e.serviceKey ? serviceLabel(db, e.serviceKey) : 'General Concern'); }
function entryMethodLabel(q) { return q.source === 'Appointment' ? 'Scheduled' : (q.source || 'Walk-in'); }
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
    serving: list.filter(q => q.status === 'Serving').length,
    called: list.filter(q => q.status === 'Called').length,
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
  const required=svc?.requirements?.length||0, files=attachments||[];
  const accepted=files.filter(file=>file.review?.status==='Accepted').length;
  if(files.some(file=>file.review?.status==='Needs correction'))return {status:'INCOMPLETE',label:'Needs correction'};
  if(!required&&!files.length)return {status:'READY',label:'No uploads required'};
  if(files.length<required)return {status:'INCOMPLETE',label:`Incomplete — ${files.length} of ${required} requirements uploaded`};
  if(files.some(file=>file.review?.status!=='Accepted'))return {status:'FOR_REVIEW',label:'Pending review'};
  return {status:'READY',label:`Accepted — ${accepted} ${accepted===1?'file':'files'}`};
}
function readinessPillHtml(r, short) {
  if (!r) return '';
  const status = r.status || r;
  const label = short ? (status === 'READY' ? 'Ready' : status === 'FOR_REVIEW' ? 'For review' : 'Incomplete') : (r.label || r);
  const cls = status === 'READY' ? 'ready' : (status === 'FOR_REVIEW' ? 'review' : 'incomplete');
  return `<span class="readiness-pill ${cls}">${cls === 'incomplete' ? '' : icon(status === 'READY' ? 'check' : 'alert', 12) + ' '}${escapeHtml(label)}</span>`;
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
  return `<div class="divider"></div><h5 class="record-subheading">Visit timeline</h5>` +
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

function readFileAsDataURL(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res({ name: file.name, size: file.size, type: file.type, dataUrl: r.result }); r.onerror = rej; r.readAsDataURL(file); }); }
async function readFilesAsAttachments(list) { return Promise.all(Array.from(list || []).map(readFileAsDataURL)); }
function attachChip(a) { return `<a class="attach-chip" href="${a.dataUrl}" download="${escapeHtml(a.name)}" target="_blank" rel="noopener noreferrer">${icon('paperclip', 13)}<span class="fname">${escapeHtml(a.name)}</span><span class="fsize">${fmtFileSize(a.size)}</span></a>`; }
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
  const gradientId = `trend-fill-${svgLineChart.gradientSequence = (svgLineChart.gradientSequence || 0) + 1}`;
  const w = 1200, h = 220, padL = 42, padR = 24, padT = 20, padB = 34, innerW = w - padL - padR, innerH = h - padT - padB;
  const max = Math.max(1, ...values), stepX = values.length > 1 ? innerW / (values.length - 1) : 0;
  const pts = values.map((v, i) => ({ x: padL + (values.length > 1 ? i * stepX : innerW / 2), y: padT + innerH - (v / max) * innerH, v }));
  const line = pts.map((p, i) => {
    if (!i) return `M${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    const previous = pts[i - 1], middle = (previous.x + p.x) / 2;
    return `C${middle.toFixed(1)},${previous.y.toFixed(1)} ${middle.toFixed(1)},${p.y.toFixed(1)} ${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(' ');
  const area = pts.length > 1 ? `${line} L${pts[pts.length - 1].x.toFixed(1)},${(padT + innerH).toFixed(1)} L${pts[0].x.toFixed(1)},${(padT + innerH).toFixed(1)} Z` : '';
  const tickCount = Math.min(5, max) + 1;
  const grid = Array.from({length:tickCount},(_,i)=>i/(tickCount-1)).map(f => { const y = padT + innerH - f * innerH; return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${w - padR}" y2="${y.toFixed(1)}" stroke="var(--text)" stroke-opacity="0.05"/><text x="${padL - 8}" y="${(y + 3).toFixed(1)}" font-size="10" text-anchor="end" fill="var(--text)">${Math.round(max * f)}</text>`; }).join('');
  const xl = pts.map((p, i) => `<text x="${p.x.toFixed(1)}" y="${h - 10}" font-size="10" text-anchor="middle" fill="var(--text)">${escapeHtml(labels[i])}</text>`).join('');
  const dots = pts.map(p => `<g class="cl-point-group"><circle class="cl-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" stroke-width="2"/><text class="cl-val-label" x="${p.x.toFixed(1)}" y="${(p.y - 9).toFixed(1)}" font-size="10" text-anchor="middle" fill="var(--text)">${p.v}</text></g>`).join('');
  const total = values.reduce((sum, value) => sum + value, 0);
  const average = values.length ? (total / values.length).toFixed(1) : '0';
  const peak = values.length ? Math.max(...values) : 0;
  return `<div class="trend-summary"><span>Total <strong>${total}</strong></span><span>Daily average <strong>${average}</strong></span><span>Busiest day <strong>${peak} transactions</strong></span></div><div class="trend-chart-scroll"><svg viewBox="0 0 ${w} ${h}" style="width:100%; height:auto; max-height:240px;" role="img" aria-label="Transaction trend chart"><defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="var(--trend-color, #800000)" stop-opacity="0.16"/><stop offset="100%" stop-color="var(--trend-color, #800000)" stop-opacity="0.015"/></linearGradient></defs>${grid}${area ? `<path class="cl-area" style="--trend-fill:url(#${gradientId})" d="${area}" stroke="none"/>` : ''}<path class="cl-line" pathLength="1000" d="${line}" fill="none" stroke-width="2.5"/>${dots}${xl}</svg></div>`;
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
    absent: 'M15 21v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M13 7a4 4 0 11-8 0 4 4 0 018 0M17 8l5 5M22 8l-5 5',
    lock: 'M5 11h14v9H5v-9zM8 11V7a4 4 0 118 0v4',
    search: 'M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35',
    plus: 'M12 5v14M5 12h14',
    print: 'M6 9V2h12v7M6 18H4a1 1 0 01-1-1v-6a1 1 0 011-1h16a1 1 0 011 1v6a1 1 0 01-1 1h-2M6 14h12v8H6v-8z',
    edit: 'M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z',
    trash: 'M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m2 0v14a1 1 0 01-1 1H7a1 1 0 01-1-1V6h12z',
    idcard: 'M3 5h18v14H3V5zm4 4h.01M7 15h6M14 9h6M14 12h6',
    x: 'M18 6L6 18M6 6l12 12',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2',
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
  openModal('Log Out?', '<p class="logout-confirm-copy">Are you sure you want to log out?</p>', [
    { label: 'Cancel', cls: 'btn-ghost', action: closeModal },
    { label: 'Log Out', cls: 'btn-primary', action: () => {
      const db = loadDB();
      logActivity(db, currentUser, 'Logged out');
      saveDB(db);
      closeModal();
      endSession();
    } }
  ]);
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
  { key: 'calendar', label: 'Office Availability', ic: 'calendar' },
  { key: 'logbook', label: 'Visitor Log', ic: 'log' },
  { key: 'messages', label: 'Messages', ic: 'chat' },
  { key: 'transactions', label: 'Transactions', ic: 'folder' },
  { key: 'feedback', label: 'Feedback', ic: 'star' },
  { key: 'services', label: 'Manage Services', ic: 'plus' },
  { key: 'reports', label: 'Reports', ic: 'chart' },
  { key: 'profile', label: 'My Profile', ic: 'userc' },
];
const TITLES = {
  notifications: ['Notifications', 'Appointment requests, earlier openings and follow-up tasks'],
  calendar: ['Office Availability', 'Office hours, lunch breaks, holidays and closures'],
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
document.getElementById('userRoleLbl').textContent = currentUser.confidentialApprover ? "Head Admin" : ROLES[currentUser.role].label;
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
  const db = loadDB();
  const requests = db.transactions.filter(t => t.status === 'Pending' || (t.caseStatus && t.caseStatus !== 'Resolved')).length;
  const appointments = db.appointments.filter(a => a.status === 'Requested' || a.rescheduleRequested || a.calendarReview).length;
  const groups = [
    { label: 'Overview', keys: ['dashboard'] },
    { label: 'Visits & scheduling', keys: ['queue', 'appointments', 'calendar', 'logbook'] },
    { label: 'Student services', keys: ['transactions', 'messages', 'feedback'] },
    { label: 'Management', keys: ['services', 'reports'] },
    { label: 'Account', keys: ['profile'] }
  ];
  document.getElementById('navList').innerHTML = groups.map(group => {
    const items = group.keys.map(key => NAV.find(n => n.key === key)).filter(n => n && (n.key !== 'services' || currentUser.confidentialApprover));
    if (!items.length) return '';
    return `<li class="nav-category" role="presentation">${group.label}</li>` + items.map(n => {
    const badge = n.key === 'messages' ? totalStaffUnread() : n.key === 'transactions' ? requests : n.key === 'appointments' ? appointments : 0;
    return `<li><button class="nav-item ${state_view === n.key ? 'active' : ''}" title="${n.label}" onclick="navigate('${n.key}')">${icon(n.ic)}<span>${n.label}</span>${badge ? `<span class="nav-badge">${badge}</span>` : ''}</button></li>`;
    }).join('');
  }).join('')+'<li id="sidebarNotifications" class="sidebar-notifications"></li>';
  const cases=db.transactions.filter(t=>t.caseStatus&&t.caseStatus!=='Resolved').length;
  if(document.getElementById('sidebarNotifications'))workloadSummaryHtml(db,`<section class="dashboard-attention"><div class="dashboard-attention-heading"><span class="dashboard-attention-icon" aria-hidden="true">${icon('clock',20)}</span><div><h3>Appointment requests and cases</h3><p>Review items waiting for your next step.</p></div></div><div class="dashboard-attention-actions"><button type="button" class="btn btn-ghost btn-sm" onclick="navigate('appointments')">Appointment requests <span class="dashboard-attention-count">${appointments}</span></button><button type="button" class="btn btn-ghost btn-sm" onclick="navigate('transactions')">Case follow-ups <span class="dashboard-attention-count">${cases}</span></button></div></section>`);
}
const staffViewMemory={};
function rememberStaffView() {
  const fields={};
  document.querySelectorAll('#content input[id], #content select[id]').forEach(input=>{ if(input.type!=='password'&&input.type!=='file')fields[input.id]=input.value; });
  staffViewMemory[state_view]={fields,apptFilter,txnFilter,txnServiceFilter};
}
function organizeStaffToolbar(searchId) {
  const input=document.getElementById(searchId),card=input?.closest('.card');
  if(!card)return;
  const bar=card.querySelector('.filter-bar');
  if(bar)bar.classList.add('staff-table-toolbar');
}
function restoreStaffView(key) {
  const saved=staffViewMemory[key];if(!saved)return;
  Object.entries(saved.fields).forEach(([id,value])=>{const field=document.getElementById(id);if(field)field.value=value;});
  if(key==='appointments'){renderApptTable();renderTodayArrivals();}
  if(key==='logbook')renderLogbookTable();
  if(key==='transactions')renderTxnTable();
}
function navigate(key) {
  rememberStaffView();
  if (!TITLES[key] || (key === 'services' && !currentUser.confidentialApprover)) key = 'dashboard';
  if (key !== 'queue') stopAdminQueuePolling();
  if (key !== 'messages') { stopMessagesPolling(); activeStaffChatId = null; }
  state_view = key; txnServiceFilter = staffViewMemory[key]?.txnServiceFilter;
  document.getElementById('pageTitle').textContent = TITLES[key][0];
  document.getElementById('pageSub').innerHTML = TITLES[key][1];
  renderSidebar();
  document.getElementById('sidebar').classList.remove('open');
  ({ notifications: renderNotifications, calendar: renderCalendar, dashboard: renderDashboard, queue: renderQueueDashboard, appointments: renderAppointments, logbook: renderVisitorLogbook, messages: renderMessages, transactions: renderTransactions, feedback: renderFeedback, services: renderServicesManage, reports: renderReports, profile: renderProfile })[key]();
  restoreStaffView(key);
}
let notificationStatusFilter='all';
let notificationCategoryFilter='all';
function notificationPreferences() {
  try { return JSON.parse(localStorage.getItem('uniserve-notifications:'+currentUser.id)||'{}')||{}; } catch (_) { return {}; }
}
function notificationPreferenceKey(n) {
  return JSON.stringify([n.kind,n.category,String(n.id),n.title]);
}
function notificationPreference(n,preferences) {
  const preference=preferences[notificationPreferenceKey(n)]||{};
  if(n.kind!=='important'||typeof preference.read==='boolean')return preference;
  try {
    const seen=JSON.parse(sessionStorage.getItem('important-seen:'+currentUser.id)||'[]');
    return {...preference,read:Array.isArray(seen)&&seen.includes(n.id)};
  } catch (_) { return preference; }
}
function markImportantNotificationRead(item) {
  const preferences=notificationPreferences();
  const key=notificationPreferenceKey({kind:'important',category:item.kind==='case'?'followups':'requests',id:item.id,title:item.title});
  preferences[key]={...preferences[key],read:true};
  localStorage.setItem('uniserve-notifications:'+currentUser.id,JSON.stringify(preferences));
  if(typeof refreshSidebarNotificationCount==='function')refreshSidebarNotificationCount();
  if(state_view==='notifications')renderNotifications();
}
function changeNotificationState(button,action) {
  const row=button.closest('.notification-entry'), preferences=notificationPreferences();
  const entry=preferences[row.dataset.key]||{};
  if(action==='read'||action==='unread')entry.read=action==='read';
  if(action==='archive'||action==='restore')entry.archived=action==='archive';
  preferences[row.dataset.key]=entry;
  localStorage.setItem('uniserve-notifications:'+currentUser.id,JSON.stringify(preferences));
  renderNotifications();
}
function markNotificationOpened(button) {
  changeNotificationState(button,'read');
}
function notificationMatchesStatus(pref) {
  if(notificationStatusFilter==='archived')return !!pref.archived;
  return !pref.archived&&(notificationStatusFilter==='all'||(notificationStatusFilter==='read'?!!pref.read:!pref.read));
}
function filterNotificationStatus(value) { notificationStatusFilter=value; renderNotifications(); }
function staffNotificationItems(db=loadDB()) {
  const appointments=(db.appointments||[]).filter(a=>!a.restricted);
  const todayDate=OfficeCalendar.parts().date;
  const notifications=[];
  (window.importantNotifications||[]).forEach(n=>notifications.push({category:n.kind==='case'?'followups':'requests',title:n.title,detail:n.detail,id:n.id,action:'View update',kind:'important'}));
  (window.approvedAccessNotifications||[]).forEach(r=>notifications.push({category:'requests',title:'Access request approved',detail:r.code+' ? '+(r.scope==='print'?'View and Print':'View'),id:r.id,action:'Open record',kind:'approval'}));
  if(currentUser?.confidentialApprover)(window.headAccessRequestNotifications||[]).forEach(r=>notifications.push({category:'requests',title:'Confidential access requested',detail:r.requester_name+' · '+r.code+' · '+(r.scope==='print'?'View and Print':'View'),id:r.id,action:'Review request',kind:'access'}));
  appointments.forEach(a=>{
    const reference=a.visitId||a.requestReference||a.code||'Appointment';
    const detail=[reference,a.service].filter(Boolean).join(' ? ');
    if(a.status==='Requested'||a.rescheduleRequested||a.calendarReview)notifications.push({category:'requests',title:a.calendarReview?'Appointment needs rescheduling':a.rescheduleRequested?'Schedule change requested':'Appointment awaiting review',detail,id:a.id,action:'Review',kind:'appointment'});
    if(['Requested','Booked'].includes(a.status)&&a.earlierSlotOptIn)notifications.push({category:'waitlist',title:'Earlier appointment requested',detail,id:a.id,action:'Review schedule',kind:'appointment'});
    if(a.status!=='Cancelled')(a.followUpTasks||(a.followUpTask?[a.followUpTask]:[])).filter(t=>!t.completed&&t.dueDate<todayDate).forEach(t=>notifications.push({category:'followups',title:'Follow-up overdue',detail:detail+' · Due '+t.dueDate+(t.ownerName?' · '+t.ownerName:''),id:a.id,action:'View task',kind:'appointment'}));
  });
  (db.transactions||[]).filter(t=>t.caseStatus&&t.caseStatus!=='Resolved').forEach(t=>notifications.push({category:'followups',title:'Case needs follow-up',detail:[t.code||t.id,t.caseStatus].filter(Boolean).join(' ? '),id:t.id,action:'View case',kind:'case'}));
  return notifications;
}
function refreshSidebarNotificationCount() {
  const preferences=notificationPreferences();
  const count=staffNotificationItems().filter(n=>{const p=notificationPreference(n,preferences);return !p.archived&&!p.read;}).length;
  const badge=document.querySelector('#sidebarNotifications .notification-bell-count');
  if(badge){badge.textContent=String(count);badge.hidden=count===0;}
  const inbox=document.querySelector('.staff-notification-button');
  const headerBadge=inbox?.querySelector?.('.staff-notification-count');
  if(headerBadge){headerBadge.textContent=count>99?'99+':String(count);headerBadge.hidden=count===0;}
  inbox?.setAttribute?.('aria-label',count?'Notifications, '+count+' unread':'Notifications, no unread updates');
}
function renderNotifications() {
  const db=loadDB();
  const content=document.getElementById('content');
  const tabs=[['all','All'],['requests','Requests'],['waitlist','Waitlist'],['followups','Follow-ups']];
  content.innerHTML='<section class="notifications-page" aria-label="Notifications"><div class="notification-tabs" role="tablist" aria-label="Notification categories">'+tabs.map(([key,label],i)=>'<button type="button" class="notification-tab" id="notification-tab-'+key+'" role="tab" aria-selected="'+(i===0)+'" tabindex="'+(i===0?0:-1)+'" aria-controls="notificationTabPanel" data-category="'+key+'" onclick="selectNotificationTab(this)" onkeydown="notificationTabKeydown(event,this)">'+label+'</button>').join('')+'</div><div class="notifications-page-feed" id="notificationTabPanel" role="tabpanel" aria-labelledby="notification-tab-all"></div></section>';
  const notifications=staffNotificationItems(db);
  refreshSidebarNotificationCount();
  const categoryLabels={requests:'Request',waitlist:'Earlier appointment',followups:'Follow-up'};
  const categoryIcons={requests:'calendar',waitlist:'clock',followups:'ticket'};
  const preferences=notificationPreferences();
  const rows=notifications.map(n=>{
    const key=notificationPreferenceKey(n),pref=notificationPreference(n,preferences);
    const action=n.kind==='important'?'openImportantNotification(this.dataset.id)':n.kind==='approval'?'openApprovedAccessRequest(this.dataset.id)':n.kind==='access'?'openHeadAccessRequest(this.dataset.id)':n.kind==='case'?'openTxnDetail(this.dataset.id)':'openApptDetail(this.dataset.id,true)';
    return '<article class="notification-entry" data-key="'+escapeHtml(key)+'" data-read="'+!!pref.read+'" data-archived="'+!!pref.archived+'" data-category="'+n.category+'"><div class="notification-entry-copy"><small class="notification-entry-label">'+categoryLabels[n.category]+' &middot; '+(pref.read?'Read':'Unread')+'</small><p>'+escapeHtml(n.title)+'</p><span>'+escapeHtml(n.detail.replace(/ \? /g,' ? '))+'</span></div><div class="notification-entry-controls"><button type="button" class="notification-entry-action" data-id="'+escapeHtml(String(n.id))+'" onclick="markNotificationOpened(this);'+action+'">'+n.action+'</button><div class="notification-state-actions"><button type="button" data-action="'+(pref.read?'unread':'read')+'" onclick="changeNotificationState(this,this.dataset.action)">Mark as '+(pref.read?'unread':'read')+'</button><button type="button" data-action="'+(pref.archived?'restore':'archive')+'" onclick="changeNotificationState(this,this.dataset.action)">'+(pref.archived?'Restore':'Archive')+'</button></div></div></article>';
  }).join('');
  content.querySelector('.notifications-page-feed').innerHTML='<div class="dashboard-notifications-items">'+rows+'</div><p class="notification-empty"'+(notifications.length?' hidden':'')+'>No notifications.</p>';
  content.querySelector('.notification-tabs').insertAdjacentHTML('beforebegin','<div class="notification-status-filter"><label for="notificationStatus">Show</label><select id="notificationStatus" onchange="filterNotificationStatus(this.value)"><option value="all">All active</option><option value="unread">Unread</option><option value="read">Read</option><option value="archived">Archived</option></select></div>');
  content.querySelector('#notificationStatus').value=notificationStatusFilter;
  content.querySelectorAll('.notification-tab').forEach(tab=>{
    const count=notifications.filter(n=>notificationMatchesStatus(notificationPreference(n,preferences))&&(tab.dataset.category==='all'||n.category===tab.dataset.category)).length;
    tab.innerHTML+=' <span class="notification-tab-count">'+count+'</span>';
  });
  content.querySelector('.notification-empty').textContent=notificationStatusFilter==='unread'?'No unread notifications in this category.':notificationStatusFilter==='archived'?'No archived notifications in this category.':notificationStatusFilter==='read'?'No read notifications in this category.':'No active notifications in this category.';

  selectNotificationTab(content.querySelector('[data-category="'+notificationCategoryFilter+'"].notification-tab')||content.querySelector('.notification-tab'));
}
function selectNotificationTab(button) {
  notificationCategoryFilter=button.dataset.category;
  const page=button.closest('.notifications-page');
  page.querySelectorAll('[role="tab"]').forEach(tab=>{
    const selected=tab===button;
    tab.setAttribute('aria-selected',String(selected));
    tab.tabIndex=selected?0:-1;
  });
  page.querySelector('[role="tabpanel"]').setAttribute('aria-labelledby',button.id);
  page.querySelectorAll('.dashboard-notifications-items > [data-category]').forEach(item=>{
    item.hidden=!notificationMatchesStatus({read:item.dataset.read==='true',archived:item.dataset.archived==='true'})||(button.dataset.category!=='all'&&item.dataset.category!==button.dataset.category);
  });
  const empty=page.querySelector('.notification-empty');
  if(empty)empty.hidden=Array.from(page.querySelectorAll('.notification-entry')).some(item=>!item.hidden);
}
function notificationTabKeydown(event,button) {
  const tabs=Array.from(button.parentElement.querySelectorAll('[role="tab"]'));
  const index=tabs.indexOf(button);
  const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null;
  if(next===null)return;
  event.preventDefault();
  tabs[next].focus();
  selectNotificationTab(tabs[next]);
}
function queueStatusPill(status) { return statusPill(QUEUE_STATUS_LABEL[status] || status); }
function dueTagHtml(q) { return q.source === 'Appointment' && !isDue(q) ? `<span class="pill pill-info">Due ${fmtTime(q.scheduledAt)}</span>` : ''; }

function renderDashboard() {
  const db = loadDB();
  if (sweepNoShows(db)) saveDB(db);
  const t = today(), qs = queueStats(db), fs = feedbackStats(db);
  const pending = db.transactions.filter(x => x.status === 'Pending').length;
  const escalations = db.transactions.filter(x => ['Escalated', 'For Review'].includes(x.escalation)).length;
  const start = new Date(); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - 13);
  const end = new Date();
  const txns = db.transactions.filter(x => new Date(x.createdAt) >= start && new Date(x.createdAt) <= end);
  const dates = Array.from({ length: 14 }, (_, i) => { const d = new Date(start); d.setDate(d.getDate() + i); return fmtDate(d); });
  const trend = { labels: dates.map(d => d.slice(5)), values: dates.map(d => txns.filter(x => fmtDate(x.createdAt) === d).length) };
  const services = db.services.map(s => ({ label: s.label, count: txns.filter(x => x.service === s.key).length })).filter(s => s.count).sort((a, b) => b.count - a.count).slice(0, 5);
  const statuses = ['Completed', 'Approved', 'Processing', 'Pending', 'Rejected'].map(label => ({ label, count: txns.filter(x => x.status === label).length }));
  const queue = [{ label: 'Waiting', count: qs.waiting }, { label: 'Serving / called', count: qs.serving }, { label: 'Completed', count: qs.completedToday }, ...['Skipped', 'Unfinished', 'Cancelled'].map(label => ({ label, count: db.queues.filter(q => fmtDate(q.createdAt) === t && q.status === label).length }))];
  const metricIcons = ['calendar','clock','check','clock']; let metricIndex = 0;
  const metric = (label, value, note) => '<div class="stat-card"><span class="metric-icon" aria-hidden="true">' + icon(metricIcons[metricIndex++],16) + '</span><div class="lbl">' + label + '</div><div class="val">' + value + '</div><div class="metric-note">' + note + '</div></div>';
  const card = (title, desc, body, footer = '') => '<div class="card"><div class="card-head"><div><h3>' + title + '</h3><div class="desc">' + desc + '</div></div></div><div class="card-pad">' + body + '</div>' + (footer ? '<div class="analytics-footer">' + footer + '</div>' : '') + '</div>';
  document.getElementById('content').innerHTML = '<div class="analytics-dashboard staff-overview">' +
    '<div class="analytics-heading"><div><h2>Service overview</h2><p>Today at OSS and recent service activity.</p></div></div>' +
    '<section class="dash-section" aria-label="Key metrics"><div class="stat-grid analytics-metrics">' +
    metric("Today's transactions", db.transactions.filter(x => fmtDate(x.createdAt) === t).length, 'Logged today') +
    metric('Pending transactions', pending, 'All dates &middot; awaiting processing') +
    metric('Completed visits today', qs.completedToday, 'Finished at the counter') +
    metric('Average wait today', qs.avgWaitMin == null ? '&mdash;' : qs.avgWaitMin + '<span class="metric-unit"> min</span>', 'Completed visits today') + '</div></section>' +
    '<section class="dash-section" aria-labelledby="dailyWorkHeading"><h3 class="overview-section-title" id="dailyWorkHeading">Today at OSS</h3><div class="dashboard-today-grid">' +
    card("Today's queue", 'Visits registered today', queue.some(r => r.count) ? dashboardChart(queue, 'donut', 'Today queue status') : emptyChart('No queue activity today.'), '<span>' + escalations + ' open escalations</span><button type="button" class="analytics-link" onclick="navigate(&quot;queue&quot;)">Open queue</button>') +
    dashboardScheduledVisitors(db) + '</div></section>' +
    '<section class="dash-section dashboard-trend-section" aria-label="Transaction analytics"><h3 class="overview-section-title">Recent transaction activity</h3><div class="analytics-primary">' +
    card('Transaction activity', 'Daily volume &middot; Last 14 days, including today', txns.length ? svgLineChart(trend, 'Daily transactions over the last 14 days') : emptyChart('No transactions in the last 14 days.')) +
    '</div></section><section class="dash-section" aria-labelledby="serviceInsightsHeading"><h3 class="overview-section-title" id="serviceInsightsHeading">Service insights</h3><div class="analytics-chart-grid dashboard-summary-grid">' +
    card('Most requested services', 'Top 5 &middot; Last 14 days', services.length ? dashboardBarChart(services) : emptyChart('No service requests in this period.')) +
    card('Transaction status', 'Transactions logged in the last 14 days', txns.length ? dashboardChart(statuses, 'donut', 'Transaction status') : emptyChart('No transactions in this period.')) +

    card('Visitor satisfaction', 'All feedback &middot; ' + fs.n + ' responses', '<div class="satisfaction-score">' + (fs.satPct == null ? '&mdash;' : fs.satPct + '<span>%</span>') + '</div><p class="metric-note">Rated 4 or 5 stars</p>' + (fs.n ? dashboardBarChart(fs.dist) : emptyChart('No feedback received yet.')), 'Average rating: ' + (fs.avg == null ? '&mdash;' : fs.avg.toFixed(1) + ' / 5') + ' <button type="button" class="analytics-link" onclick="navigate(&quot;feedback&quot;)">View feedback</button>') + '</div></section><section class="dash-section" aria-labelledby="operationsHeading"><h3 class="overview-section-title" id="operationsHeading">Operations</h3>' + dashboardOperationalHtml(db, start, end, card) + '</section></div>';
}


let adminQueuePollTimer = null;
let adminServiceClockTimer = null;
function updateAdminServiceClocks() {
  document.querySelectorAll('[data-serving-since]').forEach(el => {
    const started = Number(el.dataset.servingSince);
    if (!Number.isFinite(started)) return;
    const seconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
    el.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  });
}
function startAdminQueuePolling() {
  stopAdminQueuePolling();
  updateAdminServiceClocks();
  adminServiceClockTimer = setInterval(updateAdminServiceClocks, 1000);
  adminQueuePollTimer = setInterval(() => { if (state_view === 'queue' && !window.UniServeRealtime?.connected && document.visibilityState !== 'hidden') renderQueueDashboard(); }, 4000);
}
function stopAdminQueuePolling() {
  if (adminQueuePollTimer) { clearInterval(adminQueuePollTimer); adminQueuePollTimer = null; }
  if (adminServiceClockTimer) { clearInterval(adminServiceClockTimer); adminServiceClockTimer = null; }
}
async function manageWalkInIntake(){try{const status=await UniServeUX.request('/walk-in-capacity');openModal('Walk-in intake',`<div class="intake-settings"><div class="intake-summary"><div><span>Normal cutoff</span><strong>${escapeHtml(status.cutoff||'Before closing')}</strong></div><p>Queued visitors can still be served during office hours.</p></div>${status.officeOpen===false?'<p class="field-hint intake-hours-notice">'+escapeHtml(status.officeMessage||status.message)+'. Extra walk-ins override the intake cutoff only. To extend hours today, update Office Availability.</p>':''}<div class="field intake-counter-field"><label for="intakeCounters">Counters serving today</label><input id="intakeCounters" type="number" min="1" max="20" value="${status.counters||1}"></div><div class="field"><label for="intakeMode">Intake today</label><select id="intakeMode" onchange="toggleIntakeTime()"><option value="automatic" ${!status.manualCutoff&&!status.scheduledCutoff&&!status.override?'selected':''}>Use automatic cutoff</option><option value="closed" ${status.manualCutoff?'selected':''}>Close walk-in intake now</option><option value="scheduled" ${status.scheduledCutoff&&!status.manualCutoff?'selected':''}>Schedule cutoff today</option><option value="extra" ${status.override?'selected':''}>Override cutoff until closing</option></select></div><div class="field intake-time-field" id="intakeTimeField" ${status.scheduledCutoff&&!status.manualCutoff?'':'hidden'}><label for="intakeTime">Cutoff time </label><input id="intakeTime" type="time" value="${escapeHtml(status.cutoffTime||'')}"><p class="field-hint">Walk-in intake may close earlier if the queue reaches capacity.</p>${status.closedTime?`<p class="field-hint">Intake closed at ${escapeHtml(status.closedTime)}.</p>`:''}</div></div>`,[{label:'Cancel',cls:'btn-ghost',action:closeModal},{label:'Save changes',cls:'btn-primary',action:async()=>{try{const updated=await UniServeUX.request('/walk-in-capacity/override','POST',{counters:Number(document.getElementById('intakeCounters').value),mode:document.getElementById('intakeMode').value,cutoffTime:document.getElementById('intakeTime').value||null});closeModal();toast(updated.accepting?'Walk-in intake updated. Walk-ins are available.':'Intake settings saved. '+escapeHtml(updated.message||'Walk-in intake remains closed.'),updated.accepting?'ok':'warn');}catch(e){toast(escapeHtml(e.message),'err');}}}]);}catch(e){toast(escapeHtml(e.message),'err');}}
async function reviewRemainingVisits(status){
  try{await loadSharedQueue();const rows=loadDB().queues.filter(q=>status?q.status===status:['Waiting','Called','Serving','Skipped','Unfinished'].includes(q.status));
    openModal('Review remaining visits',`<div class="remaining-visits"><p class="remaining-visits-hint">Review an open visit to finish service, schedule a follow-up, or close the record.</p><div class="flow-review-list">${rows.length?rows.map(q=>`<div class="flow-review-row remaining-visit-row"><span class="remaining-visit-icon" aria-hidden="true">${icon('ticket',18)}</span><div class="remaining-visit-details"><div class="remaining-visit-title"><b>${escapeHtml(queueRef(q))}</b>${queueStatusPill(q.status)}</div><span class="remaining-visit-service">${escapeHtml(serviceQueueLabel(loadDB(),q))}</span>${queueRequirementsBadge(loadDB(),q)}</div><button class="btn btn-ghost btn-sm remaining-visit-action" onclick="openQueueVisitDetail('${q.id}')">Review</button></div>`).join(''):'<p class="remaining-visits-hint">No remaining visits.</p>'}</div><p class="remaining-visits-footnote">Previous-day visits are kept for review.</p></div>`,[]);
  }catch(e){toast(escapeHtml(e.message),'err');}
}
function arrangeFollowUp(id){
  openModal('Arrange another visit','<p class="field-hint">Keep the same Visit ID, details and uploaded documents. This visit will leave the queue and appear under appointment requests for scheduling.</p>'+reasonSelectHtml('followUpReason',['Additional requirements needed','Follow-up consultation','Further case review','Referred to another service','Visitor requested another visit'])+'',[
    {label:'Back',cls:'btn-ghost',action:()=>openQueueVisitDetail(id)},
    {label:'Arrange another visit',cls:'btn-primary',action:async()=>{try{const result=await SharedAppointments.request('/queue/'+id+'/follow-up','POST',{reason:readSelectedReason('followUpReason')});SharedAppointments.cache(result);closeModal();navigate('appointments');toast('Details retained. Confirm a new schedule.','ok');}catch(e){toast(escapeHtml(e.message),'err');}}}
  ]);
}
function closeUnservedVisit(id){
  openModal('Close as not served','<div class="field"><label for="unservedReasonChoice">Reason</label><select id="unservedReasonChoice" onchange="document.getElementById(\'unservedOtherField\').hidden=this.value!==\'Other\';if(this.value===\'Other\')document.getElementById(\'unservedReason\').focus()"><option value="">Select a reason</option><option>Visitor left before service</option><option>Visitor did not respond when called</option><option>Visitor requested cancellation</option><option>Incomplete requirements</option><option>Duplicate visit</option><option>Other</option></select></div><div class="field" id="unservedOtherField" hidden><label for="unservedReason">Other reason</label><textarea id="unservedReason" minlength="5" maxlength="500" placeholder="Please specify the reason."></textarea></div>',[
    {label:'Back',cls:'btn-ghost',action:()=>openQueueVisitDetail(id)},
    {label:'Close visit',cls:'btn-danger-o',action:async()=>{try{const choice=document.getElementById('unservedReasonChoice').value;const reason=choice==='Other'?document.getElementById('unservedReason').value.trim():choice;if(!reason||reason.length<5){toast(choice==='Other'?'Enter at least 5 characters for the other reason.':'Select a reason.','err');document.getElementById(choice==='Other'?'unservedReason':'unservedReasonChoice').focus();return;}await UniServeUX.request('/queue/'+id,'PATCH',{status:'Cancelled',closureReason:reason});closeModal();await renderQueueDashboard();toast('Visit closed as not served.','ok');}catch(e){toast(escapeHtml(e.message),'err');}}}
  ]);
}
async function renderQueueDashboard() {
  if (sharedQueueLoading) return;
  sharedQueueLoading = true;
  let queueError = '';
  try { await loadSharedQueue(); }
  catch (_) { queueError = 'Cannot connect to UniServe. Please retry before changing a visit.'; }
  finally { sharedQueueLoading = false; }
  if (state_view !== 'queue' || document.querySelector('.ux-secondary-actions[open]')) return;
  const db = loadDB(), stats = queueStats(db), mine = myQueueEntries(db, currentUser.id), waiting = waitingQueueSorted(db), nextUp = stats.next;
  document.getElementById('content').innerHTML = `
    ${queueError ? '<div class="err-box">' + queueError + '<button class="btn btn-ghost btn-sm" onclick="renderQueueDashboard()">Retry</button></div>' : ''}
    <div class="stat-grid">
      <div class="stat-card"><div class="lbl">Currently Waiting</div><div class="val">${stats.waiting}</div></div>
      <div class="stat-card"><div class="lbl">Currently Serving</div><div class="val">${stats.serving}</div></div>
      <div class="stat-card"><div class="lbl">Completed Today</div><div class="val">${stats.completedToday}</div></div>
      <div class="stat-card"><div class="lbl">Average Wait</div><div class="val">${fmtCompactMinutes(stats.avgWaitMin)}</div></div>
    </div>
    <section class="queue-service-notice" aria-label="Queue service guidance"><span class="queue-service-notice-icon" aria-hidden="true">${icon('users',20)}</span><div class="queue-service-notice-copy"><h3>${db.systemSettings?.allowParallelService?'Parallel service enabled':'One visitor at a time'}</h3><p>${db.systemSettings?.allowParallelService?'You can handle more than one visit at a time.':'Finish your current visit before calling the next visitor.'}</p></div><button class="btn btn-ghost btn-sm" onclick="reviewRemainingVisits()">Review remaining visits ${db.queues.some(q => ['Waiting','Called','Serving','Skipped','Unfinished'].includes(q.status)) ? `<span class="dashboard-attention-count">${db.queues.filter(q => ['Waiting','Called','Serving','Skipped','Unfinished'].includes(q.status)).length}</span>` : ''}</button></section>
    ${db.queues.some(q=>q.status==='Skipped')?`<section class="queue-absent" aria-label="Absent visitors"><span class="queue-service-notice-icon" aria-hidden="true">${icon('absent',18)}</span><div class="queue-absent-heading"><h3>Absent visitors</h3><p>When they return, rejoin them at the end of their priority group using their return time.</p></div><div class="queue-absent-list"><button type="button" class="btn btn-ghost queue-absent-action" onclick="reviewRemainingVisits('Skipped')"><span class="queue-absent-label">Review / return</span><span class="queue-absent-number dashboard-attention-count">${db.queues.filter(q=>q.status==='Skipped').length}</span></button></div></section>`:''}
    <div class="admin-queue-layout">
      <div class="card">
        <div class="card-head"><div><h3>My Queue</h3><div class="desc">${escapeHtml(currentUser.fullName)} &mdash; OSS Admin</div></div>
          <div class="toolbar queue-actions"><div class="queue-intake-actions" role="group" aria-label="Walk-in actions"><button type="button" class="btn btn-ghost btn-sm" onclick="openAssistedIntake()">${icon('plus',14)} Assisted walk-in</button>${currentUser.confidentialApprover?'<button type="button" class="btn btn-ghost btn-sm" onclick="manageWalkInIntake()">'+icon('calendar',14)+' Walk-in intake</button>':''}</div><button type="button" class="btn btn-primary btn-sm queue-call-next" onclick="handleCallNext()" ${!nextUp||(!db.systemSettings?.allowParallelService&&mine.length) ? 'disabled' : ''}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg> Call Next</button></div></div>
        <div class="card-pad">
          ${mine.length ? mine.map(q => renderMyQueueCard(db, q)).join('') : `<div class="helper-empty" style="padding:30px 10px;">${icon('ticket', 30)}<p>${waiting.length && !nextUp ? 'Everyone waiting is scheduled for a later time.' : "You're not currently serving anyone. Click Call Next to bring up the next visit."}</p></div>`}
          ${nextUp ? `<div class="divider"></div><div class="lbl" style="font-size:.72rem; text-transform:uppercase; letter-spacing:.6px; color:var(--text-soft); font-weight:600; margin-bottom:8px;">Next</div>
            <div class="qd-next-row"><span class="pill pill-gold">${escapeHtml(queueRef(nextUp))}</span><span class="muted" style="font-size:.82rem;">${escapeHtml(nextUp.name || nextUp.visitorType)} &middot; ${escapeHtml(serviceQueueLabel(db, nextUp))} &middot; ${escapeHtml(entryMethodLabel(nextUp))}</span>${nextUp.isSenior ? ' <span class="pill pill-gold">Senior</span>' : ''}${nextUp.isPWD ? ' <span class="pill pill-gold">PWD</span>' : ''}${nextUp.possibleDuplicate ? ' <span class="pill pill-warn">Possible Dup.</span>' : ''}</div>` : ''}
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div><h3>Waiting</h3><div class="desc">${waiting.length} in line &mdash; seniors and PWDs, then scheduled visits by time, then walk-ins</div></div></div>
        <div class="table-wrap"><table><thead><tr><th>#</th><th>Ticket</th><th>Visitor</th><th>Service</th><th>Requirements</th><th>Entry</th></tr></thead>
          <tbody>${waiting.length ? waiting.map((q, i) => `<tr><td class="row-num">${i + 1}</td>
            <td class="mono">${escapeHtml(queueRef(q))}${q.isSenior ? ' <span class="pill pill-gold">Senior</span>' : ''}${q.isPWD ? ' <span class="pill pill-gold">PWD</span>' : ''}${UniServeUX.previousDay(q) ? ' <span class="pill pill-warn">Previous day</span>' : ''}${q.possibleDuplicate ? ' <span class="pill pill-warn">Dup?</span>' : ''}${q.number ? `<div class="muted" style="font-size:.68rem;">${escapeHtml(q.visitId || '')}</div>` : ''}</td>
            <td>${escapeHtml(q.name || '—')}<div class="muted" style="font-size:.72rem;">${escapeHtml(q.visitorType)}</div></td>
            <td>${escapeHtml(serviceQueueLabel(db, q))}</td>
            <td>${queueRequirementsBadge(db,q)}</td>
            <td>${q.source === 'Appointment' ? (dueTagHtml(q) || `<span class="pill pill-info">Scheduled</span>`) : `<span class="muted" style="font-size:.76rem;">Walk-in</span>`}</td>
            </tr>`).join('') : `<tr class="empty-row"><td colspan="6">Queue is empty.</td></tr>`}</tbody></table></div>
      </div>
    </div>`;
  startAdminQueuePolling();
}
const queueRequirementSaving = new Set();
function queueRequirementState(db,q) {
  if(q.requirementReadiness)return q.requirementReadiness;
  const labels=[...new Set((findService(db,q.serviceKey)?.requirements||[]).map(r=>String(r).trim()).filter(Boolean))];
  const appointment=(db.appointments||[]).find(a=>a.id===q.appointmentId&&(a.serviceKey||a.service)===q.serviceKey);
  const accepted=(appointment?.attachments||[]).filter(f=>f.review?.status==='Accepted'&&f.review.serviceKey===q.serviceKey).map(f=>f.review.requirement);
  const items=labels.map(label=>{const source=accepted.includes(label)?'upload':(q.requirementChecks||[]).some(c=>c.serviceKey===q.serviceKey&&c.requirement===label&&c.checked)?'counter':null;return {label,source,checked:!!source};});
  const checked=items.filter(item=>item.checked).length;
  return {items,checked,required:items.length,ready:checked===items.length};
}
function queueRequirementsBadge(db,q) {
  if(q.restricted)return '<span class="muted">Restricted</span>';
  const state=queueRequirementState(db,q);
  return '<span class="queue-requirements-table" data-queue-id="'+escapeHtml(q.id)+'">'+readinessPillHtml({status:state.ready?'READY':'INCOMPLETE',label:state.ready?'Requirements complete':'Incomplete requirements'},true)+(state.required?'<small>'+state.checked+' of '+state.required+' checked</small>':'')+'</span>';
}
function syncQueueRequirementControls(id) {
  const db=loadDB(),q=db.queues.find(row=>row.id===id);if(!q)return;
  for(const button of document.querySelectorAll('.queue-complete-action'))if(button.dataset.queueId===id)button.disabled=queueRequirementSaving.has(id)||!queueRequirementState(db,q).ready;
  for(const badge of [...document.querySelectorAll('.queue-requirements-table')])if(badge.dataset.queueId===id)badge.outerHTML=queueRequirementsBadge(db,q);
}
function queueRequirementsHtml(db, q) {
  if(q.restricted)return '';
  const state=queueRequirementState(db,q),editable=q.status==='Serving'&&q.assignedAdminId===currentUser.id,saving=queueRequirementSaving.has(q.id);
  return '<section class="queue-requirements" data-queue-id="'+escapeHtml(q.id)+'" aria-label="Visit requirements"><div class="queue-requirements-head"><h4>Requirements</h4><span>'+state.checked+' of '+state.required+' checked</span></div>'+
    (state.required?state.items.map((item,index)=>'<label class="queue-requirement-row"><input type="checkbox" data-index="'+index+'" data-upload="'+(item.source==='upload')+'" data-service-key="'+escapeHtml(q.serviceKey)+'" data-requirement="'+escapeHtml(item.label)+'" '+(item.checked?'checked ':'')+(!editable||saving||item.source==='upload'?'disabled ':'')+'onchange="saveQueueRequirement(this)"><span>'+escapeHtml(item.label)+(item.source==='upload'?'<small>Accepted upload</small>':'')+'</span></label>').join(''):'<p class="field-hint">No requirements listed for this service.</p>')+
    '<p class="queue-requirement-status field-hint" role="status" aria-live="polite">'+(saving?'Saving...':state.required?(editable?(state.ready?'All requirements checked.':'Check the remaining requirements before completing service.') :q.status==='Called'?'Start service to check remaining requirements.':'Saved checklist ? read only.'):'')+'</p>'+(q.appointmentId?'<p class="field-hint queue-upload-note">Accepted uploads cover the requirements matched during document review. Check any remaining items at the counter.</p>':'')+'</section>';
}
async function saveQueueRequirement(input) {
  const host=input.closest('.queue-requirements'),id=host.dataset.queueId,q=loadDB().queues.find(q=>q.id===id);
  if(!q||queueRequirementSaving.has(id))return;
  const checked=input.checked,index=input.dataset.index;
  queueRequirementSaving.add(id);syncQueueRequirementControls(id);
  const hosts=()=>[...document.querySelectorAll('.queue-requirements')].filter(el=>el.dataset.queueId===id);
  for(const el of hosts()){el.querySelectorAll('input').forEach(field=>field.disabled=true);el.querySelector('[role="status"]').textContent='Saving...';}
  try {
    const result=await UniServeUX.request('/queue/'+encodeURIComponent(id)+'/requirements','PATCH',{serviceKey:input.dataset.serviceKey,requirement:input.dataset.requirement,checked});
    SharedAppointments.cache(result);
    queueRequirementSaving.delete(id);
    for(const el of hosts())el.outerHTML=queueRequirementsHtml(loadDB(),result.queue);
    for(const el of hosts())el.querySelector('[role="status"]').textContent='Checklist saved.';
    const focus=hosts().find(el=>el.closest('#activeModal'))||hosts()[0];
    focus?.querySelector('input[data-index="'+index+'"]')?.focus({preventScroll:true});
  } catch(error) {
    input.checked=!checked;
    toast(escapeHtml(error.message||'Could not save the checklist. Try again.'),'err');
    for(const el of hosts())el.querySelector('[role="status"]').textContent='Not saved. Please try again.';
  } finally {
    queueRequirementSaving.delete(id);
    const latest=loadDB().queues.find(row=>row.id===id);
    for(const el of hosts())el.querySelectorAll('input').forEach(field=>field.disabled=field.dataset.upload==='true'||!latest||latest.restricted||latest.status!=='Serving'||latest.assignedAdminId!==currentUser.id);
    syncQueueRequirementControls(id);
  }
}
function renderMyQueueCard(db, q) {
  const called = q.status === 'Called', reqCount = visitRequirements(db, q).length, delayed = isServiceDelayed(db, q);
  return `<div class="qd-serving-card"><div class="qd-serving-top">
      <div><div class="qd-serving-number">${escapeHtml(queueRef(q))}${q.isSenior ? ' <span class="pill pill-gold">Senior</span>' : ''}${q.isPWD ? ' <span class="pill pill-gold">PWD</span>' : ''}${q.possibleDuplicate ? ' <span class="pill pill-warn">Dup?</span>' : ''}</div>
        <div class="muted" style="font-size:.8rem;">${escapeHtml(q.name || q.visitorType)} &middot; ${escapeHtml(serviceQueueLabel(db, q))} &middot; ${escapeHtml(entryMethodLabel(q))}</div>
        <div class="muted mono" style="font-size:.7rem; margin-top:2px;">${q.number ? escapeHtml(q.visitId || '') : (q.scheduledAt ? 'Scheduled ' + fmtTime(q.scheduledAt) : '')}${reqCount ? ` &middot; ${reqCount} requirement(s)` : ''}</div>
        </div>
      <div class="qd-serving-status">${delayed ? `<span class="pill delay-pill">${icon('alert', 11)} Delayed</span>` : (called ? `<span class="pill pill-warn">Called &mdash; awaiting arrival</span>` : `<span class="pill pill-ok">Processing</span>`)}
        ${!called && q.servingAt ? `<div class="qd-service-clock" data-serving-since="${new Date(q.servingAt).getTime()}" aria-label="Service time elapsed">0:00</div>` : ''}</div>
    </div>
    ${queueRequirementsHtml(db,q)}
    <div class="qd-serving-actions">
      <button class="btn btn-ghost btn-sm" onclick="openQueueVisitDetail('${q.id}')">View visit</button>
      ${called ? `<button class="btn btn-primary btn-sm" onclick="handleBeginServing('${q.id}')">Start service</button>
        <div class="qd-more-actions"><div class="qd-secondary-actions" aria-label="Other visit actions"><button class="btn btn-ghost btn-sm" onclick="handleRecall('${q.id}')">Recall</button><button class="btn btn-ghost btn-sm" onclick="handleSkip('${q.id}')">Mark absent</button><button class="btn btn-ghost btn-sm" onclick="openTransferModal('${q.id}')">Transfer</button><button class="btn btn-danger-o btn-sm" onclick="adminCancelQueue('${q.id}')">Cancel visit</button></div></div>`
      : `<button class="btn btn-primary btn-sm queue-complete-action" data-queue-id="${escapeHtml(q.id)}" ${!queueRequirementState(db,q).ready||queueRequirementSaving.has(q.id)?'disabled':''} onclick="handleCompleteQueue('${q.id}')">Complete service</button>
        <div class="qd-more-actions"><div class="qd-secondary-actions" aria-label="Other visit actions"><button class="btn btn-ghost btn-sm" onclick="openTransferModal('${q.id}')">Transfer</button></div></div>`}
    </div></div>`;
}
async function handleCallNext(){try{const result=await UniServeUX.request('/queue/call-next','POST',{});await renderQueueDashboard();toast('Visitor called.','ok');}catch(e){toast(escapeHtml(e.message),'err');}}
async function handleBeginServing(id){try{await UniServeUX.request('/queue/'+id,'PATCH',{status:'Serving'});await renderQueueDashboard();toast('Service started.','ok');}catch(e){toast(escapeHtml(e.message),'err');}}
async function handleSkip(id){try{await UniServeUX.request('/queue/'+id,'PATCH',{status:'Skipped'});await renderQueueDashboard();}catch(e){toast(escapeHtml(e.message),'err');}}
async function handleRecall(id) { const q=loadDB().queues.find(q=>q.id===id);if(!q)return;try{await UniServeUX.request('/queue/'+id,'PATCH',{status:'Called',recallCount:(q.recallCount||0)+1});await renderQueueDashboard();toast('Recalled on the public display.','ok');}catch(e){toast(escapeHtml(e.message),'err');} }
async function adminCancelQueue(id){if(!await UniServeUX.confirm('Cancel visit','Cancel this visit and its pending reminders?','Cancel visit'))return;try{await UniServeUX.request('/queue/'+id,'PATCH',{status:'Cancelled'});await renderQueueDashboard();toast('Visit cancelled.','ok');}catch(e){toast(escapeHtml(e.message),'err');}}
function openTransferModal(id) {
  const db = loadDB(), q = db.queues.find(x => x.id === id);
  if (!q) return;
  openModal(`Transfer ${escapeHtml(queueRef(q))}`, `<p class="field-hint" style="margin-bottom:12px;">Move this visit back into the queue under a different OSS service. The Visit ID and uploaded requirements stay with it.</p>
    <div class="field"><label>New Service</label><select id="mTransferSvc">${db.services.map(s => `<option value="${s.key}" ${s.key === q.serviceKey ? 'selected' : ''}>${s.label}</option>`).join('')}</select></div>`,
    [{ label: 'Cancel', cls: 'btn-ghost', action: closeModal },
     { label: 'Transfer', cls: 'btn-primary', action: async () => {try{await UniServeUX.request('/queue/'+id,'PATCH',{status:'Waiting',serviceKey:document.getElementById('mTransferSvc').value,transferredAt:new Date().toISOString()});closeModal();await renderQueueDashboard();toast('Visit transferred.','ok');}catch(e){toast(escapeHtml(e.message),'err');}} }]);
}
function openQueueVisitDetail(id) {
  const db = loadDB(), q = db.queues.find(x => x.id === id);
  if (!q) { toast('Visit not found.', 'err'); return; }
  const linkedAppt = q.appointmentId ? db.appointments.find(a => a.id === q.appointmentId) : null;
  const reqs = visitRequirements(db, q), mine = q.assignedAdminId === currentUser.id;
  const txn = q.transactionId ? db.transactions.find(t => t.id === q.transactionId) : null;
  const buttons = [];
  if(['Waiting','Called','Serving','Skipped','Unfinished'].includes(q.status)&&(!['Called','Serving'].includes(q.status)||mine))buttons.push({label:'Arrange another visit',cls:'btn-ghost',action:()=>arrangeFollowUp(q.id)});
  if(q.status==='Unfinished') {
    buttons.push({label:'Resume today',cls:'btn-primary',action:async()=>{try{await UniServeUX.request('/queue/'+q.id,'PATCH',{status:'Waiting'});closeModal();await renderQueueDashboard();toast('Visitor returned to the queue.','ok');}catch(e){toast(escapeHtml(e.message),'err');}}});
    buttons.push({label:'Close as not served',cls:'btn-danger-o',action:()=>closeUnservedVisit(q.id)});
  }
  if (q.status === 'Skipped') buttons.push({label:'Return to queue',cls:'btn-primary',action:async()=>{try{await UniServeUX.request('/queue/'+q.id,'PATCH',{status:'Waiting'});closeModal();await renderQueueDashboard();toast('Visitor returned to queue.','ok');}catch(e){toast(escapeHtml(e.message),'err');}}});
  if (q.status === 'Waiting') {
    buttons.push({ label: 'Call Now', cls: 'btn-primary', action: async () => {
      try {await UniServeUX.request('/queue/'+q.id,'PATCH',{status:'Called'});closeModal();await renderQueueDashboard();toast('Visitor called.','ok');}
      catch(e){toast(escapeHtml(e.message),'err');}
    } });
  } else if (q.status === 'Called' && mine) buttons.push({ label: 'Start service', cls: 'btn-primary', action: () => { closeModal(); handleBeginServing(q.id); } });
  else if (q.status === 'Serving' && mine) buttons.push({ label: 'Complete service', cls: 'btn-primary queue-complete-action', action: () => handleCompleteQueue(q.id) });
  if(['Waiting','Called','Serving','Skipped'].includes(q.status)&&(!['Called','Serving'].includes(q.status)||mine))buttons.push({label:'Close as not served',cls:'btn-danger-o',action:()=>closeUnservedVisit(q.id)});

  openModal(`Visit &mdash; ${escapeHtml(q.visitId || q.number)}`, `
    <div class="record-detail-clean"><div class="staff-record-context"><strong>${escapeHtml(q.name || 'Visitor')}</strong><span class="mono">${escapeHtml(q.visitId || q.number || q.id)}</span><span>${queueStatusPill(q.status)}</span></div>
    ${q.possibleDuplicate ? `<div class="dup-warn">${icon('alert', 13)} Flagged by the visitor portal as a possible duplicate active visit for this ID number or Gmail and service. Review before proceeding if unsure.</div>` : ''}
    ${isServiceDelayed(db, q) ? `<div class="alert-banner danger"><b>${icon('alert', 13)} Service Delay Alert</b>This visit has been in service noticeably longer than usual for this service. Informational only.</div>` : ''}

    ${(q.caseStatus||txn?.caseStatus)?`<div class="kv"><span>Case status</span><span>${escapeHtml(q.caseStatus||txn.caseStatus)}</span></div>`:''}<section class="staff-detail-section"><h4>Visitor details</h4>
    ${q.number ? `<div class="kv"><span>Queue Number</span><span><span class="pill pill-gold">${escapeHtml(q.number)}</span></span></div>` : ''}
    <div class="kv"><span>Type</span><span>${escapeHtml(q.guestClass ? `${q.visitorType} (${q.guestClass})` : q.visitorType)}</span></div>
    ${q.idNumber ? `<div class="kv"><span>${q.idType ? escapeHtml(q.idType) : 'ID Number'}</span><span>${escapeHtml(q.idNumber)}</span></div>` : (q.idType ? `<div class="kv"><span>ID Type</span><span>${escapeHtml(q.idType)}</span></div>` : '')}
    ${q.contact ? `<div class="kv"><span>Contact</span><span>${escapeHtml(q.contact)}</span></div>` : ''}
    ${q.email ? `<div class="kv"><span>Gmail</span><span>${escapeHtml(q.email)}</span></div>` : ''}
    </section><section class="staff-detail-section"><h4>Service details</h4><div class="kv"><span>Service</span><span>${escapeHtml(serviceQueueLabel(db, q))}</span></div>
    <div class="kv"><span>Entry Method</span><span>${q.source === 'Appointment' ? 'Scheduled Appointment' : 'Walk-In'}</span></div>
    ${q.scheduledAt ? `<div class="kv"><span>Scheduled For</span><span>${fmtDateTime(q.scheduledAt)} ${dueTagHtml(q)}</span></div>` : ''}

    ${q.isSenior ? `<div class="kv"><span>Priority</span><span><span class="pill pill-gold">Senior Citizen</span></span></div>` : ''}
    ${q.isPWD ? '<div class="kv"><span>Priority</span><span><span class="pill pill-gold">Person with disability</span></span></div>' : ''}
    ${linkedAppt ? `<div class="kv"><span>Appointment</span><span>${escapeHtml(linkedAppt.code)}</span></div>` : ''}
    ${linkedAppt && linkedAppt.arrivalStatus ? `<div class="kv"><span>Arrival</span><span>${arrivalStatusPill(linkedAppt)}</span></div>` : ''}
    ${q.assignedAdminName ? `<div class="kv"><span>OSS Admin</span><span>${escapeHtml(q.assignedAdminName)}</span></div>` : ''}
    ${txn ? `<div class="kv"><span>Transaction</span><span class="mono">${escapeHtml(txn.code)}</span></div>` : ''}
    </section>${queueRequirementsHtml(db,q)}<section class="staff-detail-section"><h4>Documents</h4>
    <div class="field"><label>Uploaded Requirements</label>${attachListHtml(reqs, q.source === 'Appointment' ? 'No files uploaded with this appointment.' : 'No files uploaded &mdash; walk-in visitors bring physical documents to the counter.')}</div>
    </section><section class="staff-detail-section record-history"><h4>History</h4>
    ${feedbackReadoutHtml(q)}
    ${timelineBlockHtml(q, linkedAppt)}
    ${typeof flowServiceHistory==='function'?flowServiceHistory(q.serviceHistory):''}
    </section></div>`, buttons);
  const complete=document.querySelector("#activeModal .queue-complete-action");if(complete){complete.dataset.queueId=q.id;syncQueueRequirementControls(q.id);}
}

let apptFilter = 'all';
let appointmentView = 'list';
let visitorMonth = '';
let visitorDay = '';
function appointmentViewSwitchHtml() {
  const listIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>';
  const calendarIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2"/></svg>';
  return `<div class="schedule-view-switch" role="group" aria-label="Schedule view">${[['list', 'List view', listIcon], ['calendar', 'Calendar view', calendarIcon]].map(([view, label, svg]) => `<button type="button" class="btn btn-ghost" title="${label}" aria-label="${label}" aria-pressed="${appointmentView === view}" onclick="setAppointmentView('${view}')">${svg}</button>`).join('')}</div>`;
}
function dashboardScheduledVisitors(db) {
  const rows = db.appointments.filter(a => !a.restricted && a.date === OfficeCalendar.parts().date && a.status === 'Booked').sort(visitorTimeSort);
  return `<section class="card"><div class="card-head"><div><h3>Today's scheduled visitors</h3><div class="desc">Confirmed visits awaiting check-in</div></div></div><div class="card-pad">${rows.length ? rows.slice(0, 4).map(arrivalVisitorHtml).join('') : emptyChart('No visitors awaiting check-in today.')}</div><div class="analytics-footer"><span>${rows.length} awaiting check-in</span><button type="button" class="analytics-link" onclick="openVisitorSchedule()">View schedule</button></div></section>`;
}
function visitorTimeSort(a, b) {
  return String(UniServeUX.appointmentTime(a.time) || '99:99').localeCompare(String(UniServeUX.appointmentTime(b.time) || '99:99'));
}
function openVisitorSchedule() {
  appointmentView = 'calendar'; visitorMonth = OfficeCalendar.parts().date.slice(0, 7); visitorDay = OfficeCalendar.parts().date;
  navigate('appointments');
}
function setAppointmentView(view) {
  appointmentView = view; renderAppointments(true);
}
function moveVisitorMonth(delta) {
  const date = new Date(visitorMonth + '-01T12:00:00Z'); date.setUTCMonth(date.getUTCMonth() + delta);
  visitorMonth = date.toISOString().slice(0, 7); visitorDay = visitorMonth + '-01'; renderVisitorCalendar();
}
function renderVisitorCalendar() {
  const host = document.getElementById('visitorSchedule'); if (!host) return;
  const now = OfficeCalendar.parts().date;
  visitorMonth = visitorMonth || now.slice(0, 7); visitorDay = visitorDay || now;
  const first = new Date(visitorMonth + '-01T12:00:00Z');
  const count = new Date(first.getUTCFullYear(), first.getUTCMonth() + 1, 0).getUTCDate();
  const records = loadDB().appointments.filter(a => !a.restricted && a.date && ['Requested', 'Booked', 'Scheduled', 'Checked-in', 'Completed', 'Unfinished', 'No-show'].includes(a.status));
  const rows = records.filter(a => a.date === visitorDay).sort(visitorTimeSort);
  host.innerHTML = `<div class="visitor-schedule-toolbar"><div><h3>${first.toLocaleDateString('en-PH', {month:'long', year:'numeric', timeZone:'UTC'})}</h3><p class="muted">Select a date to see visitors. Requests are awaiting approval.</p></div><div class="toolbar calendar-month-controls"><button type="button" class="btn btn-ghost btn-sm" title="Previous month" aria-label="Previous month" onclick="moveVisitorMonth(-1)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg></button><button class="btn btn-ghost btn-sm" onclick="visitorMonth='';visitorDay='';renderVisitorCalendar()">Today</button><button class="btn btn-ghost btn-sm" aria-label="Next month" onclick="moveVisitorMonth(1)"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m10 6 6 6-6 6"/></svg></button>${appointmentViewSwitchHtml()}</div></div><div class="visitor-schedule-layout"><div class="calendar-grid visitor-calendar">${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => `<span class="calendar-heading">${d}</span>`).join('')}${'<span class="calendar-empty"></span>'.repeat(first.getUTCDay())}${Array.from({length:count}, (_, i) => {
    const date = visitorMonth + '-' + String(i + 1).padStart(2, '0'), visits = records.filter(a => a.date === date);
    const pending = visits.filter(a => a.status === 'Requested').length;
    return `<button type="button" class="calendar-day visitor-calendar-day ${date === now ? 'cal-today' : ''} ${date === visitorDay ? 'visitor-day-selected' : ''}" aria-pressed="${date === visitorDay}" aria-label="${date}, ${visits.length} visits, ${pending} requests" onclick="visitorDay='${date}';renderVisitorCalendar()"><span class="calendar-day-number">${i + 1}</span>${visits.length ? `<span class="visitor-day-count">${visits.length} visit${visits.length === 1 ? '' : 's'}</span>${pending ? `<small>${pending} requested</small>` : ''}` : ''}</button>`;
  }).join('')}</div><section class="visitor-day-agenda" aria-live="polite"><h3>${new Date(visitorDay + 'T12:00:00Z').toLocaleDateString('en-PH', {weekday:'long', month:'long', day:'numeric', year:'numeric', timeZone:'UTC'})}</h3><p class="muted">${rows.length} scheduled visit${rows.length === 1 ? '' : 's'}</p>${rows.length ? rows.map(arrivalVisitorHtml).join('') : '<p class="arrival-empty">No visitors scheduled for this date.</p>'}</section></div>`;
}
let arrivalLookupQuery = '';
function renderAppointments(keep) {
  const db0 = loadDB(), prev = keep ? (document.getElementById('apptSearch')?.value || '') : '';
  const previousArrival=keep?(document.getElementById('arrivalVisitId')?.value||''):'';
  const affectedBookings=db0.appointments.filter(a=>!a.restricted&&['Requested','Booked'].includes(a.status)&&(a.calendarReview||UniServeUX.conflict(a)));
  const pendingRequests=db0.appointments.filter(a=>!a.restricted&&a.status==='Requested');
  const oldestPending=pendingRequests.filter(a=>a.createdAt).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt))[0];
  const arrivalFocused=document.activeElement?.id==='arrivalVisitId';
  if (sweepNoShows(db0)) saveDB(db0);
  if (!keep) {apptFilter = staffViewMemory.appointments?.apptFilter || 'all';arrivalLookupQuery='';}
  document.getElementById('content').innerHTML = `
    ${affectedBookings.length?'<section class="staff-scheduling-notice" aria-label="Affected appointments"><div><strong>'+affectedBookings.length+' appointment(s) need schedule review</strong><p>Calendar changes may affect existing bookings. Confirm a new schedule with each visitor.</p></div><button type="button" class="btn btn-ghost btn-sm" onclick="showAppointmentReviewFilter(\'Needs rescheduling\')">Review bookings</button></section>':''}
    ${pendingRequests.length?'<section class="staff-scheduling-notice"><div><strong>'+pendingRequests.length+' request(s) awaiting review</strong><p>Pending requests reserve their time until staff acts. No automatic expiry.'+(oldestPending?' Oldest request: '+escapeHtml(fmtDateTime(oldestPending.createdAt))+'.':'')+'</p></div><button type="button" class="btn btn-ghost btn-sm" onclick="showAppointmentReviewFilter(\'Requested\')">Review requests</button></section>':''}
    <section class="card arrival-checkin" aria-labelledby="arrivalLookupTitle">
      <div class="arrival-toolbar"><div class="arrival-heading"><h3 id="arrivalLookupTitle">Check in today</h3><p>Find a scheduled visitor and confirm their arrival.</p></div>
        <form class="arrival-lookup" onsubmit="event.preventDefault();findArrivalVisitor(this)">
          <input id="arrivalVisitId" type="search" aria-label="Find visitor by Visit ID or name" placeholder="Visit ID or name" value="${escapeHtml(previousArrival)}" autocomplete="off" oninput="arrivalLookupQuery=this.value.trim().toLowerCase();renderTodayArrivals()">
          <button type="submit" class="btn btn-ghost">Search</button>
        </form>
      </div>
      <div id="todayArrivalsList" class="arrival-list" aria-live="polite"></div>
    </section>
    <div class="card">
      <div class="card-head"><div><h3>Scheduled Visits</h3><div class="desc">Visitor appointments and requests</div></div></div>
      <div id="visitorSchedule" class="card-pad" ${appointmentView === 'calendar' ? '' : 'hidden'}></div>
      <div ${appointmentView === 'list' ? '' : 'hidden'}>
      <div class="filter-bar">${dateRangeHtml('appt')}${appointmentViewSwitchHtml()}<div class="search-box">${icon('search', 15)}<input id="apptSearch" placeholder="Name, code or visit ID" value="${escapeHtml(prev)}" oninput="renderApptTable()"></div></div>
      <div class="subnav tab-row">${['all', 'Requested', 'Booked', 'Needs rescheduling', 'Checked-in', 'Completed', 'Unfinished', 'No-show', 'Cancelled'].map(f => `<button class="${apptFilter === f ? 'active' : ''}" onclick="setApptFilter('${f}',this)">${f === 'all' ? 'All' : f}</button>`).join('')}</div>
      <div class="table-wrap"><table><thead><tr><th>#</th><th>Visit ID</th><th>Requestor</th><th>Service</th><th>Date</th><th>Time</th><th>Readiness</th><th>Status</th><th class="appointment-action-heading">Actions</th></tr></thead><tbody id="apptBody"></tbody></table></div>
      </div>
    </div>`;
  organizeStaffToolbar('apptSearch');
  renderTodayArrivals();
  renderApptTable();
  if (appointmentView === 'calendar') renderVisitorCalendar();
  if(arrivalFocused)document.getElementById('arrivalVisitId').focus();
}
function arrivalVisitorHtml(r) {
  const canCheckIn=r.shared&&r.status==='Booked'&&r.date===today()&&OfficeCalendar.status().open&&!UniServeUX.conflict(r);
  const note=r.status==='Booked'?(r.date!==today()?'Check in on the appointment day.':!OfficeCalendar.status().open?'Check-in is available during office hours.':UniServeUX.conflict(r)?'This appointment needs rescheduling.':'Confirm the visitor has arrived before checking in.'):r.status==='Requested'?'Staff approval is required before check-in.':r.status==='Checked-in'?'Already checked in.':'Check-in is unavailable for this visit.';
  return '<article class="arrival-visitor"><div class="arrival-visitor-details"><strong>'+escapeHtml(r.name)+'</strong><span class="mono">'+escapeHtml(r.visitId||r.code||r.id)+'</span><span>'+escapeHtml(r.service||'')+'</span><span>'+escapeHtml(r.date===today()?(r.time?UniServeUX.timeLabel(r.time):'Time not set'):(r.date||'Not scheduled')+' · '+(r.time?UniServeUX.timeLabel(r.time):'Time not set'))+'</span>'+(!canCheckIn?'<small>'+escapeHtml(note)+'</small>':'')+'</div><div class="arrival-visitor-actions">'+(!canCheckIn?statusPill(r.status):'')+'<button type="button" class="btn '+(canCheckIn?'btn-primary':'btn-ghost')+'" data-arrival-id="'+escapeHtml(r.id)+'" onclick="openApptDetail(this.dataset.arrivalId'+(canCheckIn?'':',false,true')+')">'+(canCheckIn?'Check in':'Details')+'</button></div></article>';
}
function renderTodayArrivals() {
  const container=document.getElementById('todayArrivalsList');if(!container)return;
  const query=(document.getElementById('arrivalVisitId')?.value||'').trim().toLowerCase();
  if(query){renderArrivalMatches(query,container);return;}
  const rows=loadDB().appointments.filter(r=>!r.restricted&&r.date===today()&&r.status==='Booked').sort((a,b)=>String(a.time||'').localeCompare(String(b.time||'')));
  container.innerHTML=rows.length?rows.map(arrivalVisitorHtml).join(''):'<p class="arrival-empty">No visitors awaiting check-in today.</p>';
}
function renderArrivalMatches(query,results) {
    const records=loadDB().appointments.filter(r=>!r.restricted);
    const exact=records.filter(r=>[r.visitId,r.code,r.id].some(value=>String(value||'').toLowerCase()===query));
    const matches=exact.length?exact:records.filter(r=>String(r.name||'').toLowerCase().includes(query));
    results.innerHTML=matches.length?matches.slice(0,10).map(arrivalVisitorHtml).join('')+(matches.length>10?'<p class="arrival-empty">More than 10 matches. Enter the full Visit ID or a more specific name.</p>':''):'<p class="arrival-empty">No matching visitor found. Check the Visit ID on their ticket or search by name.</p>';
}
let arrivalLookupVersion=0;
async function findArrivalVisitor(form) {
  const query=document.getElementById('arrivalVisitId').value.trim().toLowerCase();
  const version=++arrivalLookupVersion,button=form.querySelector('button[type="submit"]'),results=document.getElementById('todayArrivalsList');
  button.disabled=true;results.textContent='Finding visitor...';
  try {
    SharedAppointments.cache(await SharedAppointments.request('/appointments'));
    if(version!==arrivalLookupVersion||!results.isConnected)return;
    arrivalLookupQuery=query;
    renderTodayArrivals();renderApptTable();
  } catch(error) {if(version===arrivalLookupVersion&&results.isConnected)results.textContent=error.message||'Could not find the visitor. Please try again.';}
  finally {if(button.isConnected)button.disabled=false;}
}
function resetStaffTableFilters(kind) {
 if(kind==='appt'){if(staffViewMemory.appointments)staffViewMemory.appointments.apptFilter='all';apptFilter='all';RANGES.appt={from:'',to:''};renderAppointments(false);}
 if(kind==='log'){RANGES.log={from:'',to:''};renderVisitorLogbook(false);}
 if(kind==='txn'){txnFilter='all';txnServiceFilter=undefined;RANGES.txn={from:'',to:''};renderTxnCard(false);}
}
function showAppointmentReviewFilter(filter) {
 apptFilter=filter;RANGES.appt={from:'',to:''};
 const search=document.getElementById('apptSearch');if(search)search.value='';
 renderAppointments(true);
}
function setApptFilter(f, el) { apptFilter = f; document.querySelectorAll('.subnav button').forEach(b => b.classList.remove('active')); el.classList.add('active'); renderApptTable(); }
function renderApptTable() {
  const db = loadDB(), q = (document.getElementById('apptSearch')?.value || '').toLowerCase();
  let rows = [...db.appointments].sort((a,b)=>apptFilter==='Requested'?(new Date(a.createdAt).getTime()||0)-(new Date(b.createdAt).getTime()||0):(new Date(b.createdAt).getTime()||0)-(new Date(a.createdAt).getTime()||0));
  if (apptFilter !== 'all') rows = rows.filter(r => apptFilter === 'Needs rescheduling' ? !!(UniServeUX.conflict(r)||r.rescheduleRequested||r.calendarReview) : r.status === apptFilter);
  rows = rows.filter(r => inRange(r.date ? new Date(r.date + 'T00:00:00') : r.createdAt, RANGES.appt));
  if (q) rows = rows.filter(r => r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q) || (r.visitId || '').toLowerCase().includes(q));
  document.getElementById('apptBody').innerHTML = rows.length ? rows.map((r, i) => {
    const linkedQ = r.queueId ? db.queues.find(x => x.id === r.queueId) : null;
    return `<tr><td class="row-num">${i + 1}</td>
    <td class="mono">${escapeHtml(r.visitId || '—')}${r.isSenior ? ' <span class="pill pill-gold">Senior</span>' : ''}${r.isPWD ? ' <span class="pill pill-gold">PWD</span>' : ''}${r.possibleDuplicate ? ' <span class="pill pill-warn">Dup?</span>' : ''}<div class="muted" style="font-size:.68rem;">${escapeHtml(r.code)}</div></td>
    <td>${escapeHtml(r.name)}<div class="muted" style="font-size:.72rem;">${escapeHtml(r.email || '')}</div></td>
    <td>${escapeHtml(r.service)}</td><td class="mono">${r.date ? r.date : '<span class="muted" style="font-size:.76rem;">Not set</span>'}</td><td class="mono">${r.time ? escapeHtml(UniServeUX.timeLabel(r.time)) : '&mdash;'}</td>
    <td>${readinessPillHtml(computeReadiness(findService(db, r.service), r.attachments), true)}</td>
    <td><div class="appointment-status-list">${statusPill(r.status)} ${arrivalStatusPill(r)} ${r.earlierSlotOptIn?'<span class="appointment-status-note">Earlier slot requested</span>':''} ${UniServeUX.conflict(r)||r.rescheduleRequested||r.calendarReview ? '<span class="pill pill-warn">Needs rescheduling</span>' : ''}</div></td>
    <td class="act-cell appointment-action-cell">${appointmentActionsHtml(r)}</td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="9">${db.appointments.length?'No appointments match these filters. <button type="button" class="btn btn-ghost btn-sm" onclick="resetStaffTableFilters(\'appt\')">Reset filters</button>':'No appointments yet.'}</td></tr>`;
}
function appointmentActionsHtml(r){
  if(r.restricted)return '<span class="muted">Confidential access required</span>';
  const buttons=[`<button class="btn btn-ghost btn-sm" onclick="openApptDetail('${r.id}',false,true)">View details</button>`, `<button class="btn btn-ghost btn-sm" onclick="printAppointmentRecord('${r.id}')">Print record</button>`];
  const editable=['Requested','Booked','No-show','Unfinished'].includes(r.status);
  if(r.shared&&['Requested','Booked'].includes(r.status)&&r.attachments?.length)buttons.push(`<button class="btn btn-ghost btn-sm" onclick="reviewAppointmentRequirements('${r.id}')">Review requirements</button>`);
  if(editable&&r.status==='Requested')buttons.push(`<button class="btn btn-ghost btn-sm" onclick="openApptDetail('${r.id}',true)">Review request</button>`);
  if(editable&&r.status==='Booked'){
    buttons.push(`<button class="btn btn-ghost btn-sm" onclick="openApptDetail('${r.id}',true)">Reschedule</button>`);
  }
  if(editable&&['No-show','Unfinished'].includes(r.status))buttons.push(`<button class="btn btn-ghost btn-sm" onclick="openApptDetail('${r.id}',true)">Reschedule</button>`);
  if(r.queueId)buttons.push(`<button class="btn btn-ghost btn-sm" onclick="openAppointmentVisit('${r.id}')">View visit</button>`);
  if(r.shared&&(r.date||r.status==='Cancelled'))buttons.push(`<button class="btn btn-ghost btn-sm" onclick="UniServeUX.notificationStatus(loadDB().appointments.find(a=>a.id==='${r.id}'))">Email details</button>`);
  if(r.shared&&editable)buttons.push(`<button class="btn btn-danger-o btn-sm" onclick="cancelSharedAppointment('${r.id}')">Cancel</button>`);
  const mainIndex=buttons.findIndex(button=>button.includes('btn-primary'));
  const main=mainIndex<0?'':buttons.splice(mainIndex,1)[0];
  const items=buttons.map(button=>button.replace(/class="btn btn-[^"]+"/,button.includes('btn-danger-o')?'class="kebab-item appointment-cancel-item"':'class="kebab-item"').replace('onclick="','onclick="closeKebabs(); '));
  return `${main}<button class="icon-btn kebab-btn" title="Appointment actions" aria-label="Appointment actions" aria-haspopup="true" onclick="toggleKebab(event,'appt_${r.id}')">${icon('dots',16)}</button><div class="kebab-menu" id="kebab_appt_${r.id}" hidden>${items.join('')}</div>`;
}
function reviewAppointmentRequirements(id){
  const appointment=loadDB().appointments.find(record=>record.id===id);
  if(!appointment)return;
  if(appointment.restricted){toast('Confidential access required.','err');return;}
  const editable=appointment.shared&&['Requested','Booked'].includes(appointment.status);
  openModal('Review requirements',`<div class="appointment-detail-panel"><p class="field-hint">${escapeHtml(appointment.name)} &middot; ${escapeHtml(appointment.service)}<br>Open each file to check it, choose a review result, then save the review for that file.</p>${appointment.attachments?.length?documentReviewHtml(appointment,editable):'<p class="field-hint">No requirements uploaded.</p>'}</div>`,[]);
}
async function openAppointmentVisit(id){
  try{await loadSharedQueue();const appointment=loadDB().appointments.find(a=>a.id===id),queue=loadDB().queues.find(q=>q.id===appointment?.queueId);if(queue)openQueueVisitDetail(queue.id);else openApptDetail(id,false,true);}catch(error){toast(escapeHtml(error.message),'err');}
}
function openApptDetail(id, editSchedule = false, viewOnly = false) {
  const db = loadDB(), r = db.appointments.find(x => x.id === id);
  if (!r) return;
  const inQueue = !!r.queueId && ['Checked-in','Completed','Cancelled'].includes(r.status), canSetSchedule = !inQueue && ['Requested','Booked','No-show','Unfinished'].includes(r.status);
  const showSchedule = !viewOnly && canSetSchedule && (['Requested','No-show','Unfinished'].includes(r.status) || editSchedule);
  const canCheckIn = !inQueue && r.status === 'Booked' && r.date === today() && OfficeCalendar.status().open && !UniServeUX.conflict(r);
  const readiness = computeReadiness(findService(db, r.service), r.attachments), arrival = canCheckIn ? evaluateArrival(db, r) : null;
  const scheduleBody=showSchedule?`
    <div class="reschedule-editor">
      <div class="reschedule-visitor"><strong>${escapeHtml(r.name)}</strong><span>${escapeHtml(r.service)} &middot; ${escapeHtml(r.office||'Office of Student Services')}</span><small>${escapeHtml(r.visitId||r.code||'')}</small></div>
      <div class="reschedule-current"><span>${r.status==='Requested'?'Requested schedule':'Current schedule'}</span><strong>${r.date?escapeHtml(r.date)+' &middot; '+escapeHtml(UniServeUX.timeLabel(r.time)):'Not scheduled'}</strong></div>
      ${UniServeUX.conflict(r)?'<p class="reschedule-notice" role="note">'+escapeHtml(UniServeUX.conflict(r))+'</p>':''}
      ${r.rescheduleRequested?'<p class="reschedule-notice"><strong>Visitor requested a change</strong><span>'+escapeHtml(r.rescheduleReason||'Please arrange another visit.')+'</span></p>':''}
      ${r.preferredDate?'<p class="reschedule-preference">Preferred date: '+escapeHtml(r.preferredDate)+'</p>':''}
      <section class="reschedule-fields"><h4>${r.status==='Requested'?'Choose a schedule':'New schedule'}</h4><div class="form-row">
        <div class="field"><label for="mApptDate">Date</label><input onchange="refreshStaffAppointmentSlots()" id="mApptDate" type="date" value="${r.date||''}" min="${today()}"></div>
        <div class="field" hidden><label for="mApptTime">Time</label><select id="mApptTime" data-appointment-id="${escapeHtml(r.id)}" data-office="${escapeHtml(r.office||'Office of Student Services')}" data-current="${escapeHtml(UniServeUX.appointmentTime(r.time)||'')}" disabled><option value="">Loading slots...</option></select></div>
      </div><div id="staffSlotChoices" class="staff-slot-choices"><p class="field-hint" role="status">Choose a date to see appointment times.</p></div><p id="calendarApptWarning" role="alert" class="field-hint"></p></section>
      <p class="reschedule-help">Choose a time during office hours. The visitor will receive the confirmed schedule by email.</p>
    </div>`:'';
  openModal(showSchedule ? (r.status === 'Requested' ? 'Approve or reschedule request' : 'Reschedule appointment') : 'Appointment details', showSchedule ? scheduleBody : `
    <div class="appointment-detail-panel record-detail-clean">
    ${UniServeUX.conflict(r) ? `<div class="alert-banner warn"><b>Needs rescheduling</b>${escapeHtml(UniServeUX.conflict(r))}. Set a new date and time below.</div>` : ''}
    ${r.rescheduleRequested ? `<div class="info-banner warn"><b>New schedule requested</b><p>${escapeHtml(r.rescheduleReason||'Please arrange another visit.')}</p></div>` : ''}
    ${r.possibleDuplicate ? `<div class="dup-warn">${icon('alert', 13)} Flagged as a possible duplicate active visit for this ID number or Gmail and service.</div>` : ''}
    ${arrival && arrival.status !== 'OnTime' ? `<div class="alert-banner ${arrival.status === 'PastWindow' ? 'danger' : 'warn'}"><b>${icon('alert', 13)} ${arrival.status === 'PastWindow' ? 'Past Appointment Window' : 'Late Arrival'}</b>Scheduled time has passed by ${fmtMinutes(arrival.lateMinutes)}${arrival.status === 'PastWindow' ? ' — beyond the configured no-show threshold.' : ', still within the no-show threshold.'}</div>` : ''}
    <div class="appointment-detail-identity"><div><strong>${escapeHtml(r.name || 'Visitor')}</strong><span class="mono">${escapeHtml(r.visitId || r.code || r.id)}</span></div><div class="appointment-detail-status">${statusPill(r.status)} ${arrivalStatusPill(r)}</div></div><section class="appointment-summary"><h4>Visitor details</h4><div class="appointment-summary-grid">
    <div class="kv"><span>Reference Code</span><span class="mono">${escapeHtml(r.code)}</span></div>
    <div class="kv"><span>Visitor type</span><span>${escapeHtml(r.guestClass ? `${r.type}, ${r.guestClass}` : r.type)}</span></div>
    ${r.idNumber ? `<div class="kv"><span>${r.idType ? escapeHtml(r.idType) : 'ID Number'}</span><span>${escapeHtml(r.idNumber)}</span></div>` : `<div class="kv"><span>ID Type</span><span>${escapeHtml(r.idType || '—')}</span></div>`}
    <div class="kv"><span>Contact</span><span>${escapeHtml(r.contact || '—')}</span></div>
    <div class="kv"><span>Email</span><span>${escapeHtml(r.email || '—')}</span></div>
    </div></section><section class="appointment-summary"><h4>Service details</h4><div class="appointment-summary-grid"><div class="kv"><span>Office</span><span>${escapeHtml(r.office||'Office of Student Services')}</span></div><div class="kv"><span>Service</span><span>${escapeHtml(r.service)}</span></div>
    <div class="kv"><span>Appointment</span><span>${r.date ? `${r.date} &middot; ${escapeHtml(UniServeUX.timeLabel(r.time))}` : 'Not yet set'}</span></div>
    ${r.preferredDate ? `<div class="kv"><span>Preferred date</span><span>${escapeHtml(r.preferredDate)}</span></div>` : ''}
    <div class="kv"><span>Readiness</span><span>${readinessPillHtml(readiness)}</span></div>
    <div class="kv"><span>Requested</span><span>${r.createdAt ? fmtDateTime(r.createdAt) : '&mdash;'}</span></div>
    ${r.isSenior ? `<div class="kv"><span>Priority</span><span><span class="pill pill-gold">Senior Citizen</span></span></div>` : ''}
    ${r.isPWD ? '<div class="kv"><span>Priority</span><span><span class="pill pill-gold">Person with disability</span></span></div>' : ''}
    </div></section>

    ${canCheckIn && !showSchedule ? '<p class="field-hint">Check in only after the visitor arrives at the OSS counter. This adds the appointment to the waiting queue.</p>' : ''}
    ${r.status === 'Booked' && !canCheckIn && !showSchedule ? '<p class="field-hint">Check-in is available at the counter on the appointment day during office hours.</p>' : ''}
    ${showSchedule ? `<section class="appointment-schedule-section"><h4>Choose a schedule</h4><p class="field-hint">Select an available date and time for this visit.</p><div class="form-row">
      <div class="field"><label for="mApptDate">Date</label><input onchange="calendarAppointmentWarning()" id="mApptDate" type="date" value="${r.date || ''}" min="${today()}"></div>
      <div class="field"><label for="mApptTime">Time</label><input onchange="calendarAppointmentWarning()" id="mApptTime" type="time" value="${UniServeUX.appointmentTime(r.time) || '09:00'}"></div></div>
      <p id="calendarApptWarning" role="alert" class="field-hint"></p></section>` : ''}
    <h4 class="staff-detail-heading">Documents</h4>${r.attachments?.length ? documentReviewHtml(r, !viewOnly) : '<p class="field-hint">No requirements uploaded.</p>'}
    <h4 class="staff-detail-heading">History and follow-up</h4><div class="appointment-detail-extras">${r.scheduleHistory?.length ? `<details class="schedule-history"><summary><span>Previous schedules</span><span class="schedule-history-count">${r.scheduleHistory.length}</span><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg></summary><ol>${r.scheduleHistory.map(s=>`<li><div class="schedule-history-details"><span class="schedule-history-date">${escapeHtml(s.date||'Not yet scheduled')}${s.time ? ` &middot; ${escapeHtml(UniServeUX.timeLabel(s.time))}` : ''}</span>${s.changedAt ? `<span class="schedule-history-updated">Updated ${escapeHtml(String(fmtDateTime(s.changedAt)).replace(/&middot;/g,String.fromCharCode(183)))}</span>` : ''}</div><span class="schedule-history-status">${escapeHtml(s.status||'Previous')}</span></li>`).join('')}</ol></details>` : ''}${visitExtrasHtml(r,true)}</div></div>`, [
    ...(canCheckIn&&!showSchedule&&!viewOnly ? [{label:'Check in',cls:'btn-primary',action:()=>adminCheckInAppointment(r.id)}] : []),
    ...(inQueue&&r.status==='Checked-in'&&!viewOnly ? [{label:'Open queue',cls:'btn-primary',action:()=>{closeModal();navigate('queue');}}] : []),
    ...(showSchedule ? [{ label: r.status==='Requested'?'Approve schedule':'Save new schedule', cls: 'btn-primary', action: async () => {
      const dateVal = document.getElementById('mApptDate').value, timeVal = document.getElementById('mApptTime').value;
      if (!dateVal || !timeVal) { toast('Please set both a date and a time.', 'err'); return; }
      if (!await OfficeCalendar.refresh()) {toast('Cannot verify office hours. Please try again.', 'err'); return;}
      const availability = OfficeCalendar.at(dateVal, timeVal);
      if (!availability.open) {toast(escapeHtml(availability.reason) + '. Choose an open time outside lunch.', 'err'); return;}
      const appointment = loadDB().appointments.find(x => x.id === id);
      if (!appointment.shared) {toast('This legacy request must be migrated before scheduling.', 'err');return;}
      try {
        const result=await SharedAppointments.request('/appointments/'+encodeURIComponent(id),'PATCH',{date:dateVal,time:timeVal,revision:appointment.revision});
        SharedAppointments.cache(result);closeModal();await renderAppointments(true);toast('Visit booked. Confirmation and reminder emails queued.','ok');
      }catch(error){
        if(error.status===409){
          try{SharedAppointments.cache(await SharedAppointments.request('/appointments/visit/'+encodeURIComponent(id)));}catch(_){}
          const timeInput=document.getElementById('mApptTime');if(timeInput)timeInput.dataset.current='';
          await refreshStaffAppointmentSlots();
          const notice=document.getElementById('calendarApptWarning');if(notice)notice.textContent='The appointment or slot availability changed. Review the refreshed times and choose again. Your changes were not saved.';
        }
        toast(escapeHtml(error.message),'err');
      }
    } }] : [])]);
  if(showSchedule)refreshStaffAppointmentSlots();
}

async function printAppointmentRecord(id, unlocked=false) {
  try {
    let r=loadDB().appointments.find(record=>record.id===id);
    if(!r){toast('This appointment is unavailable.','err');return;}
    if(isConfidentialTxn({...r,service:r.serviceKey||r.service})&&!unlocked){
      const linked=loadDB().transactions.find(t=>t.visitId===r.visitId&&isConfidentialTxn(t));
      if(linked)return requireConfUnlock(linked,()=>printAppointmentRecord(id,true),'print');
      openModal('Unlock appointment printing','<div class="field"><label for="appointmentPrintPassword">Your password</label><input id="appointmentPrintPassword" type="password" autocomplete="current-password"></div>',[{label:'Unlock and print',cls:'btn-primary',action:async()=>{try{await SharedAppointments.request('/confidential/cases/'+encodeURIComponent('apt:'+id)+'/unlock','POST',{password:document.getElementById('appointmentPrintPassword').value,reason:'Print appointment record',scope:'print'});closeModal();await printAppointmentRecord(id,true);}catch(error){toast(error.message,'err');}}}]);return;
    }
    if(r.shared){const result=await SharedAppointments.request('/report-data','POST',{kind:'appointment',id,includeConf:isConfidentialTxn({...r,service:r.serviceKey||r.service})});r=result.appointments[0];}
    if(!r||r.restricted){toast('This appointment is unavailable or requires confidential access.','err');return;}
    const rows=items=>items.map(([label,value])=>'<tr><th>'+escapeHtml(label)+'</th><td>'+escapeHtml(String(value??'?'))+'</td></tr>').join('');
    const columns='<colgroup><col style="width:32%"><col style="width:68%"></colgroup>';
    printInjected(reportLetterhead()+'<div class="doc-title-block"><h2>Appointment Record</h2></div>'+
      '<table class="doc-form-table"><caption>I. Visitor details</caption>'+columns+rows([['Name',r.name],['Visitor type',r.type],['ID number',r.idNumber],['Contact',r.contact],['Email',r.email]])+'</table>'+
      '<table class="doc-form-table"><caption>II. Appointment details</caption>'+columns+rows([['Visit ID',r.visitId],['Request reference',r.code||r.requestReference],['Office',r.office||'Office of Student Services'],['Service',r.service],['Date',r.date||'Not scheduled'],['Time',r.time?UniServeUX.timeLabel(r.time):'Not scheduled'],['Status',r.status],['Requested',r.createdAt?String(fmtDateTime(r.createdAt)).replace(/&middot;/g,' ? '):'?']])+'</table>'+
      '<table class="doc-form-table"><caption>III. Supporting documents</caption>'+columns+rows((r.attachments||[]).length?r.attachments.map((file,index)=>['Document '+(index+1),file.name]):[['Documents','No documents uploaded']])+'</table>'+
      (r.scheduleHistory?.length?'<table class="doc-form-table"><caption>IV. Schedule history</caption>'+columns+rows(r.scheduleHistory.map((entry,index)=>['Previous schedule '+(index+1),(entry.date||'Not scheduled')+(entry.time?' ? '+UniServeUX.timeLabel(entry.time):'')+' ? '+(entry.status||'')]))+'</table>':'')+
      '<p class="doc-footnote">Printed '+escapeHtml(String(fmtDateTime(new Date())).replace(/&middot;/g,' ? '))+'</p>');
  } catch(error){toast(error.message||'Could not print the appointment record. Please try again.','err');}
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
function logIdentity(db, r) {
  if(r.restricted)return '';
  if(r.type==='Student')return r.idNumber||'';
  if(r.idType)return r.idType;
  const queue=db.queues.find(q=>r.visitId&&q.visitId===r.visitId&&!q.restricted);
  return queue?.idType||'';
}
function renderVisitorLogbook(keep) {
  const db = loadDB(), prev = keep ? (document.getElementById('logSearch')?.value || '') : '';
  const rows = logbookRows(db, false), inside = rows.filter(r => !r.timeOut).length;
  const visitDurations = rows.filter(r => r.timeOut).map(r => (new Date(r.timeOut) - new Date(r.timeIn)) / 60000).filter(m => Number.isFinite(m) && m >= 0);
  const averageDuration = visitDurations.length ? visitDurations.reduce((sum, m) => sum + m, 0) / visitDurations.length : null;
  document.getElementById('content').innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="lbl">Logged</div><div class="val">${rows.length}</div></div>
      <div class="stat-card"><div class="lbl">Currently Inside</div><div class="val">${inside}</div></div>
      <div class="stat-card"><div class="lbl">Checked Out</div><div class="val">${rows.length - inside}</div></div>
      <div class="stat-card"><div class="lbl">Average Visit Duration</div><div class="val">${fmtCompactMinutes(averageDuration)}</div></div>
    </div>
    <div class="card visitor-log-card"><div class="card-head"><div><h3>Visitor Log</h3><div class="desc">${escapeHtml(rangeLabel(RANGES.log))}</div></div>
      <div class="toolbar"><button class="btn btn-primary btn-sm" onclick="printVisitorLog()">${icon('print', 14)} Print report</button>
        <button class="btn btn-ghost btn-sm" onclick="downloadLogbook()">${icon('download', 14)} Download CSV</button></div></div>
      <div class="filter-bar">${dateRangeHtml('log')}<div class="search-box">${icon('search', 15)}<input id="logSearch" placeholder="Name, student number, ID type or Gmail" value="${escapeHtml(prev)}" oninput="renderLogbookTable()"></div></div>
      <div class="table-wrap visitor-log-table-wrap"><table class="visitor-log-table"><thead><tr><th>#</th><th>Name</th><th>Type</th><th>Entry</th><th>Student Number</th><th>ID Type</th><th>Contact</th><th>Gmail</th><th>Purpose</th><th>Date</th><th>Time In</th><th>Time Out</th></tr></thead><tbody id="logBody"></tbody></table></div></div>`;
  organizeStaffToolbar('logSearch');
  renderLogbookTable();
}
function logbookRows(db, ascending) {
  return [...db.visitorLog].sort((a, b) => ascending ? a.timeIn - b.timeIn : b.timeIn - a.timeIn).filter(r => inRange(r.timeIn, RANGES.log));
}
function renderLogbookTable() {
  const db = loadDB(), q = (document.getElementById('logSearch')?.value || '').toLowerCase();
  let rows = logbookRows(db, false);
  if (q) rows = rows.filter(r => r.name.toLowerCase().includes(q) || logIdentity(db, r).toLowerCase().includes(q) || logEmail(db, r).toLowerCase().includes(q));
  document.getElementById('logBody').innerHTML = rows.length ? rows.map((r, i) => `<tr><td class="row-num">${i + 1}</td>
    <td>${escapeHtml(r.name)}${r.restricted?'<div class="log-restricted-action">'+(r.confidentialCaseId?'<button type="button" class="log-unlock-link" data-case-id="'+escapeHtml(r.confidentialCaseId)+'" onclick="unlockVisitorLogEntry(this.dataset.caseId)">'+(currentUser.confidentialApprover?'Unlock':'Request access')+'</button>':'')+'</div>':''}${r.visitId ? `<div class="muted mono" style="font-size:.68rem;">${escapeHtml(r.visitId)}</div>` : ''}</td><td>${escapeHtml(r.type)}</td>
    <td>${r.source === 'Appointment' ? '<span class="pill pill-info">Scheduled</span>' : '<span class="pill pill-gold">Walk-in</span>'}</td>
    <td class="mono">${r.type === 'Student' && r.idNumber ? escapeHtml(r.idNumber) : '&mdash;'}</td><td>${r.type !== 'Student' && logIdentity(db, r) ? escapeHtml(logIdentity(db, r)) : '&mdash;'}</td><td class="mono">${logContact(db, r) ? escapeHtml(logContact(db, r)) : '&mdash;'}</td><td class="mono" style="overflow-wrap:anywhere;">${logEmail(db, r) ? escapeHtml(logEmail(db, r)) : '&mdash;'}</td><td>${r.purpose ? escapeHtml(r.purpose) : '&mdash;'}</td>
    <td class="mono log-timestamp">${fmtDate(r.timeIn)}</td><td class="mono log-timestamp">${fmtTime(r.timeIn)}</td><td class="mono log-timestamp">${r.timeOut ? fmtTime(r.timeOut) : '&mdash;'}</td></tr>`).join('') : `<tr class="empty-row"><td colspan="12">${db.visitorLog.length?'No visitor entries match these filters.':'No visitor entries logged yet.'}</td></tr>`;
}
function downloadLogbook() {
  if (!reportOutputActive) return authorizedReportOutput({kind:'logbook',includeConf:false},downloadLogbook);
  const db = loadDB(), rows = logbookRows(db, true);
  downloadCSV(`Visitor_Logbook_${RANGES.log.from || 'start'}_${RANGES.log.to || 'all'}.csv`, [
    ['Visit ID', 'Name', 'Type', 'Student Number', 'ID Type', 'Contact', 'Gmail', 'Queue No.', 'Entry Method', 'Purpose', 'Date', 'Time In', 'Time Out'],
    ...rows.map(r => [r.visitId || '', r.name, r.type, r.type === 'Student' ? r.idNumber || '' : '', r.type !== 'Student' ? logIdentity(db, r) : '', logContact(db, r), logEmail(db, r), queueNumberForVisit(db, r.visitId), r.source || 'Walk-in', r.purpose || '', fmtDate(r.timeIn), fmtTime(r.timeIn), r.timeOut ? fmtTime(r.timeOut) : '']),
  ]);
  logActivity(db, currentUser, 'Downloaded visitor log'); saveDB(db);
  toast('Logbook downloaded.', 'ok');
}
function printVisitorLog(includeConf=false) {
  if (!reportOutputActive) return authorizedReportOutput({kind:'logbook',includeConf:!!includeConf},()=>printVisitorLogSnapshot(includeConf));
  return printVisitorLogSnapshot(includeConf);
}
function printVisitorLogSnapshot(includeConf=false) {
  const auditDb=loadDB();logActivity(auditDb,currentUser,'Opened visitor log print report',{category:'Data'});saveDB(auditDb);
  const db = loadDB(), sourceRows = logbookRows(db, true), rows=sourceRows.map(r=>r.confidentialCaseId&&!includeConf?{id:r.id,timeIn:r.timeIn,timeOut:r.timeOut,name:'Restricted record',type:'',restricted:true}:r);
  const period = escapeHtml(rangeLabel(RANGES.log));
  const total = rows.length, inside = rows.filter(r => !r.timeOut).length, appts = rows.filter(r => r.source === 'Appointment').length;
  printInjected(`${reportLetterhead()}
    <div class="report-title-block"><h2>Visitor Logbook Report</h2><div class="report-meta"><span>Period: ${period}</span><span>Generated: ${fmtDateTime(new Date())} by ${escapeHtml(currentUser.fullName)}</span></div></div>
    ${sourceRows.some(r=>r.confidentialCaseId||r.restricted)?'<p class="doc-footnote"><strong>Confidential access: '+(includeConf?'Unlocked for authorized printing.':'Locked. Confidential identities and details are excluded.')+'</strong></p>':''}
    <div class="rpt-section"><h3 class="rpt-h">Summary</h3><div class="stat-grid rpt-stat-grid">
      <div class="rpt-stat"><div class="rpt-stat-lbl">Total Entries</div><div class="rpt-stat-val">${total}</div></div>
      <div class="rpt-stat"><div class="rpt-stat-lbl">Currently Inside</div><div class="rpt-stat-val">${inside}</div></div>
      <div class="rpt-stat"><div class="rpt-stat-lbl">Checked Out</div><div class="rpt-stat-val">${total - inside}</div></div>
      <div class="rpt-stat"><div class="rpt-stat-lbl">Walk-in / Sched.</div><div class="rpt-stat-val" style="font-size:1.15rem;">${total - appts} / ${appts}</div></div></div></div>
    <div class="rpt-section"><h3 class="rpt-h">Visitor Entries</h3><div class="rpt-desc">${total} record${total === 1 ? '' : 's'} &mdash; ${period}, sorted by Time In</div>
      <div class="rpt-table-wrap"><table class="rpt-table">

        <thead><tr><th>#</th><th>Visit ID</th><th>Name</th><th>Type</th><th>Student Number</th><th>ID Type</th><th>Contact</th><th>Gmail</th><th>Queue No.</th><th>Entry</th><th>Purpose</th><th>Date</th><th>Time In</th><th>Time Out</th></tr></thead>
        <tbody>${rows.length ? rows.map((r, i) => `<tr><td class="mono">${i + 1}</td><td class="mono">${escapeHtml(r.visitId || '—')}</td><td>${escapeHtml(r.name)}</td><td class="nw">${escapeHtml(r.type || '—')}</td><td class="mono">${r.type === 'Student' && r.idNumber ? escapeHtml(r.idNumber) : '&mdash;'}</td><td>${r.type !== 'Student' && logIdentity(db, r) ? escapeHtml(logIdentity(db, r)) : '&mdash;'}</td><td class="mono">${logContact(db, r) ? escapeHtml(logContact(db, r)) : '&mdash;'}</td><td class="mono" style="overflow-wrap:anywhere;">${logEmail(db, r) ? escapeHtml(logEmail(db, r)) : '&mdash;'}</td><td class="mono nw">${escapeHtml(queueNumberForVisit(db, r.visitId) || '—')}</td><td class="nw">${r.source === 'Appointment' ? 'Scheduled' : 'Walk-in'}</td><td>${r.purpose ? escapeHtml(r.purpose) : '&mdash;'}</td><td class="mono nw">${fmtDate(r.timeIn)}</td><td class="mono nw">${fmtTime(r.timeIn)}</td><td class="mono nw">${r.timeOut ? fmtTime(r.timeOut) : '&mdash;'}</td></tr>`).join('') : `<tr class="empty-row"><td colspan="14">No visitor entries recorded for this period.</td></tr>`}</tbody></table></div></div>
    ${reportSignatureBlock()}`);
}

let activeStaffChatId = null, pendingStaffAttachments = [], messagesPollTimer = null;
function renderMessages() {
  document.getElementById('content').innerHTML = `<div class="staff-messages">
    <div class="chat-shell"><div class="chat-thread-list" id="chatThreadList"><div class="thread-list-head"><span class="lbl">Chats</span></div><div class="thread-search"><input id="chatCodeSearch" aria-label="Search conversations by name" placeholder="Search chats" autocomplete="off" oninput="renderChatThreadList()"></div><div id="chatThreadBody"></div></div><div class="chat-panel" id="chatPanel">${emptyChatPanel()}</div></div></div>`;
  renderChatThreadList();
  startMessagesPolling();
}
function emptyChatPanel() { return `<div class="staff-chat-empty">${icon('chat', 26)}<h4>Your conversations</h4><p>Select a conversation to read and reply.</p></div>`; }
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
const chatRef = c => c.email || c.visitId || 'General inquiry';
function renderChatThreadList() {
  const db = loadDB(), body = document.getElementById('chatThreadBody');
  if (!body) return;
  const q = (document.getElementById('chatCodeSearch')?.value || '').trim().toLowerCase();
  let rows = [...db.chats].sort((a, b) => b.updatedAt - a.updatedAt);
  if (q) rows = rows.filter(c => String(c.visitorName || '').toLowerCase().includes(q));
  body.innerHTML = rows.length ? rows.map(c => {
    const last = c.messages[c.messages.length - 1];
    return `<div class="chat-thread-item ${activeStaffChatId === c.id ? 'active' : ''}" style="cursor:pointer;" onclick="openStaffChat('${c.id}')">
      <span class="staff-thread-avatar" aria-hidden="true">${escapeHtml((c.visitorName||'Visitor').trim().split(/\s+/).map(part=>part[0]).slice(0,2).join('').toUpperCase())}</span>
      <div class="ttl"><span class="thread-identity"><span class="thread-name">${escapeHtml(c.visitorName || 'Visitor')}</span><span class="thread-contact muted" title="${escapeHtml(chatRef(c))}">${escapeHtml(chatRef(c))}</span></span><span class="thread-actions">${c.staffUnread ? '<span class="unread-dot"></span>' : ''}<button class="icon-btn" title="Delete conversation" onclick="event.stopPropagation(); removeChatThread('${c.id}')">${icon('trash', 13)}</button></span></div>
      <div class="meta-row"><div class="prev">${last ? escapeHtml(last.text) : 'No messages yet'}</div>${statusPill(c.status)}</div></div>`;
  }).join('') : `<div class="helper-empty" style="padding:40px 16px;"><p>${q ? 'No conversations match your search. Try another name.' : 'No conversations yet. New visitor messages will appear here.'}</p></div>`;
}


function openStaffChat(id) {
  activeStaffChatId = id; pendingStaffAttachments = [];
  const db = loadDB(), c = db.chats.find(x => x.id === id);
  if (!c) return;
  c.staffUnread = 0; saveDB(db);
  renderChatThreadList(); renderSidebar();
  document.querySelector('.staff-messages')?.classList.add('conversation-open');
  const closed = c.status === 'Closed';
  document.getElementById('chatPanel').innerHTML = `
    <div class="chat-panel-head"><button type="button" class="staff-chat-back" aria-label="Back to conversations" onclick="document.querySelector('.staff-messages').classList.remove('conversation-open')"><span>Back</span></button><span class="staff-chat-header-avatar" aria-hidden="true">${escapeHtml((c.visitorName||'Visitor').trim().split(/\s+/).map(part=>part[0]).slice(0,2).join('').toUpperCase())}</span><div class="staff-chat-person"><div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;"><b class="staff-chat-name">${escapeHtml(c.visitorName || 'Visitor')}</b>${c.visitId ? `<button class="btn btn-ghost btn-sm" onclick="copyText('${escapeHtml(c.visitId)}')">Copy Visit ID</button>` : ''}</div>
      <div class="muted" style="font-size:.76rem; margin-top:3px;">${escapeHtml(c.visitorName || 'Visitor')}${c.visitorType ? ' &middot; ' + escapeHtml(c.visitorType) : ''}${c.contact ? ' &middot; ' + escapeHtml(c.contact) : ''}${c.email ? ' &middot; ' + escapeHtml(c.email) : ''}</div>
      ${c.messages.some(m => m.sender === 'visitor') ? '' : `<div class="field-hint" style="margin-top:4px;">The visitor opens this chat in the portal with their Visit ID.</div>`}</div>
      <div class="chat-status-toggle"><button class="cst-btn ok ${c.status === 'Open' ? 'active' : ''}" onclick="setChatStatus('${c.id}','Open')">${icon('check', 12)}<span>Open</span></button><button class="cst-btn danger ${closed ? 'active' : ''}" onclick="setChatStatus('${c.id}','Closed')">${icon('x', 12)}<span>Closed</span></button></div></div>
    <div class="chat-messages" id="chatMsgArea">${renderBubbles(c)}</div>
    <div id="staffAttachPreview" style="padding:${closed ? '0' : '10px 18px 0'};"></div>
    <div class="chat-input-row">
      <input type="file" id="staffAttachInput" multiple style="display:none" onchange="handleStaffFileSelect(this)" ${closed ? 'disabled' : ''}>
      <button class="icon-btn" title="Attach files" onclick="document.getElementById('staffAttachInput').click()" ${closed ? 'disabled' : ''}>${icon('paperclip', 16)}</button>
      <textarea id="staffReplyBox" aria-label="Message" rows="1" placeholder="${closed ? 'Conversation is closed' : 'Aa'}" ${closed ? 'disabled' : ''}></textarea>
      <button type="button" class="staff-chat-send" aria-label="Send message" title="Send message" onclick="sendStaffReply('${c.id}')" ${closed ? 'disabled' : ''}><svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 3.8a.8.8 0 0 1 1.1-.7l17 8.2a.8.8 0 0 1 0 1.4l-17 8.2a.8.8 0 0 1-1.1-.7l1.5-6.7L14 12l-9.5-1.5Z"/></svg></button></div>`;
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
const confUnlocked = new Map(), confTimers = {};
function isConfidentialTxn(t) { return !!t && (loadDB().services.find(s=>s.key===t.service)?.confidential ?? CONFIDENTIAL_SERVICES.includes(t.service)); }
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
  if (state_view === 'logbook') renderVisitorLogbook(true);
}
function maskName(name) {
  const p = String(name || '').trim().split(/\s+/).filter(Boolean);
  return p.length < 2 ? (p[0] || '—') : `${p[0]} ${p[p.length - 1][0].toUpperCase()}.`;
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
function renderTransactions() { txnFilter = staffViewMemory.transactions?.txnFilter || 'all'; renderTxnCard(false); }
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
      <div class="table-wrap"><table><thead><tr><th>#</th><th>Code</th><th>Requestor</th>${txnServiceFilter ? '' : '<th>Service</th>'}<th>Visit</th><th>Files</th><th>Status</th><th>Logged</th><th class="appointment-action-heading">Actions</th></tr></thead><tbody id="txnBody"></tbody></table></div></div>`;
  organizeStaffToolbar('txnSearch');
  renderTxnTable();
}
function setTxnService(key) { txnServiceFilter = key || undefined; txnFilter = 'all'; renderTxnCard(true); }
function setTxnFilter(f) { txnFilter = f; document.querySelectorAll('#txnStatusNav button').forEach(b => b.classList.toggle('active', b.dataset.f === f)); renderTxnTable(); }
function renderTxnTable() {
  const body = document.getElementById('txnBody');
  if (!body) return;
  const db = loadDB(), q = (document.getElementById('txnSearch')?.value || '').toLowerCase(), showService = !txnServiceFilter;
  let rows = [...txnScope(db)].sort((a, b) => b.createdAt - a.createdAt);
  if (txnFilter !== 'all') rows = rows.filter(r => r.status === txnFilter);
  if (q) rows = rows.filter(r => isTxnLocked(r) ? r.code.toLowerCase().includes(q) : (r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q) || (r.visitId || '').toLowerCase().includes(q)));
  body.innerHTML = rows.length ? rows.map((r, i) => {
    const locked = isTxnLocked(r), files = txnRequirements(db, r);
    return `<tr><td class="row-num">${i + 1}</td>
    <td class="mono">${r.code}${isConfidentialTxn(r) ? ` <span class="tag-lock">${icon('lock', 10)}</span>` : ''}</td>
    <td>${locked ? `${escapeHtml(maskName(r.name))}<div class="muted" style="font-size:.72rem;">Confidential</div>` : `${escapeHtml(r.name)}<div class="muted" style="font-size:.72rem;">${escapeHtml(r.idNumber || '')} ${r.section ? '&middot; ' + escapeHtml(r.section) : ''}</div>`}</td>
    ${showService ? `<td>${serviceLabel(db, r.service)}</td>` : ''}
    <td>${locked ? '<span class="muted" style="font-size:.76rem;">Hidden</span>' : (r.visitId ? `<span class="mono" style="font-size:.72rem;">${escapeHtml(r.visitId)}</span>${r.queueNumber ? `<div class="muted" style="font-size:.68rem;">${escapeHtml(r.queueNumber)} &middot; ${escapeHtml(r.entryMethod || '')}</div>` : (r.entryMethod ? `<div class="muted" style="font-size:.68rem;">${escapeHtml(r.entryMethod)}</div>` : '')}` : '<span class="muted" style="font-size:.76rem;">&mdash;</span>')}</td>
    <td>${locked ? '<span class="muted" style="font-size:.76rem;">&bull;&bull;</span>' : (files.length ? `<span class="pill pill-gold">${icon('paperclip', 11)} ${files.length}</span>` : '<span class="muted" style="font-size:.76rem;">&mdash;</span>')}</td>
    <td>${statusPill(r.status)} ${escalationPill(r.escalation)}</td><td class="muted">${fmtDateTime(r.createdAt)}</td>
    <td class="act-cell appointment-action-cell"><button class="icon-btn kebab-btn" title="Actions" aria-haspopup="true" onclick="toggleKebab(event,'${r.id}')">${icon('dots', 16)}</button>
      <div class="kebab-menu" id="kebab_${r.id}" hidden>
        ${isConfidentialTxn(r)&&!currentUser.confidentialApprover&&!(window.isAssignedConfidentialRecord?.(r.id)) ? `<button class="kebab-item" onclick="closeKebabs();requestTransactionAccess('${r.id}')">Request access</button>` : `<button class="kebab-item" onclick="closeKebabs();openTxnDetail('${r.id}')">${icon('eye',14)} View</button><button class="kebab-item" onclick="closeKebabs();printTransaction('${r.id}')">${icon('print',14)} Print report</button>`}</div></td></tr>`;
  }).join('') : `<tr class="empty-row"><td colspan="${showService ? 9 : 8}">${db.transactions.length?'No transactions match these filters. <button type="button" class="btn btn-ghost btn-sm" onclick="resetStaffTableFilters(\'txn\')">Reset filters</button>':'No transactions yet.'}</td></tr>`;
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
  const files = txnRequirements(db, r), isVisit = !!(linkedQueue || r.visitId), canEscalate = r.permissions?.editCase===true && ESCALATABLE_SERVICES.includes(r.service);
  const buttons = [
    ...(sensitive ? [{ label: 'Lock Again', cls: 'btn-ghost', action: () => { lockConfTxn(id); toast('Record locked.', 'ok'); } }] : []),
    ...(canEscalate ? [{ label: 'Save', cls: 'btn-primary', action: async () => {
      const db2 = loadDB(), r2 = db2.transactions.find(x => x.id === id), esc = document.getElementById('mTxEscalation').value;
      if (esc !== (r2.escalation || 'Normal')) {
        r2.escalation = esc === 'Normal' ? null : esc; r2.escalatedBy = esc === 'Normal' ? null : currentUser.fullName; r2.escalatedAt = esc === 'Normal' ? null : new Date();
        logActivity(db2, currentUser, `Set escalation for ${r2.code} to ${esc}`);
      }
      if(r2.shared){try{await SharedAppointments.request('/service-records/'+encodeURIComponent(id),'PATCH',{escalation:esc,ownerId:document.getElementById('caseOwner').value,dueDate:document.getElementById('caseDue').value,nextAction:document.getElementById('caseAction').value,notes:document.getElementById('caseNotes').value,revision:r.caseRevision||0});await SharedAppointments.reloadRecords();}catch(e){toast(escapeHtml(e.message),'err');return;}}else {toast('Migrate this legacy record before editing.','err');return;}
      closeModal();renderTxnTable();toast('Record updated.','ok');
    } }] : [])];
  openModal(`${r.code}${sensitive ? ` ${icon('lock', 13)}` : ''}`, `
    <div class="transaction-detail"><div class="staff-record-context"><strong>${escapeHtml(r.name || 'Visitor')}</strong><span class="mono">${escapeHtml(r.visitId || r.code || r.id)}</span><span>${statusPill(r.status)}</span></div>
    ${sensitive ? `<p class="field-hint" style="margin-bottom:12px;">${icon('lock', 11)} This record is confidential &mdash; visible only to admins with Confidential access. It locks again automatically after 5 minutes.</p>` : ''}
    ${r.possibleDuplicate ? `<div class="dup-warn">${icon('alert', 13)} This visit was originally flagged as a possible duplicate active visit.</div>` : ''}
    ${r.caseStatus?`<div class="kv"><span>Case status</span><span>${escapeHtml(r.caseStatus)}</span></div>`:''}
    ${linkedQueue&&linkedQueue.status!==r.status?`<div class="kv"><span>Visit status</span><span>${queueStatusPill(linkedQueue.status)}</span></div>`:''}
    <h4 class="staff-detail-heading">Visitor details</h4>
    <div class="kv"><span>Requestor</span><span>${escapeHtml(requestorLabel(r.name, r.type))}</span></div>
    ${r.idNumber ? `<div class="kv"><span>ID Number</span><span>${escapeHtml(r.idNumber)}</span></div>` : ''}
    ${r.section ? `<div class="kv"><span>Section / Org</span><span>${escapeHtml(r.section)}</span></div>` : ''}
    <h4 class="staff-detail-heading">Service details</h4><div class="kv"><span>Service</span><span>${serviceLabel(db, r.service)}</span></div>
    ${!isVisit && r.details ? `<div class="kv"><span>Details</span><span style="max-width:260px; text-align:right;">${escapeHtml(r.details)}</span></div>` : ''}



    ${r.escalation && r.escalation !== 'Normal' ? `<div class="kv"><span>Escalation</span><span>${escalationPill(r.escalation)}${r.escalatedBy ? ` <span class="muted" style="font-size:.72rem;">by ${escapeHtml(r.escalatedBy)}</span>` : ''}</span></div>` : ''}
    <div class="kv"><span>Logged</span><span>${fmtDateTime(r.createdAt)}</span></div>
    ${r.completedAt ? `<div class="kv"><span>Completed</span><span class="mono">${fmtDateTime(r.completedAt)}</span></div>` : ''}
    ${r.servedBy ? `<div class="kv"><span>Served By</span><span>${escapeHtml(r.servedBy)}</span></div>` : ''}

    ${linkedQueue ? `<div class="kv"><span>Entry Method</span><span>${linkedQueue.number ? `<span class="pill pill-info">${escapeHtml(linkedQueue.number)}</span> ` : ''}${escapeHtml(entryMethodLabel(linkedQueue))}</span></div>` : ''}
    ${linkedAppt ? `<div class="kv"><span>Appointment</span><span>${escapeHtml(linkedAppt.code)}${linkedAppt.date ? ` &middot; ${linkedAppt.date} ${escapeHtml(UniServeUX.timeLabel(linkedAppt.time))}` : ''}</span></div>` : ''}
    <h4 class="staff-detail-heading">Documents</h4>
    <div class="field"><label>Uploaded Requirements</label>${attachListHtml(files)}</div>
    <h4 class="staff-detail-heading">History</h4>
    ${typeof flowServiceHistory==='function'?flowServiceHistory(r.serviceHistory):''}
    ${feedbackReadoutHtml(linkedQueue)}
    ${linkedQueue ? timelineBlockHtml(linkedQueue, linkedAppt) : ''}
    ${r.waitingTimeMin != null || r.serviceTimeMin != null || r.totalTimeMin != null ? timeMetricsGrid(r.waitingTimeMin, r.serviceTimeMin, r.totalTimeMin) : ''}

    ${caseWorkflowHtml(r,canEscalate)}
    ${canEscalate ? `<div class="field"><label>Escalation</label><select id="mTxEscalation">${['Normal', 'For Review', 'Escalated', 'Resolved'].map(s => `<option value="${s}" ${(r.escalation || 'Normal') === s ? 'selected' : ''}>${s}</option>`).join('')}</select><div class="field-hint">Manually flag this incident/concern for review or escalation. Never set automatically.</div></div>` : ''}</div>`, buttons);
  if(canEscalate)loadVisitOwners('caseOwner',r.caseOwnerId||currentUser.id);
  if (sensitive) { const m = document.getElementById('activeModal'); if (m) m.dataset.conf = id; }
}
function printTransaction(id) {
  if (!reportOutputActive) return authorizedReportOutput({kind:'transaction',id,includeConf:isConfidentialTxn(loadDB().transactions.find(t=>t.id===id))},()=>printTransactionSnapshot(id));
  return printTransactionSnapshot(id);
}
function printTransactionSnapshot(id) {
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
      ${linkedQueue ? `<tr><th>Entry</th><td>${linkedQueue.number ? escapeHtml(linkedQueue.number) + ' ' : ''}(${escapeHtml(entryMethodLabel(linkedQueue))})</td></tr>` : ''}
      ${linkedAppt ? `<tr><th>Appointment</th><td>${escapeHtml(linkedAppt.code)}${linkedAppt.date ? ` &middot; ${linkedAppt.date} ${escapeHtml(UniServeUX.timeLabel(linkedAppt.time))}` : ''}</td></tr>` : ''}
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

function askIncludeConf(confCount, cb, reportGate) {
  const gate = reportGate || { id: 'rpt:all', code: 'confidential records', service: 'incident_report' };
  const canUnlock = !!currentUser.confidentialApprover;
  const buttons = [{label:'Print redacted copy',cls:canUnlock?'btn-ghost':'btn-primary',action:()=>{closeModal();cb(false);}}];
  if (canUnlock) buttons.push({label:'Unlock and print',cls:'btn-primary',action:()=>{closeModal();requireConfUnlock(gate,()=>cb(true),'print');}});
  openModal('Print report', '<div class="log-print-options"><p>A redacted copy excludes confidential names and personal details. Summary totals include all transactions.</p>' + (canUnlock?'<p class="field-hint">To include confidential details, unlock print access with your password.</p>':'<p class="field-hint">Confidential details require Head Admin access for combined reports.</p>') + '</div>', buttons);
}
function printTxnReport(serviceKey, which, includeConf) {
  const db = loadDB(), range = which === 'txn' ? RANGES.txn : { from: '', to: '' }, svc = serviceKey ? findService(db, serviceKey) : null;
  const title = svc ? svc.label : 'All Services', period = escapeHtml(rangeLabel(range));
  const gated = !!serviceKey && (loadDB().services.find(s=>s.key===serviceKey)?.confidential ?? CONFIDENTIAL_SERVICES.includes(serviceKey));
  if (includeConf === undefined) {
    const n = db.transactions.filter(t => (!serviceKey || t.service === serviceKey) && inRange(t.createdAt, range) && isConfidentialTxn(t)).length;
    askIncludeConf(n, inc => printTxnReport(serviceKey, which, inc), gated ? {id:'svc:'+serviceKey,code:title,service:serviceKey} : undefined); return;
  }
  if (!reportOutputActive) return authorizedReportOutput({kind:serviceKey?'service':'combined',serviceKey:serviceKey||null,includeConf:!!includeConf},()=>printTxnReport(serviceKey,which,includeConf));
  const all = db.transactions.filter(t => (!serviceKey || t.service === serviceKey) && inRange(t.createdAt, range)).sort((a, b) => a.createdAt - b.createdAt);
  const listAll = !!includeConf, confCount = listAll ? 0 : all.filter(isConfidentialTxn).length, rows = listAll ? all : all.filter(t => !isConfidentialTxn(t)), total = all.length;
  const ORDER = ['Completed', 'Approved', 'Processing', 'Pending', 'Rejected'], sc = {}; ORDER.forEach(s => sc[s] = 0);
  all.forEach(t => { if (sc[t.status] !== undefined) sc[t.status]++; });
  const pct = n => total ? Math.round(n / total * 100) : 0, rate = pct(sc.Completed);
  const walkIns = all.filter(t => t.entryMethod && t.entryMethod !== 'Scheduled').length, sched = all.filter(t => t.entryMethod === 'Scheduled').length;
  const avgOf = k => averageReportMetric(all,k);
  const byService = db.services.map(s => ({ label: s.label, count: all.filter(t => t.service === s.key).length })).filter(r => r.count).sort((a, b) => b.count - a.count);
  const cg = '<colgroup><col style="width:3%"><col style="width:10%"><col style="width:11%"><col style="width:7%"><col style="width:10%"><col style="width:10%"><col style="width:6%"><col style="width:8%"><col style="width:9%"><col style="width:9%"><col style="width:10%"><col style="width:7%"></colgroup>';
  printInjected(`${reportLetterhead()}
    <div class="report-title-block"><h2>Transaction Report &mdash; ${escapeHtml(title)}</h2><div class="report-meta"><span>Period: ${period}</span><span>Generated: ${fmtDateTime(new Date())} by ${escapeHtml(currentUser.fullName)}</span></div></div>
    ${all.some(isConfidentialTxn)?'<p class="doc-footnote"><strong>Confidential access: '+(listAll?'Unlocked for this authorized report.':'Locked. Private details are excluded; confidential records are counted only.')+'</strong></p>':''}
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
      <div class="rpt-stat"><div class="rpt-stat-lbl">Avg. Waiting Time</div><div class="rpt-stat-val" style="font-size:1.15rem;">${fmtCompactMinutes(avgOf('waitingTimeMin'))}</div></div>
      <div class="rpt-stat"><div class="rpt-stat-lbl">Avg. Service Time</div><div class="rpt-stat-val" style="font-size:1.15rem;">${fmtCompactMinutes(avgOf('serviceTimeMin'))}</div></div>
      <div class="rpt-stat"><div class="rpt-stat-lbl">Avg. Total Visit</div><div class="rpt-stat-val" style="font-size:1.15rem;">${fmtCompactMinutes(avgOf('totalTimeMin'))}</div></div></div></div>
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
  if (!currentUser.confidentialApprover) { navigate("dashboard"); return; }
  document.getElementById('content').innerHTML = `<div class="card"><div class="card-head"><div><h3>Service Catalog</h3></div><button class="btn btn-primary btn-sm" onclick="openServiceForm()">${icon('plus', 14)} Create service</button></div><div class="card-pad"><div class="svc-manage-grid" id="svcManageGrid"></div></div></div>`;
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
  if (!currentUser.confidentialApprover) { toast("Only the OSS Head can manage services.", "err"); return; }
  const db = loadDB(), editing = key ? db.services.find(s => s.key === key) : null;
  svcFormTemplates = editing && editing.templates ? editing.templates.map(t => ({ ...t })) : [];
  openModal(editing ? 'Edit service' : 'Create service', `
    <div class="field"><label>Service Name</label><input id="mSvcLabel" value="${editing ? escapeHtml(editing.label) : ''}" placeholder="e.g. Good Moral Character"></div>
    <div class="field"><label>Short Description</label><textarea id="mSvcDesc" placeholder="Shown as the card blurb on the visitor portal">${editing ? escapeHtml(editing.desc || '') : ''}</textarea></div>
    <div class="field"><label for="mSvcNotice">Service announcement</label><textarea id="mSvcNotice" maxlength="1000" placeholder="Optional notice or deadline for visitors">${escapeHtml(editing?.announcement || '')}</textarea><p class="field-hint">Shown when a visitor selects this service. Clear this field to remove the notice.</p></div>
    <div class="field"><label>Requirements <span class="muted" style="font-weight:400;">(one per line)</span></label><textarea id="mSvcReq" placeholder="Valid School ID">${editing ? escapeHtml((editing.requirements || []).join('\n')) : ''}</textarea>
      <div class="field-hint">Each requirement is what "Smart Service Readiness" counts against when a visitor uploads files, and what the emailed pass lists under "What to bring".</div></div>
    <div class="field"><label>Downloadable forms <span class="muted" style="font-weight:400;">(optional)</span></label>
      <input type="file" id="mSvcFiles" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,image/*" onchange="handleTemplateFiles(this)">
      <div id="svcTplList"></div>
      <div class="field-hint">Blank forms visitors can download before they come (request form, consent form, etc.). PDF, Word, Excel or image, up to 2 MB each.</div></div>
    ${currentUser.confidentialApprover ? `<div class="field service-privacy-field"><label class="service-privacy-control" for="mSvcConfidential"><input id="mSvcConfidential" type="checkbox" aria-describedby="mSvcPrivacyHint" ${(editing?.confidential ?? CONFIDENTIAL_SERVICES.includes(key)) ? "checked" : ""}> ${icon("lock",14)}<span>Confidential service</span></label><div id="mSvcPrivacyHint" class="field-hint">Protect existing and new records. Authorized staff only.</div></div>` : ""}
    <div class="field"><label>Icon</label><div class="icon-picker">${ICON_CHOICES.map(ic => `<label><input type="radio" name="mSvcIcon" value="${ic}" ${(editing ? editing.icon : ICON_CHOICES[0]) === ic ? 'checked' : ''}><span>${icon(ic, 18)}</span></label>`).join('')}</div></div>`, [
    { label: 'Cancel', cls: 'btn-ghost', action: closeModal },
    { label: editing ? 'Save changes' : 'Create service', cls: 'btn-primary', action: async () => {
      const label = document.getElementById('mSvcLabel').value.trim();
      if (!label) { toast('Service name is required.', 'err'); return; }
      const privacyInput=document.getElementById('mSvcConfidential'),confidential=privacyInput?privacyInput.checked:(editing?.confidential ?? CONFIDENTIAL_SERVICES.includes(key));
      if(editing && privacyInput && confidential!==(editing.confidential ?? CONFIDENTIAL_SERVICES.includes(key)) && !await UniServeUX.confirm('Change service privacy', confidential?'Protect existing and new records for this service?':'Allow normal staff access to existing and new records for this service?', 'Confirm change'))return;
      const announcement=document.getElementById('mSvcNotice').value.trim();
      const desc = document.getElementById('mSvcDesc').value.trim(), reqs = document.getElementById('mSvcReq').value.split('\n').map(s => s.trim()).filter(Boolean);
      const iconEl = document.querySelector('input[name="mSvcIcon"]:checked'), iconVal = iconEl ? iconEl.value : 'home', db2 = loadDB();
      if (editing) {
        Object.assign(db2.services.find(s => s.key === editing.key), { label, desc, announcement, requirements: reqs, icon: iconVal, templates: svcFormTemplates, confidential });
        logActivity(db2, currentUser, `Updated service "${label}"`);
      } else {
        const k = slugify(label);
        if (db2.services.some(s => s.key === k)) { toast('A service with a similar name already exists.', 'err'); return; }
        db2.services.push({ key: k, label, desc, announcement, requirements: reqs, icon: iconVal, templates: svcFormTemplates, confidential });
        logActivity(db2, currentUser, `Created service "${label}"`);
      }
      try { await SharedAppointments.request('/services/'+encodeURIComponent(editing ? editing.key : slugify(label)), 'PUT', {label,desc,announcement,requirements:reqs,icon:iconVal,templates:svcFormTemplates,...(privacyInput?{confidential}:{})});saveDB(db2); } catch (e) { toast(escapeHtml(e.message), 'err'); return; }
      closeModal(); renderSvcManageGrid(); renderSidebar();
    } }]);
  renderSvcTplList();
}
async function deleteService(key) {
  const db = loadDB(), s = db.services.find(x => x.key === key);
  if (!s) return;
  const used = countTxnForService(db, key);
  if (!await UniServeUX.confirm('Delete service', `Delete "${s.label}"?${used ? ` ${used} existing transaction(s) will keep the label for reference.` : ''}`, 'Delete service')) return;
  try {await SharedAppointments.request('/services/'+encodeURIComponent(key),'DELETE');} catch(error){toast(escapeHtml(error.message),'err');return;}
  db.services = db.services.filter(x => x.key !== key);
  logActivity(db, currentUser, `Deleted service "${s.label}"`);
  if (txnServiceFilter === key) txnServiceFilter = undefined;
  saveDB(db); renderSvcManageGrid(); renderSidebar(); toast('Service deleted.', 'ok');
}

let reportPeriod = 'Daily';
async function renderReports() {
  const reportDb = loadDB(); if (sweepNoShows(reportDb)) saveDB(reportDb);
  let reportRefreshFailed = false;
  try { await loadSharedQueue(); } catch (_) { reportRefreshFailed = true; }
  if (state_view !== 'reports') return;
  document.getElementById('content').innerHTML = `
    <div class="card card-pad no-print">
      <div class="subnav">${['Daily', 'Weekly', 'Monthly', 'Quarterly'].map((p, i) => `<button class="${i ? '' : 'active'}" onclick="setReportPeriod('${p}',this)">${p}</button>`).join('')}</div>
      <div style="display:flex; gap:10px; flex-wrap:wrap;"><button class="btn btn-primary btn-sm" onclick="printReport()">${icon('print', 14)} Print report</button><button class="btn btn-ghost btn-sm" onclick="downloadReportExcel()">${icon('download', 14)} Download Excel</button></div></div>
    <div class="card card-pad" id="reportSheet" style="margin-top:16px;">${reportLetterhead()}
      <div class="report-title-block"><h2 id="repTitle">Daily Transaction Report</h2><div class="report-meta"><span id="repPeriodLbl"></span><span id="repGenLbl"></span></div></div>
      <div id="repBody"></div></div>`;
  reportPeriod = 'Daily';
  buildReport();
  document.getElementById('content').insertAdjacentHTML('beforeend', (reportRefreshFailed ? '<div class="err-box">Shared queue could not be refreshed. Showing available records. <button class="btn btn-ghost btn-sm" onclick="renderReports()">Retry</button></div>' : '') + UniServeUX.reportHtml(loadDB()));
}
let reportIncludeConf = false;
function printReport(includeConf) {
  const sheet = document.getElementById('reportSheet');
  if (!sheet) return;
  if (includeConf === undefined) {
    const start = periodStart(reportPeriod), n = loadDB().transactions.filter(t => t.createdAt >= start && isConfidentialTxn(t)).length;
    askIncludeConf(n, inc => printReport(inc)); return;
  }
  if (!reportOutputActive) return authorizedReportOutput({kind:'combined',includeConf:!!includeConf},()=>printReport(includeConf));
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
  document.getElementById('repGenLbl').textContent = `Generated: ${fmtDateTime(new Date()).replace(/&middot;/g,'·')} by ${currentUser.fullName}`;
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
  const withTimes = txns.filter(t => ['waitingTimeMin','serviceTimeMin','totalTimeMin'].some(key=>typeof t[key]==='number'&&Number.isFinite(t[key])&&t[key]>=0)), avgOf = k => averageReportMetric(txns,k);
  const noShows = appts.filter(a => a.status === 'No-show').length, pct = n => total ? Math.round(n / total * 100) : 0;
  const svcKeys = db.services.map(x => x.key); txns.forEach(t => { if (!svcKeys.includes(t.service)) svcKeys.push(t.service); });
  const svcGroups = svcKeys.map(k => {
    const all = txns.filter(t => t.service === k), rows = reportIncludeConf ? all : all.filter(t => !isConfidentialTxn(t));
    return { label: serviceLabel(db, k), rows, total: all.length, hidden: all.length - rows.length };
  }).filter(g => g.total);
  document.getElementById('repBody').innerHTML = `
    ${txns.some(isConfidentialTxn)?`<p class="doc-footnote">${reportIncludeConf?'Confidential details included for authorized printing.':'Confidential details excluded. These transactions are included in summary totals.'}</p>`:''}
    <div class="rpt-section"><h3 class="rpt-h">Executive Summary</h3>
      <div class="stat-grid rpt-stat-grid">
        <div class="rpt-stat"><div class="rpt-stat-lbl">Total Transactions</div><div class="rpt-stat-val">${total}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-lbl">Completed</div><div class="rpt-stat-val">${completed}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-lbl">Pending</div><div class="rpt-stat-val">${pending}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-lbl">Completion Rate</div><div class="rpt-stat-val">${rate}%</div></div></div>
      ${withTimes.length ? `<div class="stat-grid rpt-stat-grid">
        <div class="rpt-stat"><div class="rpt-stat-lbl">Avg. Waiting Time</div><div class="rpt-stat-val">${fmtCompactMinutes(avgOf('waitingTimeMin'))}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-lbl">Avg. Service Time</div><div class="rpt-stat-val">${fmtCompactMinutes(avgOf('serviceTimeMin'))}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-lbl">Avg. Total Visit</div><div class="rpt-stat-val">${fmtCompactMinutes(avgOf('totalTimeMin'))}</div></div>
        <div class="rpt-stat"><div class="rpt-stat-lbl">No-Shows</div><div class="rpt-stat-val">${noShows}</div></div></div>` : ''}
      <p class="rpt-narrative">During the period ${fmtDate(start)} to ${today()}, the office logged <strong>${total}</strong> transaction${total === 1 ? '' : 's'} across ${svcRows.filter(row=>row.count>0).length} service categories, averaging <strong>${per}</strong> per ${trend.unit}. <strong>${completed}</strong> request${completed === 1 ? '' : 's'} ${completed === 1 ? 'was' : 'were'} completed (${rate}% completion rate), while <strong>${pending}</strong> remain${pending === 1 ? 's' : ''} pending${rejected ? ` and ${rejected} ${rejected === 1 ? 'was' : 'were'} rejected` : ''}.${busiest && busiest.count > 0 ? ` The most requested service was <strong>${busiest.label}</strong> with ${busiest.count} transaction${busiest.count === 1 ? '' : 's'}.` : ''} A total of <strong>${appts.length}</strong> appointment${appts.length === 1 ? '' : 's'} ${appts.length === 1 ? 'was' : 'were'} booked in the same period${noShows ? `, of which ${noShows} resulted in a no-show` : ''}.</p></div>
    <div class="rpt-section"><h3 class="rpt-h">Transaction Trend</h3><div class="rpt-desc">Transactions logged per ${trend.unit} over the reporting period</div>${svgLineChart(trend)}</div>
    <div class="rpt-section rpt-grid-2"><div><h3 class="rpt-h">Status Breakdown</h3>${svgBarChart(ORDER.map(s => ({ label: s, count: sc[s] })))}</div>
      <div class="rpt-table-wrap"><table class="rpt-table"><colgroup><col style="width:50%"><col style="width:25%"><col style="width:25%"></colgroup><thead><tr><th>Status</th><th>Count</th><th>%</th></tr></thead>
        <tbody>${ORDER.map(s => `<tr><td>${s}</td><td>${sc[s]}</td><td>${pct(sc[s])}%</td></tr>`).join('')}<tr class="rpt-total-row"><td>Total</td><td>${total}</td><td>${total ? '100%' : '0%'}</td></tr></tbody></table></div></div>
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
function downloadReportExcel() {
  if (!reportOutputActive) return authorizedReportOutput({kind:'combined',includeConf:false},downloadReportExcel);
  const db = loadDB(), start = periodStart(reportPeriod), txns = db.transactions.filter(t => t.createdAt >= start), counts = {};
  db.services.forEach(s => counts[s.key] = 0);
  txns.forEach(t => { counts[t.service] = (counts[t.service] || 0) + 1; });
  const rows = [
    ['Polytechnic University of the Philippines - Santa Maria Campus'], ['Office of Student Services'], [`${reportPeriod} Transaction Report`], [`Period: ${fmtDate(start)} to ${today()}`],
    [`Generated: ${fmtDateTime(new Date()).replace('&middot;', '-')} by ${currentUser.fullName}`], [],
    ['Summary'], ['Total Transactions', txns.length], ['Completed', txns.filter(t => t.status === 'Completed').length], ['Pending', txns.filter(t => t.status === 'Pending').length],
    ['Records not listed (count only)', txns.filter(isConfidentialTxn).length], ['Chat Conversations Started', db.chats.filter(c => c.createdAt >= start).length], [],
    ['Breakdown by Service'], ['Service', 'Count'], ...db.services.map(s => [s.label, counts[s.key] || 0]), [],
    ['Detailed Transaction Log'], ['Code','Name','Visitor type','ID number','Visit ID','Queue number','Service','Status','Logged'],
    ...txns.filter(t=>!isConfidentialTxn(t)).map(t=>[t.code,t.name,t.type||'',t.idNumber||'',t.visitId||'',t.queueNumber||'',serviceLabel(db,t.service),t.status,fmtDateTime(t.createdAt)]),
  ];
  const headings=new Set(['Summary','Breakdown by Service','Service','Detailed Transaction Log','Code']);
  SpreadsheetExport.download(`OSS_${reportPeriod}_Report_${today()}.xlsx`,rows,[24,28,20,26,24,20,36,20,28],{sheetName:'Admin Report',filter:false,headingRows:rows.flatMap((row,index)=>index===0||headings.has(row[0])?[index]:[])});
  logActivity(db, currentUser, `Downloaded ${reportPeriod} report`); saveDB(db);
  toast('Report downloaded.', 'ok');
}

function renderProfile() {
  const u = currentUser, initials = u.fullName.split(' ').map(s => s[0]).slice(0, 2).join('');
  document.getElementById('content').innerHTML = `
    <div class="card staff-profile-card">
      <div class="profile-head"><div class="profile-avatar">${initials}</div><div><div style="font-weight:700; font-size:1.05rem;">${escapeHtml(u.fullName)}</div><span class="pill pill-gold">${u.confidentialApprover ? "Head Admin" : ROLES[u.role].label}</span></div></div>
      <div class="card-pad staff-profile-grid"><section class="staff-profile-details" aria-label="Profile details">
        <div class="field"><label>Full Name</label><input value="${escapeHtml(u.fullName)}" disabled></div>
        <div class="field"><label>Username</label><input value="${escapeHtml(u.username)}" disabled></div>
        <div class="field"><label>Email</label><input value="${escapeHtml(u.email || 'Not set — ask your Super Admin to add one')}" disabled></div>
        <div class="field-hint" style="margin-top:-8px; margin-bottom:14px;">Full name, username and email are managed by your Super Admin.</div>
        </section><section class="staff-profile-password" aria-label="Change password">
        <div class="field"><label>Current Password</label><div class="profile-password-input"><input id="pfCurrentPass" type="password" autocomplete="current-password"><button type="button" class="profile-pass-toggle" aria-label="Show password" aria-pressed="false" onclick="toggleProfilePassword('pfCurrentPass',this)">${profilePasswordEye(true)}</button></div></div>
        <div class="form-row"><div class="field"><label>New Password</label><div class="profile-password-input"><input id="pfPass" aria-describedby="pfPasswordHint" type="password" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;"><button type="button" class="profile-pass-toggle" aria-label="Show password" aria-pressed="false" onclick="toggleProfilePassword('pfPass',this)">${profilePasswordEye(true)}</button></div></div><div class="field"><label>Confirm New Password</label><div class="profile-password-input"><input id="pfPass2" type="password" placeholder="&bull;&bull;&bull;&bull;&bull;&bull;"><button type="button" class="profile-pass-toggle" aria-label="Show password" aria-pressed="false" onclick="toggleProfilePassword('pfPass2',this)">${profilePasswordEye(true)}</button></div></div></div>
        <p id="pfPasswordHint" class="field-hint" aria-live="polite" style="margin-bottom:10px;">At least 12 characters with uppercase and lowercase letters, a number, and a special character.</p><button class="btn btn-primary btn-block" onclick="saveProfile()">Save password</button>
        <p class="field-hint" style="margin-top:10px; margin-bottom:0;">Enter your current password to save a new password.</p>
      </section></div></div>`;
}
async function saveProfile() {
  const pass = document.getElementById('pfPass').value, pass2 = document.getElementById('pfPass2').value;
  if (!pass && !pass2) { toast('Enter a new password to save changes.', 'err'); return; }
  if (pass.length < 12 || pass.length > 72 || !/[A-Z]/.test(pass) || !/[a-z]/.test(pass) || !/[0-9]/.test(pass) || !/[^A-Za-z0-9\s]/.test(pass)) { toast('At least 12 characters with uppercase and lowercase letters, a number, and a special character.', 'err'); return; }
  if (pass !== pass2) { toast('Passwords do not match.', 'err'); return; }
  const db = loadDB(), u2 = db.users.find(x => x.id === currentUser.id);
  try {
    const response = await fetch((globalThis.UniServeConfig?.apiBase||'http://127.0.0.1:8000/api')+'/password', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ username: currentUser.username, password: document.getElementById('pfCurrentPass').value, new_password: pass })
    });
    const result = await response.json();
    if (!response.ok) { toast(escapeHtml(Object.values(result.errors||{}).flat().join(' ')||result.message||'Password update failed.'), 'err'); return; }
    Object.assign(u2,result.user);saveSession({...loadSession(),token:result.token,currentUser:result.user});
  } catch (_) { toast('Cannot reach the login service.', 'err'); return; }
  delete u2.password;
  logActivity(db, currentUser, 'Changed own password');
  saveDB(db); currentUser = u2; saveSession({...loadSession(), currentUser: u2 });
  document.getElementById('pfPass').value = ''; document.getElementById('pfPass2').value = '';
  document.getElementById('pfCurrentPass').value = '';
  toast('Password updated.', 'ok');
}

renderSidebar();
navigate('dashboard');


function toggleIntakeTime() {
  const scheduled = document.getElementById('intakeMode').value === 'scheduled';
  document.getElementById('intakeTimeField').hidden = !scheduled;
  document.getElementById('intakeTime').required = scheduled;
}
