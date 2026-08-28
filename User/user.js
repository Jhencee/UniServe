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
const randCode = (prefix) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = ''; for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}-${s}`;
};
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- seed / persistence (same shape as Landing/Admin/Super Admin) ---------------- */
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
    systemSettings: {
      orgName: 'Office of Student Services', supportEmail: 'oss@university.edu.ph',
      supportPhone: '0917-000-0000', timezone: 'Asia/Manila', maintenanceMode: false,
      autoCloseChats: false, sessionTimeout: 30, queuePrefixStudent: 'A', queuePrefixGuest: 'G',
    },
  };
}
function mkAppt(o) { return { id: uid('A'), code: randCode('APT'), ...o }; }
function mkChat(o) { return { id: uid('CH'), code: randCode('CHT'), status: 'Open', messages: [], staffUnread: 0, visitorUnread: 0, ...o }; }
function mkQueue(o) {
  return { id: uid('Q'), status: 'Waiting', createdAt: new Date(), calledAt: null, servingAt: null, completedAt: null, assignedAdminId: null, assignedAdminName: null, transactionId: null, appointmentId: null, recallCount: 0, ...o };
}

const DATE_FIELDS = ['createdAt', 'updatedAt', 'calledAt', 'servingAt', 'completedAt', 'recalledAt', 'transferredAt', 'ts'];
function reviveDates(obj) {
  if (Array.isArray(obj)) { obj.forEach(reviveDates); return obj; }
  if (obj && typeof obj === 'object') {
    Object.keys(obj).forEach(k => {
      if (DATE_FIELDS.includes(k) && obj[k]) obj[k] = new Date(obj[k]);
      else reviveDates(obj[k]);
    });
  }
  return obj;
}
function loadDB() {
  const raw = localStorage.getItem(DB_KEY);
  if (!raw) { const s = freshState(); localStorage.setItem(DB_KEY, JSON.stringify(s)); return s; }
  try { return reviveDates(JSON.parse(raw)); }
  catch (e) { const s = freshState(); localStorage.setItem(DB_KEY, JSON.stringify(s)); return s; }
}
function saveDB(s) { localStorage.setItem(DB_KEY, JSON.stringify(s)); }

/* ---------------- queue logic ---------------- */
function queuePrefixFor(db, visitorType) {
  const s = db.systemSettings;
  if (visitorType === 'Guest') return (s.queuePrefixGuest || 'G').toUpperCase().slice(0, 2) || 'G';
  return (s.queuePrefixStudent || 'A').toUpperCase().slice(0, 2) || 'A';
}
function nextQueueNumber(db, visitorType) {
  const prefix = queuePrefixFor(db, visitorType);
  const dayKey = today();
  if (!db.queueCounters || db.queueCounters.dayKey !== dayKey) db.queueCounters = { dayKey };
  const seq = (db.queueCounters[prefix] || 0) + 1;
  db.queueCounters[prefix] = seq;
  return { number: `${prefix}-${String(seq).padStart(3, '0')}`, prefix, seq };
}
function addToQueue(db, { visitorType, serviceKey, serviceLabel: svcLabelText, source, name, idNumber, contact, appointmentId }) {
  const { number, prefix, seq } = nextQueueNumber(db, visitorType);
  const entry = mkQueue({
    number, prefix, seq, visitorType,
    serviceKey: serviceKey || null,
    serviceLabel: svcLabelText || (serviceKey ? serviceLabel(db, serviceKey) : 'General Concern'),
    source: source || 'Walk-in',
    name: name || '', idNumber: idNumber || '', contact: contact || '',
    appointmentId: appointmentId || null,
  });
  db.queues.push(entry);
  return entry;
}
function findService(db, serviceKey) { return db.services.find(x => x.key === serviceKey) || db.services.find(x => x.label === serviceKey); }
function serviceLabel(db, key) { const s = db.services.find(x => x.key === key); return s ? s.label : key; }
function serviceQueueLabel(db, entry) { return entry.serviceLabel || (entry.serviceKey ? serviceLabel(db, entry.serviceKey) : 'General Concern'); }
function queueRank(q) { return (QUEUE_SOURCE_RANK[q.source] ?? 2); }
function waitingQueueSorted(db) {
  return db.queues.filter(q => q.status === 'Waiting').sort((a, b) => queueRank(a) - queueRank(b) || (new Date(a.createdAt) - new Date(b.createdAt)));
}
function peopleAheadOf(db, entryId) {
  const list = waitingQueueSorted(db);
  const idx = list.findIndex(q => q.id === entryId);
  return idx < 0 ? 0 : idx;
}
function servingQueueEntries(db) {
  return db.queues.filter(q => q.status === 'Serving' || q.status === 'Called').sort((a, b) => (new Date(a.calledAt || 0)) - (new Date(b.calledAt || 0)));
}
function cancelQueue(db, id) {
  const q = db.queues.find(x => x.id === id);
  if (q) q.status = 'Cancelled';
}

/* ---------------- attachments (file -> data URL, in-memory demo) ---------------- */
function fmtFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, size: file.size, type: file.type, dataUrl: reader.result });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
async function readFilesAsAttachments(fileList) {
  const files = Array.from(fileList || []);
  return Promise.all(files.map(readFileAsDataURL));
}
function attachChip(att) {
  return `<a class="attach-chip" href="${att.dataUrl}" download="${escapeHtml(att.name)}" target="_blank">${icon('paperclip', 13)}<span class="fname">${escapeHtml(att.name)}</span><span class="fsize">${fmtFileSize(att.size)}</span></a>`;
}
function attachListHtml(attachments, emptyText) {
  if (!attachments || !attachments.length) return `<div class="no-attach">${emptyText || 'No files uploaded.'}</div>`;
  return `<div class="attach-list">${attachments.map(attachChip).join('')}</div>`;
}
function requirementsBoxHtml(svc) {
  return svc && svc.requirements && svc.requirements.length
    ? `<div class="req-box"><div class="req-title">Requirements needed</div><ul>${svc.requirements.map(r => `<li>${escapeHtml(r)}</li>`).join('')}</ul></div>`
    : '';
}

/* ---------------- icons / crest / QR / toast / modal / theme ---------------- */
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
    ticket: 'M4 8a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2a2 2 0 000-4V8zM10 6v2M10 11v2M10 16v2',
    megaphone: 'M3 11v2a2 2 0 002 2h1l3 5 1-1-1-4h5l6 4V6l-6 4H6a2 2 0 00-2 2z',
    arrowright: 'M5 12h14M13 5l7 7-7 7',
  }[name] || 'M12 2v20';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${p.split('M').filter(Boolean).map(seg => `<path d="M${seg}"/>`).join('')}</svg>`;
}
function crestSVG(size = 40) {
  return `<img src="pup.jpg" alt="PUP logo" style="width:${size}px;height:${size}px;object-fit:contain;">`;
}
function mockQR(code, cells = 7, size = 88) {
  let hash = 0; for (let i = 0; i < code.length; i++) { hash = (hash * 31 + code.charCodeAt(i)) >>> 0; }
  const cs = size / cells;
  let rects = '';
  for (let r = 0; r < cells; r++) {
    for (let c = 0; c < cells; c++) {
      const isFinder = (r < 2 && c < 2) || (r < 2 && c > cells - 3) || (r > cells - 3 && c < 2);
      let on;
      if (isFinder) { on = true; }
      else { hash = (hash * 1103515245 + 12345) >>> 0; on = (hash % 100) < 46; }
      if (on) rects += `<rect x="${c * cs}" y="${r * cs}" width="${cs}" height="${cs}" fill="#241512"/>`;
    }
  }
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
  wrap.innerHTML = `
    <div class="modal">
      <div class="modal-head"><h3>${title}</h3><button class="close-x" id="modalCloseX">${icon('x', 18)}</button></div>
      <div class="modal-body">${bodyHtml}</div>
      <div class="modal-foot">${buttons.map((b, i) => `<button class="btn ${b.cls} btn-sm" id="modalBtn${i}">${b.label}</button>`).join('')}</div>
    </div>`;
  document.body.appendChild(wrap);
  buttons.forEach((b, i) => document.getElementById(`modalBtn${i}`).onclick = b.action);
  document.getElementById('modalCloseX').onclick = closeModal;
  wrap.addEventListener('click', e => { if (e.target === wrap) closeModal(); });
}
function closeModal() { const m = document.getElementById('activeModal'); if (m) m.remove(); }
function setTheme(t) {
  localStorage.setItem('ossuniserve_theme', t);
  document.documentElement.setAttribute('data-theme', t);
  document.querySelectorAll('[data-theme-btn]').forEach(b => b.classList.toggle('active', b.dataset.themeBtn === t));
}
setTheme(localStorage.getItem('ossuniserve_theme') || 'light');

/* =========================================================================
   VISITOR PORTAL
========================================================================= */
document.getElementById('crestSlotF').innerHTML = crestSVG(34);

const VISITOR_NAV = [
  { key: 'visit', label: 'Start a Visit', ic: 'ticket' },
  { key: 'checkvisit', label: 'Check My Visit', ic: 'search' },
  { key: 'chat', label: 'Chat with OSS', ic: 'chat' },
];
const VISITOR_TITLES = {
  visit: ['Start Your Visit', 'Choose a service and decide whether to walk in or schedule ahead.'],
  checkvisit: ['Check My Visit', 'Look up your queue number or Appointment Pass'],
  chat: ['Chat with OSS', 'Message the front desk directly'],
};

let visitorView = 'visit';
let visitStep = sessionStorage.getItem('oss_visitStep') || 'pick';
let visitVisitorType = sessionStorage.getItem('oss_visitVisitorType') || 'Student';
let visitSelectedService = JSON.parse(sessionStorage.getItem('oss_visitSelectedService') || 'null');
let myActiveQueueId = sessionStorage.getItem('oss_myActiveQueueId') || null;
let currentPublicChatId = sessionStorage.getItem('oss_currentPublicChatId') || null;
let ticketPollTimer = null;

function persistSession() {
  sessionStorage.setItem('oss_visitStep', visitStep);
  sessionStorage.setItem('oss_visitVisitorType', visitVisitorType);
  sessionStorage.setItem('oss_visitSelectedService', JSON.stringify(visitSelectedService));
  sessionStorage.setItem('oss_myActiveQueueId', myActiveQueueId || '');
  sessionStorage.setItem('oss_currentPublicChatId', currentPublicChatId || '');
}

/* entry: honor ?flow=visit|checkvisit|chat from links elsewhere in the site */
(function initFromUrl() {
  const params = new URLSearchParams(location.search);
  const flow = params.get('flow');
  if (flow && VISITOR_TITLES[flow]) visitorView = flow;
})();

function navigateVisitor(key) {
  stopTicketPolling();
  stopChatPolling();
  visitorView = key;
  document.getElementById('visitorPageTitle').textContent = VISITOR_TITLES[key][0];
  document.getElementById('visitorPageSub').textContent = VISITOR_TITLES[key][1];
  renderVisitorSidebar();
  document.getElementById('visitorSidebar').classList.remove('open');
  if (key === 'visit') renderVisitScreen();
  if (key === 'chat') renderChatScreen();
  if (key === 'checkvisit') renderCheckVisitScreen();
}
function renderVisitorSidebar() {
  document.getElementById('visitorNavList').innerHTML = VISITOR_NAV.map(n => {
    const db = loadDB();
    const badge = n.key === 'chat' && currentPublicChatId ? (db.chats.find(c => c.id === currentPublicChatId)?.visitorUnread || 0) : 0;
    return `
    <li>
      <button class="nav-item ${visitorView === n.key ? 'active' : ''}" onclick="navigateVisitor('${n.key}')">
        ${icon(n.ic)}<span>${n.label}</span>${badge ? `<span class="nav-badge">${badge}</span>` : ''}
      </button>
    </li>`;
  }).join('');
}

/* ---- Start a Visit: pick -> choose -> walkin/schedule -> ticket ---- */
function renderVisitScreen() {
  if (myActiveQueueId) {
    const db = loadDB();
    const q = db.queues.find(x => x.id === myActiveQueueId);
    if (q) { visitStep = 'ticket'; persistSession(); renderQueueTicket(); return; }
    myActiveQueueId = null; persistSession();
  }
  if (visitStep === 'choose') renderVisitChoose();
  else if (visitStep === 'walkin') renderVisitWalkinForm();
  else if (visitStep === 'schedule') renderVisitScheduleForm();
  else { visitStep = 'pick'; renderVisitPicker(); }
}
function renderVisitPicker() {
  const db = loadDB();
  document.getElementById('visitorContent').innerHTML = `
    <div class="svc-picker-head">
      <h2>Welcome to OSS UniServe</h2>
      <p>Choose who you are, then the service you need. You'll decide to walk in or schedule ahead next.</p>
    </div>
    <div class="card card-pad visitor-page-wrap" style="margin-bottom:18px;">
      <div class="field" style="margin-bottom:0;">
        <label>I am a</label>
        <select id="visitVisitorTypeSel" onchange="visitVisitorType=this.value; persistSession();">
          <option value="Student" ${visitVisitorType === 'Student' ? 'selected' : ''}>Student</option>
          <option value="Guest" ${visitVisitorType === 'Guest' ? 'selected' : ''}>Guest</option>
        </select>
      </div>
    </div>
    <div class="svc-grid">
      ${db.services.map(s => `
        <button class="svc-card" onclick="pickVisitService('${s.key}')">
          <span class="svc-ic">${icon(s.icon || 'home', 22)}</span>
          <h3>${escapeHtml(s.label)}</h3>
          <p>${escapeHtml(s.desc || '')}</p>
          <span class="svc-go">Continue &rarr;</span>
        </button>
      `).join('')}
    </div>
  `;
}
function pickVisitService(key) {
  const sel = document.getElementById('visitVisitorTypeSel');
  if (sel) visitVisitorType = sel.value;
  const db = loadDB();
  visitSelectedService = findService(db, key);
  visitStep = 'choose';
  persistSession();
  renderVisitChoose();
}
function renderVisitChoose() {
  const svc = visitSelectedService;
  document.getElementById('visitorContent').innerHTML = `
    <div class="svc-selected-bar">
      <div class="lbl">${icon(svc.icon || 'home', 16)} &nbsp;${escapeHtml(svc.label)}<small>${visitVisitorType} &middot; Selected service</small></div>
      <button class="btn btn-ghost btn-sm" onclick="visitStep='pick'; persistSession(); renderVisitScreen();">Change service</button>
    </div>
    ${requirementsBoxHtml(svc)}
    <div class="entry-method-head"><p>Same OSS service, two ways in &mdash; pick whichever fits your visit.</p></div>
    <div class="entry-method-grid">
      <button class="svc-card entry-method-card" onclick="startWalkIn()">
        <span class="svc-ic">${icon('ticket', 22)}</span>
        <h3>Walk In</h3>
        <p>Get your queue number now. For visitors who are already at OSS or coming without a scheduled time.</p>
        <span class="svc-go">Get a queue number &rarr;</span>
      </button>
      <button class="svc-card entry-method-card" onclick="startSchedule()">
        <span class="svc-ic">${icon('calendar', 22)}</span>
        <h3>Schedule Ahead</h3>
        <p>Reserve a date and time. For visitors who want to plan their visit in advance.</p>
        <span class="svc-go">Book a date &amp; time &rarr;</span>
      </button>
    </div>
  `;
}

/* ---- Walk In ---- */
function startWalkIn() { visitStep = 'walkin'; persistSession(); renderVisitWalkinForm(); }
function renderVisitWalkinForm() {
  const svc = visitSelectedService;
  document.getElementById('visitorContent').innerHTML = `
    <div class="svc-selected-bar">
      <div class="lbl">${icon('ticket', 16)} &nbsp;Walk In<small>${visitVisitorType} &middot; ${escapeHtml(svc.label)}</small></div>
      <button class="btn btn-ghost btn-sm" onclick="visitStep='choose'; persistSession(); renderVisitScreen();">Change entry method</button>
    </div>
    <div class="card card-pad visitor-page-wrap">
      <div class="field"><label>Full Name <span class="muted" style="font-weight:400;">(optional)</span></label><input id="qName" placeholder="Juan Dela Cruz"></div>
      <div class="form-row">
        <div class="field"><label>${visitVisitorType === 'Student' ? 'Student Number' : 'Valid ID Number'} <span class="muted" style="font-weight:400;">(optional)</span></label><input id="qIdNum"></div>
        <div class="field"><label>Contact Number <span class="muted" style="font-weight:400;">(optional)</span></label><input id="qContact"></div>
      </div>
      <p class="field-hint" style="margin-bottom:14px;">You'll receive a queue number right away. Watch the "Now Serving" board and proceed to the OSS Admin when your number is called.</p>
      <button class="btn btn-gold btn-block" onclick="confirmWalkIn()">${icon('ticket', 16)} Get My Queue Number</button>
    </div>
  `;
}
function confirmWalkIn() {
  const svc = visitSelectedService;
  const name = document.getElementById('qName').value.trim();
  const idNumber = document.getElementById('qIdNum').value.trim();
  const contact = document.getElementById('qContact').value.trim();
  const db = loadDB();
  const entry = addToQueue(db, {
    visitorType: visitVisitorType, serviceKey: svc.key, serviceLabel: svc.label,
    source: 'Walk-in', name: name || (visitVisitorType + ' Visitor'), idNumber, contact,
  });
  saveDB(db);
  myActiveQueueId = entry.id;
  visitStep = 'ticket';
  persistSession();
  renderQueueTicket();
}

/* ---- Schedule Ahead ---- */
function startSchedule() { visitStep = 'schedule'; persistSession(); renderVisitScheduleForm(); }
function renderVisitScheduleForm() {
  const svc = visitSelectedService;
  document.getElementById('visitorContent').innerHTML = `
    <div class="svc-selected-bar">
      <div class="lbl">${icon('calendar', 16)} &nbsp;Schedule Ahead<small>${visitVisitorType} &middot; ${escapeHtml(svc.label)}</small></div>
      <button class="btn btn-ghost btn-sm" onclick="visitStep='choose'; persistSession(); renderVisitScreen();">Change entry method</button>
    </div>
    <div class="card card-pad visitor-page-wrap">
      <div class="field"><label>Full Name</label><input id="bkName" placeholder="Juan Dela Cruz"></div>
      <div class="form-row">
        <div class="field"><label>${visitVisitorType === 'Student' ? 'Student Number' : 'Valid ID Number'}</label><input id="bkIdNum" placeholder="2023-00000"></div>
        <div class="field"><label>Contact Number</label><input id="bkContact" placeholder="09XX-XXX-XXXX"></div>
      </div>
      <div class="form-row">
        <div class="field"><label>Preferred Date</label><input id="bkDate" type="date" min="${today()}" value="${today()}"></div>
        <div class="field"><label>Preferred Time</label><input id="bkTime" type="time" value="09:00"></div>
      </div>
      <div class="field">
        <label>Upload Requirements</label>
        <input id="bkFiles" type="file" multiple>
        <div class="field-hint">Attach the documents listed above (images or PDF). You can select more than one file.</div>
      </div>
      <p class="field-hint" style="margin-bottom:14px;">You'll get an Appointment Pass with a scannable code. It automatically becomes part of the Service Queue when you check in on the day of your visit.</p>
      <button class="btn btn-primary btn-block" id="bkSubmitBtn" onclick="confirmSchedule()">Confirm Schedule &amp; Get Pass</button>
    </div>
  `;
}
function formatTimeInput(t) {
  const [h, m] = t.split(':').map(Number);
  const ap = h >= 12 ? 'PM' : 'AM'; const hh = h % 12 || 12;
  return `${hh}:${pad2(m)} ${ap}`;
}
async function confirmSchedule() {
  const svc = visitSelectedService;
  const name = document.getElementById('bkName').value.trim();
  const idNumber = document.getElementById('bkIdNum').value.trim();
  const contact = document.getElementById('bkContact').value.trim();
  const date = document.getElementById('bkDate').value;
  const time = document.getElementById('bkTime').value;
  if (!name || !contact || !date || !time) { toast('Please complete all required fields.', 'err'); return; }
  const btn = document.getElementById('bkSubmitBtn');
  btn.disabled = true; btn.textContent = 'Uploading...';
  let attachments = [];
  try { attachments = await readFilesAsAttachments(document.getElementById('bkFiles').files); }
  catch (e) { toast('Could not read one of the uploaded files.', 'err'); }
  const db = loadDB();
  const appt = mkAppt({ name, type: visitVisitorType, idNumber, contact, service: svc.label, date, time: formatTimeInput(time), status: 'Booked', attachments });
  db.appointments.push(appt);
  saveDB(db);
  showPassModal(appt);
}
function showPassModal(appt) {
  openModal(`Appointment Pass &mdash; ${appt.code}`, `
    <div class="pass-card">
      <div class="pass-top">
        <div class="org">Office of Student Services<b>${appt.service}</b></div>
        <span class="pass-type">${appt.type}</span>
      </div>
      <div class="pass-body">
        <div class="pass-info">
          <div class="name">${escapeHtml(appt.name)}</div>
          <div class="meta">${appt.idNumber ? ('ID: ' + escapeHtml(appt.idNumber) + '<br>') : ''}${appt.date} &middot; ${appt.time}</div>
          <div class="pass-code">${appt.code}</div>
        </div>
        <div class="qr-box">${mockQR(appt.code)}</div>
      </div>
    </div>
    <p class="field-hint" style="margin-top:14px;">Present this code at the OSS front desk on your scheduled visit &mdash; checking in automatically places you in the Service Queue.</p>
    <div style="margin-top:14px;">
      <label style="display:block; font-size:.78rem; font-weight:600; margin-bottom:6px; color:var(--text-soft);">Uploaded Requirements</label>
      ${attachListHtml(appt.attachments, 'No files uploaded with this booking.')}
    </div>
  `, [{ label: 'Done', cls: 'btn-primary', action: () => { closeModal(); visitStep = 'pick'; visitSelectedService = null; persistSession(); renderVisitScreen(); } }]);
}

/* ---- Live Queue Ticket ---- */
function renderQueueTicket() {
  const db = loadDB();
  const q = db.queues.find(x => x.id === myActiveQueueId);
  if (!q) { myActiveQueueId = null; visitStep = 'pick'; persistSession(); renderVisitScreen(); return; }
  const ahead = q.status === 'Waiting' ? peopleAheadOf(db, q.id) : 0;
  const etaMin = ahead * QUEUE_AVG_MINUTES;
  const nowServingList = servingQueueEntries(db);

  let bannerHtml = '';
  if (q.status === 'Waiting') {
    bannerHtml = `
      <div class="qt-status">WAITING</div>
      <div class="qt-ahead">${ahead === 0 ? 'You are next in line' : `${ahead} ${ahead === 1 ? 'person' : 'people'} ahead of you`}</div>
      <div class="qt-eta">Estimated wait: ~${etaMin < 1 ? 'a few' : etaMin} minute${etaMin === 1 ? '' : 's'}</div>`;
  } else if (q.status === 'Called') {
    bannerHtml = `
      <div class="qt-callout">
        <div class="qt-callout-title">${icon('megaphone', 20)} IT'S YOUR TURN</div>
        <div class="qt-callout-sub">Please proceed to</div>
        <div class="qt-admin-name">${escapeHtml(q.assignedAdminName || 'the OSS Admin')}</div>
      </div>`;
  } else if (q.status === 'Serving') {
    bannerHtml = `
      <div class="qt-status qt-serving">SERVING</div>
      <div class="qt-ahead">You are currently being assisted by</div>
      <div class="qt-admin-name">${escapeHtml(q.assignedAdminName || 'the OSS Admin')}</div>`;
  } else if (q.status === 'Completed') {
    bannerHtml = `<div class="qt-status qt-done">COMPLETED</div><div class="qt-ahead">Thank you &mdash; your request has been served.</div>`;
  } else if (q.status === 'Skipped') {
    bannerHtml = `<div class="qt-status qt-skip">SKIPPED</div><div class="qt-ahead">We called your number but couldn't reach you. Please see the front desk.</div>`;
  } else if (q.status === 'Cancelled') {
    bannerHtml = `<div class="qt-status qt-skip">CANCELLED</div>`;
  }

  const finished = ['Completed', 'Skipped', 'Cancelled'].includes(q.status);
  const sourceNote = q.source === 'Appointment' ? `<div class="qt-source-note">From your Appointment Pass${q.appointmentId ? ' &middot; checked in' : ''}</div>` : '';

  document.getElementById('visitorContent').innerHTML = `
    <div class="queue-ticket-wrap">
      <div class="queue-ticket-card">
        <div class="qt-label">YOUR NUMBER</div>
        <div class="qt-number">${q.number}</div>
        <div class="qt-service">${escapeHtml(serviceQueueLabel(db, q))} &middot; ${q.visitorType}</div>
        ${sourceNote}
        <div class="qt-divider"></div>
        ${bannerHtml}
      </div>
      <div class="qt-nowserving">
        <div class="qt-nowserving-lbl">Now Serving</div>
        <div class="qt-nowserving-row">
          ${nowServingList.length ? nowServingList.map(e => `<span class="pill ${e.id === q.id ? 'pill-gold' : 'pill-info'}">${e.number}</span>`).join('') : `<span class="muted" style="font-size:.8rem;">No one is being served yet.</span>`}
        </div>
      </div>
      ${!finished ? `<button class="btn btn-ghost btn-block" onclick="cancelMyQueue()">Cancel this queue number</button>` : `<button class="btn btn-primary btn-block" onclick="myActiveQueueId=null; visitStep='pick'; persistSession(); renderVisitScreen();">Start Another Visit</button>`}
    </div>
  `;
  startTicketPolling();
}
function cancelMyQueue() {
  if (!myActiveQueueId) return;
  const db = loadDB();
  cancelQueue(db, myActiveQueueId);
  saveDB(db);
  toast('Queue number cancelled.', 'ok');
  myActiveQueueId = null; visitStep = 'pick'; persistSession();
  renderVisitScreen();
}
function startTicketPolling() {
  stopTicketPolling();
  ticketPollTimer = setInterval(() => {
    if ((visitorView === 'visit' || visitorView === 'checkvisit') && myActiveQueueId) renderQueueTicket();
  }, 3000);
}
function stopTicketPolling() { if (ticketPollTimer) { clearInterval(ticketPollTimer); ticketPollTimer = null; } }

/* ---- Check My Visit ---- */
function renderCheckVisitScreen() {
  document.getElementById('visitorContent').innerHTML = `
    <div class="card card-pad visitor-page-wrap">
      <div class="field"><label>Queue Number or Appointment Code</label><input id="cvCode" placeholder="e.g. A-003 or APT-AB12CD" style="text-transform:uppercase;"></div>
      <button class="btn btn-primary btn-block" onclick="lookupMyVisit()">Check Status</button>
      <p class="field-hint" style="margin-top:12px;">Already have a queue number? Enter it to see your live position. Have an Appointment Pass instead? Enter its code to view it again.</p>
    </div>
  `;
}
function lookupMyVisit() {
  const code = document.getElementById('cvCode').value.trim().toUpperCase();
  if (!code) { toast('Enter a queue number or appointment code.', 'err'); return; }
  const db = loadDB();
  const q = db.queues.find(x => x.number.toUpperCase() === code);
  if (q) { myActiveQueueId = q.id; persistSession(); navigateVisitor('visit'); return; }
  const appt = db.appointments.find(x => x.code.toUpperCase() === code);
  if (appt) { showPassModalReadonly(appt); return; }
  toast('No queue number or appointment code found.', 'err');
}
function showPassModalReadonly(appt) {
  openModal(`Visitor Pass &mdash; ${appt.code}`, `
    <div class="pass-card">
      <div class="pass-top"><div class="org">Office of Student Services<b>${appt.service}</b></div><span class="pass-type">${appt.type}</span></div>
      <div class="pass-body">
        <div class="pass-info">
          <div class="name">${escapeHtml(appt.name)}</div>
          <div class="meta">${appt.date} &middot; ${appt.time}</div>
          <div class="pass-code">${appt.code}</div>
        </div>
        <div class="qr-box">${mockQR(appt.code)}</div>
      </div>
    </div>
    <div style="margin-top:14px;">
      <label style="display:block; font-size:.78rem; font-weight:600; margin-bottom:6px; color:var(--text-soft);">Uploaded Requirements</label>
      ${attachListHtml(appt.attachments, 'No files uploaded with this booking.')}
    </div>
  `, [{ label: 'Close', cls: 'btn-primary', action: closeModal }]);
}

/* ---- Chat with OSS ---- */
function renderChatScreen() {
  if (currentPublicChatId) {
    const db = loadDB();
    const c = db.chats.find(x => x.id === currentPublicChatId);
    if (c) { renderPublicChatThread(c); return; }
    currentPublicChatId = null; persistSession();
  }
  document.getElementById('visitorContent').innerHTML = `
    <div class="card card-pad visitor-page-wrap">
      <div class="field"><label>Have a conversation code?</label><input id="chResume" placeholder="e.g. CHT-AB12CD" style="text-transform:uppercase;"></div>
      <button class="btn btn-ghost btn-block" onclick="resumeChat()">Resume Conversation</button>
      <div class="divider"></div>
      <div class="field"><label>I am a</label><select id="chType"><option value="Student">Student</option><option value="Guest">Guest / Visitor</option></select></div>
      <div class="field"><label>Full Name</label><input id="chName" placeholder="Juan Dela Cruz"></div>
      <div class="field"><label>Contact Number (optional)</label><input id="chContact" placeholder="09XX-XXX-XXXX"></div>
      <div class="field"><label>Your Message</label><textarea id="chMsg" placeholder="How can the OSS office help you?"></textarea></div>
      <div class="field"><label>Attach Requirements <span class="muted" style="font-weight:400;">(optional)</span></label><input id="chFiles" type="file" multiple></div>
      <button class="btn btn-primary btn-block" id="chStartBtn" onclick="startChat()">Start Conversation</button>
    </div>
  `;
}
function resumeChat() {
  const code = document.getElementById('chResume').value.trim().toUpperCase();
  if (!code) { toast('Enter a conversation code.', 'err'); return; }
  const db = loadDB();
  const c = db.chats.find(x => x.code === code);
  if (!c) { toast('No conversation found with that code.', 'err'); return; }
  currentPublicChatId = c.id; persistSession();
  renderChatScreen(); renderVisitorSidebar();
}
async function startChat() {
  const name = document.getElementById('chName').value.trim();
  const type = document.getElementById('chType').value;
  const contact = document.getElementById('chContact').value.trim();
  const msg = document.getElementById('chMsg').value.trim();
  if (!name || !msg) { toast('Please enter your name and message.', 'err'); return; }
  const btn = document.getElementById('chStartBtn');
  btn.disabled = true; btn.textContent = 'Sending...';
  let attachments = [];
  try { attachments = await readFilesAsAttachments(document.getElementById('chFiles').files); }
  catch (e) { toast('Could not read one of the uploaded files.', 'err'); }
  const db = loadDB();
  const chat = mkChat({ visitorName: name, visitorType: type, contact, status: 'Open', createdAt: new Date(), updatedAt: new Date() });
  chat.messages.push({ id: uid('MSG'), sender: 'visitor', senderName: name, text: msg, ts: new Date(), attachments });
  chat.staffUnread = 1;
  db.chats.push(chat);
  saveDB(db);
  currentPublicChatId = chat.id; persistSession();
  renderChatScreen(); renderVisitorSidebar();
}
function renderPublicChatThread(c) {
  const db = loadDB();
  const fresh = db.chats.find(x => x.id === c.id);
  if (fresh) { fresh.visitorUnread = 0; saveDB(db); c = fresh; }
  renderVisitorSidebar();
  document.getElementById('visitorContent').innerHTML = `
    <div class="card visitor-page-wrap" data-chat-status="${c.status}">
      <div class="card-head" style="display:flex; align-items:center; justify-content:space-between; padding:18px 22px; border-bottom:1px solid var(--border); gap:12px; flex-wrap:wrap;">
        <div>
          <h3>${escapeHtml(c.visitorName)}'s Conversation</h3>
          <div class="mono muted" style="font-size:.72rem; margin-top:2px;">${c.code}</div>
        </div>
        <div style="display:flex; align-items:center; gap:10px;">
          ${statusPill(c.status)}
          <button class="btn btn-ghost btn-sm" onclick="currentPublicChatId=null; persistSession(); renderChatScreen(); renderVisitorSidebar();">New Conversation</button>
        </div>
      </div>
      <div class="chat-messages" id="chatMsgArea" style="max-height:420px;">${renderBubbles(c)}</div>
      ${c.status === 'Open' ? `
      <div class="chat-input-row" style="flex-direction:column; align-items:stretch;">
        <textarea id="chReply" placeholder="Type a message..."></textarea>
        <input id="chReplyFiles" type="file" multiple style="margin-top:8px;">
        <button class="btn btn-primary" id="chReplyBtn" onclick="sendVisitorMessage('${c.id}')" style="margin-top:8px;">Send Message</button>
      </div>` : `<p class="field-hint" style="padding:14px 20px;">This conversation has been closed by OSS staff.</p>`}
    </div>
    <p class="field-hint" style="margin-top:10px;">Save your conversation code &mdash; you can use it to resume this conversation later from the Chat tab.</p>
  `;
  const area = document.getElementById('chatMsgArea');
  if (area) area.scrollTop = area.scrollHeight;
  startChatPolling(c.id);
}
/* Lightweight poll refresh — only touches the message list (and does a
   full re-render if the conversation's status changed), so a visitor
   mid-draft in the reply box never has their typing wiped out. */
function refreshChatIfNeeded(chatId) {
  const db = loadDB();
  const c = db.chats.find(x => x.id === chatId);
  if (!c) return;
  const wrap = document.querySelector('#visitorContent [data-chat-status]');
  if (!wrap || wrap.dataset.chatStatus !== c.status) { renderPublicChatThread(c); return; }
  const area = document.getElementById('chatMsgArea');
  if (!area) return;
  if (c.messages.length !== area.querySelectorAll('.bubble').length) {
    if (c.staffUnread === undefined) { } // no-op, keep staffUnread untouched here
    area.innerHTML = renderBubbles(c);
    area.scrollTop = area.scrollHeight;
  }
}
function renderBubbles(c) {
  if (!c.messages.length) return `<div class="muted" style="font-size:.8rem; padding:10px;">No messages yet.</div>`;
  return c.messages.map(m => `
    <div class="bubble ${m.sender}">
      <div class="who">${m.sender === 'staff' ? escapeHtml(m.senderName || 'OSS Staff') : escapeHtml(m.senderName || 'Visitor')}</div>
      <div>${escapeHtml(m.text)}</div>
      ${m.attachments && m.attachments.length ? `<div class="attach-list">${m.attachments.map(attachChip).join('')}</div>` : ''}
      <div class="ts">${fmtDateTime(m.ts)}</div>
    </div>
  `).join('');
}
function statusPill(status) {
  const map = { Open: 'pill-info', Closed: 'pill-danger' };
  return `<span class="pill ${map[status] || 'pill-info'}">${status}</span>`;
}
async function sendVisitorMessage(id) {
  const db = loadDB();
  const c = db.chats.find(x => x.id === id);
  const ta = document.getElementById('chReply');
  const text = ta.value.trim();
  if (!text) return;
  const btn = document.getElementById('chReplyBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
  let attachments = [];
  try { attachments = await readFilesAsAttachments(document.getElementById('chReplyFiles')?.files); }
  catch (e) { toast('Could not read one of the uploaded files.', 'err'); }
  c.messages.push({ id: uid('MSG'), sender: 'visitor', senderName: c.visitorName, text, ts: new Date(), attachments });
  c.staffUnread = (c.staffUnread || 0) + 1;
  c.updatedAt = new Date();
  saveDB(db);
  renderPublicChatThread(c);
}
let chatPollTimer = null;
function startChatPolling(chatId) {
  stopChatPolling();
  chatPollTimer = setInterval(() => {
    if (visitorView !== 'chat' || currentPublicChatId !== chatId) return;
    refreshChatIfNeeded(chatId);
  }, 4000);
}
function stopChatPolling() { if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; } }

/* ---- boot ---- */
renderVisitorSidebar();
navigateVisitor(visitorView);