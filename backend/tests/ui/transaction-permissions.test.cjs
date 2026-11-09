const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../../../Admin/admin.js'),'utf8');
test('read-only transaction viewers see record details without escalation editing',()=>{
 for(const editCase of [false,true]){
  const record={id:'case',code:'CASE-1',name:'Visitor',type:'Student',service:'concern',status:'Completed',createdAt:new Date(),permissions:{editCase},shared:true};let modal;
  const c={window:null,currentUser:{id:'admin',fullName:'Admin'},OfficeCalendar:{parts:()=>({date:'2026-11-08'})},loadDB:()=>({transactions:[record],queues:[],appointments:[]}),isTxnLocked:()=>false,isConfidentialTxn:()=>true,txnRequirements:()=>[],ESCALATABLE_SERVICES:['concern'],openModal:(title,body,buttons)=>modal={body,buttons},escapeHtml:String,icon:()=>'',requestorLabel:name=>name,serviceLabel:()=> 'Concern',statusPill:String,fmtDateTime:String,feedbackReadoutHtml:()=>'',attachListHtml:()=>'',document:{getElementById:()=>null,addEventListener(){}}};
  c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../../shared/visit-enhancements.js'),'utf8'),c);vm.runInContext(source.slice(source.indexOf('function openTxnDetail('),source.indexOf('function printTransaction(')),c);c.openTxnDetail('case');
  assert.ok(modal.body.includes('Visitor'));assert.equal(modal.buttons.some(button=>button.label==='Save'),editCase);assert.equal(modal.body.includes('id="mTxEscalation"'),editCase);
 }
});
