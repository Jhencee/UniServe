const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const path=require('node:path');
function setup(){
 const c={Date,Intl,oversightAlerts:data=>data.alerts};vm.createContext(c);
 vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../../Super Admin/notifications.js'),'utf8'),c);
 return c;
}
test('system notifications keep stable IDs across refreshes and new IDs for changed review items',()=>{
 const c=setup(),data={checkedAt:'2026-11-13T08:00:00Z',configuration:{maintenance:false},alerts:[{title:'2 failed or denied events',page:'activitylog',action:'Review audit',note:'Last 24 hours.'}]};
 const first=c.superNotificationItems(data);
 data.checkedAt='2026-11-13T08:01:00Z';assert.equal(c.superNotificationItems(data)[0].id,first[0].id);
 data.alerts[0].title='3 failed or denied events';assert.notEqual(c.superNotificationItems(data)[0].id,first[0].id);
 assert.ok(!first[0].id.includes('failed'));assert.equal(first[0].page,'activitylog');
});
test('maintenance notification links to settings and resolved items are removed',()=>{
 const c=setup();const data={checkedAt:'2026-11-13T08:00:00Z',configuration:{maintenance:true},alerts:[]};
 const items=c.superNotificationItems(data);assert.equal(items.length,1);assert.equal(items[0].page,'settings');
 data.configuration.maintenance=false;data.alerts=[];assert.equal(c.superNotificationItems(data).length,0);
});
