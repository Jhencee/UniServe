const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../Admin/admin.js'),'utf8');
test('sidebar badges update when refreshed records arrive',()=>{
 const badges=['messages','transactions','appointments'].map(key=>({dataset:{sidebarCount:key},textContent:'0',hidden:true}));
 const db={chats:[{staffUnread:2}],transactions:[{status:'Pending'},{caseStatus:'Resolved'}],appointments:[{status:'Requested'}]};
 const c={loadDB:()=>db,totalStaffUnread:()=>db.chats.reduce((n,row)=>n+row.staffUnread,0),document:{querySelectorAll:()=>badges}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function refreshSidebarCounts()'),source.indexOf('const staffViewMemory=')),c);
 c.refreshSidebarCounts();assert.deepEqual(badges.map(b=>b.textContent),['2','1','1']);assert.ok(badges.every(b=>!b.hidden));
 db.chats=[];db.transactions=[];db.appointments=[];c.refreshSidebarCounts();assert.ok(badges.every(b=>b.hidden));
});
