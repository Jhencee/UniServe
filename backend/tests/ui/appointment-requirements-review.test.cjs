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

test('document review uses direct decisions and hides correction fields until needed',()=>{
 const api=fs.readFileSync(path.resolve(__dirname,'../../../shared/appointment-api.js'),'utf8');
 const c={state_view:'appointments',loadDB:()=>({services:[{key:'id',label:'Student ID',requirements:['Valid ID']}]}),escapeHtml:String,attachChip:file=>'<a>'+file.name+'</a>',fmtDateTime:String};c.window=c;
 vm.createContext(c);vm.runInContext(api.slice(api.indexOf('  const correctionOptions='),api.indexOf('  window.replaceVisitDocument=')),c);
 const appointment={id:'a',serviceKey:'id',shared:true,status:'Booked',attachments:[{name:'ID.pdf',review:{status:'Accepted',requirement:'Valid ID',serviceKey:'id'}}]};
 const html=c.documentReviewHtml(appointment,true);assert.match(html,/1 of 1 files accepted/);assert.match(html,/document-decision-accept/);assert.match(html,/document-decision-correct/);assert.match(html,/id="documentCorrection0" hidden/);assert.match(html,/value="Valid ID" selected/);assert.doesNotMatch(html,/<select id="documentStatus/);
 appointment.attachments[0].review={status:'Needs correction',reason:'Please include a signature'};
 const correction=c.documentReviewHtml(appointment,true);assert.match(correction,/id="documentCorrection0">/);assert.match(correction,/<option selected>Other/);assert.match(correction,/Please include a signature/);
});
