const DB_KEY = 'ossuniserve_db_v1';

const ROLES = {
    SUPER_ADMIN: { label: 'Super Admin' },
    ADMIN: { label: 'Admin' },
};

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
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return d; };
const randCode = (prefix) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = ''; for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return `${prefix}-${s}`;
};
const slugify = s => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || uid('svc');
function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- seed / persistence ---------------- */
function freshState() {
    const s = {
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
    return s;
}
function mkTxn(o) { return { id: uid('T'), code: randCode('OSS'), status: 'Pending', ...o, updatedAt: o.createdAt || new Date() }; }
function mkAppt(o) { return { id: uid('A'), code: randCode('APT'), ...o }; }
function mkIncident(o) { return { id: uid('IR'), code: randCode('INC'), actions: '', sensitive: true, ...o }; }
function mkScholarship(o) { return { id: uid('SCH'), ...o }; }
function mkChat(o) { return { id: uid('CH'), code: randCode('CHT'), status: 'Open', messages: [], staffUnread: 0, visitorUnread: 0, ...o }; }
function mkLog(user, role, action, ts) { return { id: uid('L'), user, role, action, ts: ts || new Date() }; }
function mkQueue(o) {
    return { id: uid('Q'), status: 'Waiting', createdAt: new Date(), calledAt: null, servingAt: null, completedAt: null, assignedAdminId: null, assignedAdminName: null, transactionId: null, appointmentId: null, recallCount: 0, ...o };
}

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

    s.activityLog.push(mkLog('System Administrator', 'SUPER_ADMIN', 'System initialized', daysAgo(7)));
}

/* revive Date fields after JSON round-trip */
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
    if (!raw) {
        const s = freshState();
        seedDemoData(s);
        localStorage.setItem(DB_KEY, JSON.stringify(s));
        return s;
    }
    try { return reviveDates(JSON.parse(raw)); }
    catch (e) { const s = freshState(); seedDemoData(s); localStorage.setItem(DB_KEY, JSON.stringify(s)); return s; }
}
function saveDB(s) { localStorage.setItem(DB_KEY, JSON.stringify(s)); }
function resetDB() {
    const s = freshState();
    seedDemoData(s);
    saveDB(s);
    return s;
}

/* current session (who's logged in / active visitor ticket) — small,
   separate key so it doesn't get wiped by a data export/reset */
function loadSession() {
    try { return JSON.parse(sessionStorage.getItem('ossuniserve_session') || '{}'); }
    catch (e) { return {}; }
}
function saveSession(obj) { sessionStorage.setItem('ossuniserve_session', JSON.stringify(obj)); }

/* ---------------- queue logic (shared by User + Admin pages) ---------------- */
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
function findService(db, serviceKey) {
    return db.services.find(x => x.key === serviceKey) || db.services.find(x => x.label === serviceKey);
}
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
function todaysQueue(db) { const t = today(); return db.queues.filter(q => fmtDate(q.createdAt) === t); }
function queueStats(db) {
    const list = todaysQueue(db);
    const waiting = list.filter(q => q.status === 'Waiting').length;
    const serving = list.filter(q => q.status === 'Serving' || q.status === 'Called').length;
    const completed = list.filter(q => q.status === 'Completed');
    let avgWaitMin = null;
    const withWait = completed.filter(q => q.calledAt);
    if (withWait.length) {
        const totalMs = withWait.reduce((s, q) => s + (new Date(q.calledAt) - new Date(q.createdAt)), 0);
        avgWaitMin = Math.round((totalMs / withWait.length) / 60000);
    }
    const next = waitingQueueSorted(db)[0] || null;
    return { waiting, serving, completedToday: completed.length, avgWaitMin, next };
}

/* ---------------- activity log helper ---------------- */
function logActivity(db, currentUser, action) {
    if (!currentUser) return;
    db.activityLog.unshift(mkLog(currentUser.fullName, currentUser.role, action, new Date()));
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

/* ---------------- icons (inline SVG, no external deps) ---------------- */
function icon(name, size = 17) {
    const p = {
        dashboard: 'M4 13h6V4H4v9zm0 7h6v-5H4v5zm10 0h6V11h-6v9zm0-16v5h6V4h-6z',
        checkin: 'M9 12l2 2 4-4M5 4h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z',
        calendar: 'M8 2v4M16 2v4M3 9h18M5 5h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2z',
        folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z',
        alert: 'M12 3l9 16H3l9-16zM12 10v4M12 17.5v.01',
        cap: 'M12 3l10 5-10 5L2 8l10-5zM6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5',
        chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
        log: 'M4 6h16M4 12h16M4 18h10',
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
        download: 'M12 3v12M6 11l6 6 6-6M5 21h14',
        home: 'M3 12l9-9 9 9M5 10v10h14V10',
        gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z',
        userc: 'M12 12a5 5 0 100-10 5 5 0 000 10zM3 21a9 9 0 0118 0',
        ticket: 'M4 8a2 2 0 012-2h12a2 2 0 012 2v2a2 2 0 000 4v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2a2 2 0 000-4V8zM10 6v2M10 11v2M10 16v2',
        megaphone: 'M3 11v2a2 2 0 002 2h1l3 5 1-1-1-4h5l6 4V6l-6 4H6a2 2 0 00-2 2z',
        arrowright: 'M5 12h14M13 5l7 7-7 7',
        refresh: 'M4 4v6h6M20 20v-6h-6M4 10a8 8 0 0114-5.3L20 8M20 14a8 8 0 01-14 5.3L4 16',
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

/* ---------------- toast / modal (shared UI chrome) ---------------- */
function toast(msg, type = 'ok') {
    let wrap = document.getElementById('toastWrap');
    if (!wrap) { wrap = document.createElement('div'); wrap.id = 'toastWrap'; wrap.className = 'toast-wrap'; document.body.appendChild(wrap); }
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

/* ---------------- theme ---------------- */
function setTheme(t) {
    localStorage.setItem('ossuniserve_theme', t);
    document.documentElement.setAttribute('data-theme', t);
    document.querySelectorAll('[data-theme-btn]').forEach(b => b.classList.toggle('active', b.dataset.themeBtn === t));
}
function initTheme() { setTheme(localStorage.getItem('ossuniserve_theme') || 'light'); }
/* =========================================================================
   LANDING — public home page + staff login + public queue display kiosk
========================================================================= */
document.getElementById('yearNow').textContent = new Date().getFullYear();
/* crest slots now hold <img src="pup.jpg"> directly in the HTML —
   no longer overwritten with the generated crestSVG() shield here. */
initTheme();

/* If a staff session already exists, send them straight to their app
   instead of making them log in again on every visit to the home page. */
(function redirectIfAlreadyLoggedIn() {
    const sess = loadSession();
    if (sess && sess.currentUser) {
        if (sess.currentUser.role === 'SUPER_ADMIN') location.href = '../Super Admin/superadmin.html';
        else if (sess.currentUser.role === 'ADMIN') location.href = '../Admin/admin.html';
    }
})();

let pdTimer = null;

function showScreen(id) {
    stopPdPolling();
    ['landing', 'loginScreen', 'publicDisplay'].forEach(s => document.getElementById(s).hidden = true);
    document.getElementById(id).hidden = false;
    window.scrollTo(0, 0);
}
function showLanding() { showScreen('landing'); }
function showLogin() {
    showScreen('loginScreen');
    document.getElementById('loginErr').hidden = true;
    document.getElementById('loginUser').value = '';
    document.getElementById('loginPass').value = '';
}

function doLogin() {
    const u = document.getElementById('loginUser').value.trim();
    const p = document.getElementById('loginPass').value;
    const errBox = document.getElementById('loginErr');
    const db = loadDB();
    const user = db.users.find(x => x.username.toLowerCase() === u.toLowerCase() && x.password === p);
    if (!user) { errBox.textContent = 'Invalid username or password.'; errBox.hidden = false; return; }
    if (!user.active) { errBox.textContent = 'This account has been deactivated.'; errBox.hidden = false; return; }
    logActivity(db, user, 'Logged in');
    saveDB(db);
    saveSession({ currentUser: user });
    if (user.role === 'SUPER_ADMIN') location.href = '../Super Admin/superadmin.html';
    else location.href = '../Admin/admin.html';
}

/* ---- Public Queue Display (kiosk board for the waiting area) ---- */
function openPublicDisplay() {
    showScreen('publicDisplay');
    renderPublicDisplay();
    pdTimer = setInterval(renderPublicDisplay, 3000);
}
function stopPdPolling() { if (pdTimer) { clearInterval(pdTimer); pdTimer = null; } }
function renderPublicDisplay() {
    const el = document.getElementById('publicDisplayContent');
    if (!el) return;
    const db = loadDB();
    const called = db.queues.filter(q => q.status === 'Called').sort((a, b) => new Date(a.calledAt || 0) - new Date(b.calledAt || 0));
    const serving = db.queues.filter(q => q.status === 'Serving').sort((a, b) => new Date(a.servingAt || 0) - new Date(b.servingAt || 0));
    const waiting = waitingQueueSorted(db).slice(0, 6);

    el.innerHTML = `
    ${called.length ? `
      <div class="pd-callout">
        ${called.map(q => `
          <div class="pd-callout-row">
            <div class="pd-callout-number">${q.number}</div>
            <div class="pd-callout-txt">PLEASE PROCEED TO<br><b>${escapeHtml(q.assignedAdminName || 'OSS Admin')}</b></div>
          </div>
        `).join('')}
      </div>` : ''}
    <div class="pd-serving-lbl">Now Serving</div>
    <div class="pd-serving-grid">
      ${serving.length ? serving.map(q => `
        <div class="pd-serving-card">
          <div class="pd-serving-number">${q.number}</div>
          <div class="pd-serving-admin">${escapeHtml(q.assignedAdminName || 'OSS Admin')}</div>
        </div>`).join('') : `<div class="muted" style="font-size:.95rem;">No one is currently being served.</div>`}
    </div>
    <div class="pd-next-lbl">Next</div>
    <div class="pd-next-row">
      ${waiting.length ? waiting.map(q => `<span class="pd-next-chip">${q.number}</span>`).join('') : `<span class="muted">Queue is empty.</span>`}
    </div>
  `;
}