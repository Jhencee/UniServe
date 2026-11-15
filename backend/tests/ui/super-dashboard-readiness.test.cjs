const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
function setup(unavailable=false){
 let section,trend,checks;
 const data={checkedAt:'2026-11-15T08:00:00Z',accounts:[],backups:{latest:null},health:{api:{state:'responding'},database:{state:'responding'},scheduler:{state:'unverified'},worker:{state:'unverified'},mail:{state:'configured',failed:0},realtime:{state:'disabled'},queue:{pending:2,failed:1}}};
 const c={window:{},escapeHtml:String,reportDateKey:value=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date(value)),
   document:{querySelector:()=>({querySelector:selector=>selector==='#systemOversightAttention'?null:{prepend:element=>section=element,after:element=>section=element}}),createElement:()=>({isConnected:true,setAttribute(){},innerHTML:''})},
   UniServeUX:{request:async route=>{if(route==='/system/oversight')return data;if(unavailable)throw Error('Offline');return {backups:[{savedAt:'2026-11-14T16:01:00Z'},{savedAt:'2026-11-16T08:00:00Z'},{savedAt:'2026-10-01T08:00:00Z'}]};}},
   dashboardChart:(rows,type,label)=>{if(label==='Saved backups per day')trend={values:rows.map(r=>r.count)};else checks=rows;return '<div>Chart</div>';},emptyChart:text=>text};
 vm.createContext(c);vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../../Super Admin/system-oversight.js'),'utf8'),c);c.state_view='dashboard';
 return {c,result:()=>({html:section.innerHTML,trend,checks})};
}
test('dashboard lists service evidence and recent backups without a health score',async()=>{
 const s=setup();await s.c.mountSystemOversight();const {html,trend}=s.result();
 assert.equal(trend,undefined);
 for(const label of ['API connection','Database','Activity confirmed','Needs checking','Turned off','Latest saved files'])assert.ok(html.includes(label));
 assert.ok(html.includes('Nov 15, 2026'));assert.ok(html.includes('Oct 1, 2026'));assert.ok(!html.includes('Nov 16, 2026'));
 assert.ok(!html.includes('dashboard-rings'));
});
test('unavailable backup history is not rendered as a successful zero-backup graph',async()=>{
 const s=setup(true);await s.c.mountSystemOversight();const result=s.result();
 assert.equal(result.trend,undefined);assert.ok(result.html.includes('Backup history could not be loaded.'));
});
