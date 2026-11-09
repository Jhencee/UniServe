const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../shared/appointment-api.js'),'utf8');
test('staff slots show full capacity, remaining capacity, and disabled past times',()=>{
 const c={escapeHtml:String,UniServeUX:{timeLabel:String}};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('let staffSlotVersion=0;')),c);
 const html=c.staffAppointmentSlotsHtml({slots:['09:30'],availability:[{time:'09:00',status:'full',available:false,occupied:2,capacity:2,remaining:0},{time:'09:30',status:'available',available:true,occupied:1,capacity:2,remaining:1},{time:'08:00',status:'past',available:false,occupied:0,capacity:2,remaining:2}]},'09:30');
 assert.match(html,/1 time slot available/);assert.match(html,/Full <small>2\/2/);assert.match(html,/1 available <small>1\/2/);assert.match(html,/Time passed/);
 assert.match(html,/data-time="09:00" aria-pressed="false" disabled/);assert.match(html,/data-time="09:30" aria-pressed="true"/);
});
test('selecting a slot updates the saved time while disabled slots cannot be chosen',()=>{
 const input={value:'',disabled:false},rows=[{dataset:{time:'09:30'},setAttribute:(k,v)=>rows[0][k]=v},{dataset:{time:'09:00'},disabled:true,setAttribute:(k,v)=>rows[1][k]=v}];
 const c={document:{getElementById:()=>input,querySelectorAll:()=>rows}};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('let staffSlotVersion=0;')),c);
 c.selectStaffAppointmentSlot(rows[0]);assert.equal(input.value,'09:30');assert.equal(rows[0]['aria-pressed'],'true');
 c.selectStaffAppointmentSlot(rows[1]);assert.equal(input.value,'09:30');
});
test('the existing reservation is labelled separately from other bookings',()=>{
 const c={escapeHtml:String,UniServeUX:{timeLabel:String}};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('let staffSlotVersion=0;')),c);
 const html=c.staffAppointmentSlotsHtml({slots:['09:30'],currentReservation:{time:'09:30'},availability:[{time:'09:30',status:'available',available:true,occupied:1,capacity:2,remaining:1,pending:1,confirmed:0}]},'09:30');
 assert.match(html,/Your reserved time/);assert.match(html,/1 pending &middot; 0 confirmed/);assert.match(html,/excludes this appointment/);
});
