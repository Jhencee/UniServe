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
