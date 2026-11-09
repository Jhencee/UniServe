const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../../../Admin/admin.js'),'utf8');
function setup(){
 const local=new Map(),session=new Map();
 const storage=map=>({getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)});
 const c={currentUser:{id:'staff'},state_view:'dashboard',localStorage:storage(local),sessionStorage:storage(session)};
 vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('function notificationPreferences()'),source.indexOf('function changeNotificationState(')),c);
 return c;
}
const item={id:'case:1',kind:'case',title:'Case assigned'};
const notification={...item,kind:'important',category:'followups'};
test('previously opened updates inherit read status from the existing seen record',()=>{
 const c=setup();c.sessionStorage.setItem('important-seen:staff',JSON.stringify([item.id]));
 assert.equal(c.notificationPreference(notification,{}).read,true);
 const preferences={[c.notificationPreferenceKey(notification)]:{read:false,archived:true}};
 assert.equal(c.notificationPreference(notification,preferences).read,false);
 assert.equal(c.notificationPreference(notification,preferences).archived,true);
});
test('opening an update persists its read status and preserves archive state',()=>{
 const c=setup(),key=c.notificationPreferenceKey(notification);
 c.localStorage.setItem('uniserve-notifications:staff',JSON.stringify({[key]:{read:false,archived:true}}));
 c.markImportantNotificationRead(item);
 assert.equal(c.notificationPreferences()[key].read,true);
 assert.equal(c.notificationPreferences()[key].archived,true);
 c.sessionStorage.setItem('important-seen:staff','[]');
 assert.equal(c.notificationPreference(notification,c.notificationPreferences()).read,true);
 c.currentUser.id='other';
 assert.equal(c.notificationPreference(notification,c.notificationPreferences()).read,false);
});
