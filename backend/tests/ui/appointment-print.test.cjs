const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../Admin/admin.js'),'utf8');
function setup(record,deny=false){let printed='',error='',reads=0;const context={isConfidentialTxn:()=>false,loadDB:()=>({appointments:[record],queues:record.queue?[record.queue]:[]}),queueRequirementState:()=>({ready:true,items:[{label:'Valid ID',checked:true,source:'counter'}]}),SharedAppointments:{request:async()=>{reads++;if(deny)throw Error('Confidential access required.');return {appointments:[record]};},cache:()=>{}},printInjected:html=>printed=html,reportLetterhead:()=>'<header>University</header>',escapeHtml:value=>String(value).replaceAll('<','&lt;').replaceAll('>','&gt;'),UniServeUX:{timeLabel:value=>value},fmtDateTime:()=> 'Oct 23, 2026',toast:message=>error=message,Date,encodeURIComponent};vm.createContext(context);vm.runInContext(source.slice(source.indexOf('function completedVisitPrintDetails('),source.indexOf('const RANGES =')),context);return {context,result:()=>({printed,error,reads})};}
test('printing uses a fresh authorized appointment and escapes visitor content',async()=>{
 const {context,result}=setup({id:'a',shared:true,name:'<Visitor>',visitId:'VIS-A',service:'Activity approval',date:'2026-10-23',time:'09:00',status:'Booked',attachments:[{name:'requirements.pdf',dataUrl:'secret-file-content'}]});await context.printAppointmentRecord('a');const r=result();assert.equal(r.reads,1);for(const text of ['Appointment Record','VIS-A','&lt;Visitor&gt;','requirements.pdf'])assert.ok(r.printed.includes(text));assert.ok(!r.printed.includes('secret-file-content'));
});
test('restricted appointment records cannot be printed',async()=>{const {context,result}=setup({id:'a',restricted:true});await context.printAppointmentRecord('a');assert.equal(result().printed,'');assert.match(result().error,/confidential access/);});
test('server permission errors stop printing',async()=>{const {context,result}=setup({id:'a',shared:true},true);await context.printAppointmentRecord('a');assert.equal(result().printed,'');assert.match(result().error,/Confidential access/);});

test('completed appointment print contains actual service and readiness details',async()=>{
 const {context,result}=setup({id:'a',queueId:'q',status:'Completed',name:'Visitor',attachments:[{name:'id.pdf',review:{status:'Accepted',requirement:'Valid ID'}}],queue:{id:'q',status:'Completed',assignedAdminName:'Staff member',checkedInAt:'2026-10-23',servingAt:'2026-10-23',completedAt:'2026-10-23',notes:'Service finished',serviceHistory:[{serviceLabel:'Approval',outcome:'Completed',adminName:'Staff member'}]}});
 await context.printAppointmentRecord('a');
 assert.equal(result().error,'');
 for(const text of ['Completed Visit Record','Actual check-in','Service started','Staff member','Service finished','Requirements complete','Checked at counter','Accepted','Service history'])assert.ok(result().printed.includes(text),text);
 assert.ok(!result().printed.includes('undefined'));
});
