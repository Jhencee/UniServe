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

test('satisfaction pictogram labels the actual respondents and uses partial figures',()=>{
 const html=c.adminSatisfactionPictogram({satisfied:2,feedback:3,rating:4});
 assert.match(html,/67%/);assert.match(html,/2 of 3 respondents/);assert.equal((html.match(/class="satisfaction-person"/g)||[]).length,10);assert.match(html,/clip-path:inset/);assert.ok(html.includes('4 / 5'));
 c.emptyChart=text=>text;assert.match(c.adminSatisfactionPictogram({feedback:0}),/No feedback/);
 const zero=c.adminSatisfactionPictogram({satisfied:0,feedback:2,rating:1});assert.match(zero,/0%/);
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
