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

test('timing columns use a zero-based minutes axis and readable duration labels',()=>{
 const html=c.adminTimingColumns({wait:2.3,service:2.7,waitSamples:2,serviceSamples:2});
 assert.match(html,/2 min 18 sec/);assert.match(html,/2 min 42 sec/);assert.match(html,/Minutes/);assert.match(html,/starting at zero/);assert.match(html,/2 valid samples/);
 const missing=c.adminTimingColumns({wait:null,service:0,waitSamples:0,serviceSamples:1});assert.match(missing,/No data/);assert.match(missing,/0 min 00 sec/);
});

test('feedback chart shows rating counts and response totals',()=>{
 c.escapeHtml=String;const ratings=[{label:'5 stars',count:2},{label:'4 stars',count:0},{label:'3 stars',count:1}];
 const html=c.adminSatisfactionChart({satisfied:2,feedback:3,rating:4,ratings});
 assert.match(html,/2 of 3 respondents/);assert.match(html,/5 stars: 2/);assert.match(html,/4 \/ 5/);assert.match(html,/feedback-columns/);
 c.emptyChart=text=>text;assert.match(c.adminSatisfactionChart({feedback:0}),/No feedback/);
});

test('arrival matrix groups Philippine weekdays and hours and ignores booking submission time',()=>{
 const data=c.adminOfficeInsights({queues:[{checkedInAt:'2026-11-17T16:30:00Z'},{checkedInAt:'2026-11-18T01:00:00Z'},{createdAt:'2026-11-18T01:00:00Z'}]},['2026-11-18']);
 const wed=data.arrivalMatrix.find(row=>row.label==='Wed');assert.equal(wed.counts[0],1);assert.equal(wed.counts[9],1);assert.equal(data.arrivals,2);
 const html=c.adminArrivalMatrix(data);assert.match(html,/Wed 00:00: 1 arrivals/);assert.equal((html.match(/<circle /g)||[]).length,168);assert.match(html,/Arrivals per dot/);
});

test('analytics periods use Philippine calendar dates through today',()=>{
 c.renderDashboard=()=>{};
 assert.equal(c.adminAnalyticsDates('2026-11-19').length,1);
 c.setAdminAnalyticsPeriod('weekly');assert.deepEqual(Array.from(c.adminAnalyticsDates('2026-11-19')),['2026-11-16','2026-11-17','2026-11-18','2026-11-19']);
 c.setAdminAnalyticsPeriod('monthly');assert.equal(c.adminAnalyticsDates('2026-11-19')[0],'2026-11-01');
 c.setAdminAnalyticsPeriod('quarterly');assert.equal(c.adminAnalyticsDates('2026-11-19')[0],'2026-10-01');assert.equal(c.adminAnalyticsDates('2026-11-19').at(-1),'2026-11-19');
 assert.match(c.adminAnalyticsTabs(),/aria-pressed="true"/);c.setAdminAnalyticsPeriod('daily');
});

test('service demand includes all catalogue services even with no arrivals',()=>{
 const data=c.adminOfficeInsights({services:Array.from({length:7},(_,i)=>({key:'s'+i,label:'Service '+i})),queues:[]},['2026-11-19']);
 assert.equal(data.services.length,7);assert.ok(data.services.every(s=>s.count===0));
});
test('pickup visits count as arrivals but do not inflate service requests',()=>{
 const data=c.adminOfficeInsights({services:[{key:'moral',label:'Good Moral'}],queues:[
  {serviceKey:'moral',status:'Completed',checkedInAt:'2026-11-18T01:00:00Z'},
  {serviceKey:'moral',pickupTransactionId:'transaction-1',status:'Completed',checkedInAt:'2026-11-18T02:00:00Z'}
 ]},dates);
 assert.equal(data.arrivals,2);
 assert.equal(data.services.find(s=>s.label==='Good Moral').count,1);
 assert.equal(data.services.find(s=>s.label==='Document pickup').count,1);
});

test('visit outcomes count each checked-in visit once and exclude unarrived bookings',()=>{
 const statuses=['Completed','Waiting','Called','Serving','Skipped','Cancelled','Unfinished'];
 const data=c.adminOfficeInsights({queues:statuses.map(status=>({status,checkedInAt:'2026-11-19T01:00:00Z'})).concat([{status:'Waiting',createdAt:'2026-11-19T01:00:00Z'}])},['2026-11-19']);
 assert.equal(data.arrivals,7);assert.equal(data.outcomes.reduce((n,row)=>n+row.count,0),7);assert.equal(data.outcomes.find(row=>row.label==='Still active').count,4);assert.equal(data.outcomes.find(row=>row.label==='Completed').count,1);
});
