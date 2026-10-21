const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function setup(request){
 const elements=new Map();for(const id of ['centralAuditQ','centralAuditActor','centralAuditCategory','centralAuditFrom','centralAuditTo','centralAuditBody','centralAuditPager'])elements.set(id,{value:'',innerHTML:'',isConnected:true});
 let exported;const c={URLSearchParams,document:{getElementById:id=>elements.get(id)},UniServeUX:{request},escapeHtml:x=>String(x??''),auditCatPill:x=>x,auditActionLabel:x=>x,auditDetailsHtml:()=>'',SpreadsheetExport:{download:(name,rows)=>{exported=rows}},loadDB:()=>({}),saveDB:()=>{},currentUser:{id:'super'},logActivity:()=>{},toast:()=>{},printInjected:()=>{}};
 vm.createContext(c);vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../../Super Admin/audit-trail.js'),'utf8'),c);return {c,elements,getExport:()=>exported};
}
function row(id){return {id,actor_name:'System',category:'System',action:'Event '+id,created_at:'2026-10-13 08:00:00',changes:[]};}
test('audit filters and pagination use the server, including pages beyond 500 records',async()=>{
 let called;const {c,elements}=setup(async url=>{called=url;return {data:[row(501)],current_page:17,last_page:17,total:501}});
 elements.get('centralAuditActor').value='System';vm.runInContext('centralAuditPage=17',c);await c.loadCentralAudit();
 assert.ok(called.includes('actor=System'));assert.ok(called.includes('page=17'));assert.ok(elements.get('centralAuditPager').innerHTML.includes('501 records'));assert.ok(elements.get('centralAuditBody').innerHTML.includes('Event 501'));
});
test('filtered Excel export includes every server page rather than truncating at 500',async()=>{
 const {c,getExport}=setup(async url=>{const page=Number(new URLSearchParams(url.split('?')[1]).get('page'));const count=page<17?30:21;return {data:Array.from({length:count},(_,i)=>row((page-1)*30+i)),next_page_url:page<17?'next':null}});
 await c.exportCentralAudit('xlsx');assert.equal(getExport().length,502);
});

test('Excel export separates fields and keeps false and zero values',async()=>{
 const event={...row(1),changes:[{field:'Maintenance',from:false,to:true},{field:'Capacity',from:0,to:1}]};
 const {c}=setup(async()=>({data:[event],next_page_url:null}));let result;
 c.SpreadsheetExport={download:(name,rows,widths)=>result={name,rows,widths}};
 await c.exportCentralAudit('xlsx');
 assert.equal(result.name,'Audit_Trail.xlsx');assert.equal(result.rows.length,3);
 assert.deepEqual(Array.from(result.rows[1].slice(-3)),['Maintenance','false','true']);
 assert.deepEqual(Array.from(result.rows[2].slice(-3)),['Capacity','0','1']);
});
test('an older audit response cannot replace the current filter results',async()=>{
 const pending=[];const {c,elements}=setup(()=>new Promise(resolve=>pending.push(resolve)));
 const first=c.loadCentralAudit(),second=c.loadCentralAudit();pending[1]({data:[row('new')],current_page:1,last_page:1,total:1});await second;
 pending[0]({data:[row('old')],current_page:1,last_page:1,total:1});await first;assert.ok(elements.get('centralAuditBody').innerHTML.includes('Event new'));assert.ok(!elements.get('centralAuditBody').innerHTML.includes('Event old'));
});
