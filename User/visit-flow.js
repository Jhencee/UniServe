// Session-only drafts; no passwords or file contents are persisted.
const VISIT_DRAFT_KEY = 'oss_visitor_draft_v1';
function readVisitDrafts() { try { return JSON.parse(sessionStorage.getItem(VISIT_DRAFT_KEY) || '{}'); } catch (_) { return {}; } }
function captureVisitorDraft() {
  if (typeof visitVisitorType === 'undefined') return;
  const drafts = readVisitDrafts(), draft = drafts[visitVisitorType] || {};
  document.querySelectorAll('#visitorContent input, #visitorContent select').forEach(input => {
    const match = /^(?:q|bk)(First|Last|IdNum|IdType|Contact|Email|PWD|PreferredDate)$/.exec(input.id);
    if (match) draft[match[1]] = input.type === 'checkbox' ? input.checked : input.value;
  });
  drafts[visitVisitorType] = draft;
  sessionStorage.setItem(VISIT_DRAFT_KEY, JSON.stringify(drafts));
}
function restoreVisitorDraft(prefix) {
  let draft = readVisitDrafts()[visitVisitorType] || {};
  if (!Object.keys(draft).length && sessionStorage.getItem('ossuniserve_visitor_token') && typeof loadDB==='function') {
    const db=loadDB(), record=[...(db.appointments||[]),...(db.queues||[])].filter(r=>!r.restricted&&r.name&&r.name!=='Restricted record'&&(r.type||r.visitorType)===visitVisitorType).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))[0];
    if(record){const names=record.name.trim().split(/\s+/);draft={First:names.shift(),Last:names.join(' '),Email:record.email||'',Contact:record.contact||'',IdNum:record.idNumber||'',IdType:record.idType||'',PWD:!!record.isPWD};}
  }
  Object.entries(draft).forEach(([suffix,value]) => {
    const input = document.getElementById(prefix + suffix); if (!input) return;
    if (input.type === 'checkbox') input.checked = !!value; else { input.value = value; if(suffix==='Contact') formatContactInput(input); }
  });
}
function clearVisitorDraft() { sessionStorage.removeItem(VISIT_DRAFT_KEY); }
document.addEventListener('input', event => { if (/^(q|bk)(First|Last|IdNum|IdType|Contact|Email|PWD|PreferredDate)$/.test(event.target.id || '')) captureVisitorDraft(); });
document.addEventListener('change', event => { if (/^(q|bk)(First|Last|IdNum|IdType|Contact|Email|PWD|PreferredDate)$/.test(event.target.id || '')) captureVisitorDraft(); });
let visitorPassActions = [];
function runVisitorPassAction(index) { return visitorPassActions[index]?.action(); }
function refreshAppointmentPass() {
  const id = sessionStorage.getItem('oss_activeAppointmentId'), appt = loadDB().appointments.find(a => a.id === id);
  if (appt) showPassModalReadonly(appt, true); else navigateVisitor('checkvisit');
}
