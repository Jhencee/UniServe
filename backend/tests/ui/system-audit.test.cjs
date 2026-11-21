const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function setup(request){
 const elements=new Map();for(const id of ['centralAuditQ','centralAuditActor','centralAuditCategory','centralAuditFrom','centralAuditTo','centralAuditBody','centralAuditPager'])elements.set(id,{value:'',innerHTML:'',isConnected:true});
 let exported;const c={URLSearchParams,document:{getElementById:id=>elements.get(id)},UniServeUX:{request},escapeHtml:x=>String(x??''),auditCatPill:x=>x,auditActionLabel:x=>x,auditDetailsHtml:()=>'',SpreadsheetExport:{download:(name,rows)=>{exported=rows}},loadDB:()=>({}),saveDB:()=>{},currentUser:{id:'super'},logActivity:()=>{},toast:()=>{},printInjected:()=>{}};
 vm.createContext(c);vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../../Super Admin/audit-trail.js'),'utf8'),c);return {c,elements,getExport:()=>exported};
}
function row(id){return {id,actor_name:'System',category:'System',action:'Event '+id,created_at:'2026-10-13 08:00:00',changes:[]};}
test('audit filters and pagination use the server, including pages beyond 500 records',async()=>{
 let called;const {c,elements}=setup(async url=>{called=url;return {data:[row(501)],current_page:17,last_page:17,total:501}});
 elements.get('centralAuditQ').value='System';vm.runInContext('centralAuditPage=17',c);await c.loadCentralAudit();
 assert.ok(called.includes('q=System'));assert.ok(called.includes('page=17'));assert.ok(elements.get('centralAuditPager').innerHTML.includes('501 records'));assert.ok(elements.get('centralAuditBody').innerHTML.includes('Event 501'));
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
test('printed audit report includes filters, every page, and complete field changes',async()=>{
 const event={...row(1),changes:[{field:'Maintenance',from:false,to:true},{field:'Capacity',from:0,to:1}]};
 const {c,elements}=setup(async url=>{const page=new URLSearchParams(url.split('?')[1]).get('page');return page==='1'?{data:[event],next_page_url:'next'}:{data:[row(2)],next_page_url:null};});
 elements.get('centralAuditQ').value='System';elements.get('centralAuditFrom').value='2026-10-01';
 let html='';c.printInjected=value=>html=value;c.reportLetterhead=()=>'<header>Letterhead</header>';c.reportSignatureBlock=()=>'<footer>Signatures</footer>';c.fmtDateTime=()=> '2026-10-13';c.currentUser.fullName='Staff';
 await c.exportCentralAudit('print');
 for(const text of ['Letterhead','Audit Trail Report','Records: 2','System','2026-10-01','Event 1','Event 2','Maintenance','false','true','Capacity','0','1','Signatures'])assert.ok(html.includes(text),text);
 assert.match(html,/compact-report-table/);
});
test('an older audit response cannot replace the current filter results',async()=>{
 const pending=[];const {c,elements}=setup(()=>new Promise(resolve=>pending.push(resolve)));
 const first=c.loadCentralAudit(),second=c.loadCentralAudit();pending[1]({data:[row('new')],current_page:1,last_page:1,total:1});await second;
 pending[0]({data:[row('old')],current_page:1,last_page:1,total:1});await first;assert.ok(elements.get('centralAuditBody').innerHTML.includes('Event new'));assert.ok(!elements.get('centralAuditBody').innerHTML.includes('Event old'));
});

test('notification review highlights matching rows without filtering the normal table',async()=>{
 let called;
 const {c,elements}=setup(async url=>{called=url;return {reviewScope:{kind:'failed'},data:[row(1)],current_page:1,last_page:1,total:1};});
 c.centralAuditReview={kind:'failed',title:'2 failed events',from:'2026-11-14T08:00:00Z',to:'2026-11-15T08:00:00Z'};
 await c.loadCentralAudit();
 const params=new URLSearchParams(called.split('?')[1]);assert.equal(params.get('review'),'failed');assert.equal(params.get('review_from'),c.centralAuditReview.from);assert.equal(params.get('review_to'),c.centralAuditReview.to);
 assert.ok(elements.get('centralAuditBody').innerHTML.includes('audit-notification-match'));
 c.clearCentralAuditReview();await new Promise(resolve=>setImmediate(resolve));
 assert.equal(c.centralAuditReview,null);assert.ok(!called.includes('review='));assert.ok(!elements.get('centralAuditBody').innerHTML.includes('audit-notification-match'));
});
test('older APIs cannot highlight unrelated audit rows as a notification match',async()=>{
 const {c,elements}=setup(async()=>({data:[row(1)],current_page:1,last_page:1,total:1}));
 c.centralAuditReview={kind:'failed',from:'2026-11-14T08:00:00Z',to:'2026-11-15T08:00:00Z'};
 await c.loadCentralAudit();assert.ok(elements.get('centralAuditBody').innerHTML.includes('Event 1'));assert.ok(!elements.get('centralAuditBody').innerHTML.includes('audit-notification-match'));
});

test('unrelated records stay visible while only server-confirmed matching IDs are highlighted',async()=>{
 const calls=[];
 const {c,elements}=setup(async url=>{calls.push(url);return url.includes('review=')?{reviewScope:{kind:'failed'},data:[row(1)]}:{data:[row(1),row(2)],current_page:1,last_page:1,total:2};});
 c.centralAuditReview={kind:'failed',from:'2026-11-14T08:00:00Z',to:'2026-11-15T08:00:00Z'};
 await c.loadCentralAudit();
 assert.ok(!calls[0].includes('review='));assert.ok(calls[1].includes('review_ids'));
 const html=elements.get('centralAuditBody').innerHTML;
 assert.ok(html.includes('Event 1'));assert.ok(html.includes('Event 2'));assert.equal((html.match(/audit-notification-match/g)||[]).length,1);
 assert.ok(elements.get('centralAuditPager').innerHTML.includes('2 records'));
});

test('notification review opens the matching page and scrolls to its first highlighted row only once',async()=>{
 const calls=[],scrolls=[];let focused=false;
 const {c,elements}=setup(async url=>{
  calls.push(url);const params=new URLSearchParams(url.split('?')[1]);
  if(params.has('review_locate'))return {reviewScope:{kind:'failed',page:3},data:[]};
  if(params.has('review'))return {reviewScope:{kind:'failed'},data:[row(61)]};
  return {data:[row(61),row(62)],current_page:3,last_page:3,total:62};
 });
 elements.get('centralAuditBody').querySelector=()=>({focus:()=>focused=true,scrollIntoView:options=>scrolls.push(options)});
 c.centralAuditReview={kind:'failed',from:'2026-11-14T08:00:00Z',to:'2026-11-15T08:00:00Z',locate:true,scroll:true};
 await c.loadCentralAudit();assert.ok(calls[0].includes('review_locate=1'));assert.ok(calls[1].includes('page=3'));assert.ok(focused);assert.equal(scrolls.length,1);assert.equal(scrolls[0].block,'center');
 await c.loadCentralAudit();assert.equal(scrolls.length,1);
});
