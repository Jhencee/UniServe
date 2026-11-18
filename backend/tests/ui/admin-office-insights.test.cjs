const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
const c={Date,Intl,OfficeCalendar:{parts:d=>({date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(d)})}};vm.createContext(c);vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../../Admin/dashboard-insights.js'),'utf8'),c);
const dates=['2026-11-18'];
test('analytics use check-in and completion timestamps, exclude private data and validate timing samples',()=>{
 const result=c.adminOfficeInsights({services:[{key:'id',label:'Student ID'}],appointments:[{date:'2026-11-18',status:'Booked'},{date:'2026-11-18',status:'No-show'},{date:'2026-11-18',status:'Completed',restricted:true}],queues:[
 {checkedInAt:'2026-11-18T01:00:00Z',servingAt:'2026-11-18T01:10:00Z',completedAt:'2026-11-18T01:20:00Z',status:'Completed',serviceKey:'id',feedback:{rating:5}},
 {createdAt:'2026-11-18T01:00:00Z',status:'Waiting'},
 {checkedInAt:'2026-11-17T01:00:00Z',completedAt:'2026-11-18T01:00:00Z',status:'Completed'},
 {checkedInAt:'2026-11-18T01:00:00Z',completedAt:'2026-11-18T02:00:00Z',status:'Completed',restricted:true},
 {checkedInAt:'2026-11-18T01:00:00Z',servingAt:'2026-11-18T02:00:00Z',completedAt:'2026-11-18T03:00:00Z',status:'Completed',serviceKey:'id',serviceHistory:[{outcome:'Transferred'}]},
 ]},dates);
 assert.equal(result.arrivals,2);assert.equal(result.completed,3);assert.equal(result.wait,10);assert.equal(result.service,10);assert.equal(result.waitSamples,1);assert.equal(result.serviceSamples,1);assert.equal(result.hours[0].label,'09:00');assert.equal(result.appointments,2);assert.equal(result.attendance.find(a=>a.label==='Awaiting arrival').count,1);assert.equal(result.feedback,1);assert.equal(result.rating,5);
});
test('empty data and invalid or reversed timings produce no invented averages',()=>{
 const empty=c.adminOfficeInsights({queues:[]},dates);assert.equal(empty.wait,null);assert.equal(empty.rating,null);assert.equal(empty.arrivals,0);
 const data=c.adminOfficeInsights({queues:[{status:'Completed',completedAt:'2026-11-18T01:00:00Z',checkedInAt:'invalid',servingAt:'2026-11-18T02:00:00Z',feedback:{rating:0}}]},dates);assert.equal(data.waitSamples,0);assert.equal(data.serviceSamples,0);assert.equal(data.feedback,0);
});
