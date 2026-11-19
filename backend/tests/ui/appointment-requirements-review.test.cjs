const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../Admin/admin.js'),'utf8');
function setup(extra={}){
 const appointment={id:'a',name:'Visitor',service:'Service',shared:true,status:'Requested',attachments:[{name:'ID.pdf'}],...extra};
 let modal,editable,notice;
 const c={loadDB:()=>({appointments:[appointment]}),escapeHtml:String,icon:()=>'',closeModal(){},toast:message=>notice=message,documentReviewHtml:(a,edit)=>{editable=edit;return '<section>Uploaded requirements</section>';},openModal:(title,body,buttons)=>modal={title,body,buttons}};
 vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('function appointmentActionsHtml('),source.indexOf('async function openAppointmentVisit(')),c);
 return {c,appointment,read:()=>({modal,editable,notice})};
}
test('requested and booked appointments have a separate editable requirements review',()=>{
 for(const status of ['Requested','Booked']){const s=setup({status});assert.match(s.c.appointmentActionsHtml(s.appointment),/reviewAppointmentRequirements/);s.c.reviewAppointmentRequirements('a');assert.equal(s.read().editable,true);assert.match(s.read().modal.body,/Uploaded requirements/);assert.doesNotMatch(s.read().modal.body,/mApptDate|mApptTime/);}
});
test('restricted appointments cannot expose uploaded files',()=>{const s=setup({restricted:true});assert.doesNotMatch(s.c.appointmentActionsHtml(s.appointment),/reviewAppointmentRequirements/);s.c.reviewAppointmentRequirements('a');assert.equal(s.read().modal,undefined);assert.match(s.read().notice,/Confidential/);});
test('missing uploads and closed appointments do not offer document review',()=>{
 for(const extra of [{attachments:[]},{status:'Cancelled'},{status:'Completed'}]){const s=setup(extra);assert.doesNotMatch(s.c.appointmentActionsHtml(s.appointment),/reviewAppointmentRequirements/);}
 const s=setup({status:'Completed'});s.c.reviewAppointmentRequirements('a');assert.equal(s.read().editable,false);
});

test('document review uses one decision dropdown and save action with conditional correction fields',()=>{
 const api=fs.readFileSync(path.resolve(__dirname,'../../../shared/appointment-api.js'),'utf8');
 const c={state_view:'appointments',loadDB:()=>({services:[{key:'id',label:'Student ID',requirements:['Valid ID']}]}),escapeHtml:String,attachChip:file=>'<a>'+file.name+'</a>',fmtDateTime:String};c.window=c;
 vm.createContext(c);vm.runInContext(api.slice(api.indexOf('  const correctionOptions='),api.indexOf('  window.replaceVisitDocument=')),c);
 const appointment={id:'a',serviceKey:'id',shared:true,status:'Booked',attachments:[{name:'ID.pdf',review:{status:'Accepted',requirement:'Valid ID',serviceKey:'id'}}]};
 const html=c.documentReviewHtml(appointment,true);assert.match(html,/1 of 1 files accepted/);assert.match(html,/Not saved yet/);assert.match(html,/<select id="documentStatus0"/);assert.ok(html.includes('>Save readiness</button>'));assert.match(html,/id="documentCorrection0" hidden/);assert.match(html,/value="Valid ID" selected/);assert.doesNotMatch(html,/document-decision-accept|document-decision-correct|class="pill /);
 appointment.attachments[0].review={status:'Needs correction',reason:'Please include a signature'};
 const correction=c.documentReviewHtml(appointment,true);assert.match(correction,/id="documentCorrection0">/);assert.match(correction,/<option selected>Other/);assert.match(correction,/Please include a signature/);
});

test('readiness changes explicitly mark a file unsaved and enable its save button',()=>{
 const api=fs.readFileSync(path.resolve(__dirname,'../../../shared/appointment-api.js'),'utf8');const c={};c.window=c;vm.createContext(c);
 vm.runInContext(api.slice(api.indexOf('  window.markDocumentReadinessUnsaved='),api.indexOf('  window.toggleDocumentReviewCorrection=')),c);
 const note={textContent:'Saved',dataset:{state:'saved'}},button={disabled:true};
 c.markDocumentReadinessUnsaved({querySelector:selector=>selector==='.document-save-state'?note:button});assert.equal(note.textContent,'Unsaved changes');assert.equal(note.dataset.state,'unsaved');assert.equal(button.disabled,false);
});

test('appointment readiness uses verified counter checks without changing uploaded file decisions',()=>{
 const c={findService:()=>({}),computeReadiness:()=>({status:'FOR_REVIEW'}),queueRequirementState:(db,q)=>q.requirementReadiness};vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('function appointmentReadiness('),source.indexOf('function readinessPillHtml(')),c);
 const appointment={id:'a',queueId:'q',attachments:[{review:{status:'Pending review'}}]};
 const db={queues:[{id:'q',appointmentId:'a',requirementReadiness:{ready:true,checked:2,required:2}}]};
 assert.equal(c.appointmentReadiness(db,appointment).status,'READY');assert.equal(appointment.attachments[0].review.status,'Pending review');
 db.queues[0].requirementReadiness={ready:false,checked:1,required:2};assert.equal(c.appointmentReadiness(db,appointment).status,'INCOMPLETE');
 db.queues=[];assert.equal(c.appointmentReadiness(db,appointment).status,'FOR_REVIEW');
});

test('completed appointment menu contains only details, email and print in order',()=>{
 const s=setup({status:'Completed',queueId:'q'});const html=s.c.appointmentActionsHtml(s.appointment);
 const labels=[...html.matchAll(/class="kebab-item" onclick="[^"]*">([^<]+)</g)].map(m=>m[1]);
 assert.deepEqual(labels,['View details','Email details','Print']);assert.doesNotMatch(html,/Review requirements|Reschedule|Cancel|View visit/);
});

test('noncompleted appointment menus do not offer print',()=>{
 for(const status of ['Requested','Booked','Checked-in','Unfinished','No-show','Cancelled']){
  const s=setup({status});assert.doesNotMatch(s.c.appointmentActionsHtml(s.appointment),/printAppointmentRecord|>Print/);
 }
});
