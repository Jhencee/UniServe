const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../User/user.js'),'utf8');
function setup(request){
 const fields={bkOffice:{value:'Office of Student Services'},bkDate:{value:'2026-10-23'},bkTime:{isConnected:true},bkSlotStatus:{textContent:''}};
 const context={document:{getElementById:id=>fields[id]},SharedAppointments:{request},URLSearchParams,escapeHtml:String,UniServeUX:{timeLabel:String}};
 vm.createContext(context);vm.runInContext(source.slice(source.indexOf('let bookingSlotVersion='),source.indexOf('function uxDropFiles')),context);
 return {context,fields};
}
test('booking displays only slots returned by the server',async()=>{
 const {context,fields}=setup(async()=>({slots:['09:00','09:30']}));await context.refreshBookingSlots();
 assert.equal(fields.bkTime.disabled,false);assert.ok(fields.bkTime.innerHTML.includes('value="09:30"'));assert.ok(!fields.bkTime.innerHTML.includes('value="10:00"'));
});
test('full days and network failures prevent selection',async()=>{
 const {context,fields}=setup(async()=>({slots:[]}));await context.refreshBookingSlots();assert.equal(fields.bkTime.disabled,true);assert.match(fields.bkSlotStatus.textContent,/No slots available/);
 context.SharedAppointments.request=async()=>{throw Error('Offline');};await context.refreshBookingSlots();assert.equal(fields.bkTime.disabled,true);assert.equal(fields.bkSlotStatus.textContent,'Offline');
});
test('changing the date ignores an older availability response',async()=>{
 let first;let count=0;const {context,fields}=setup(()=>++count===1?new Promise(resolve=>first=resolve):Promise.resolve({slots:['11:00']}));
 const old=context.refreshBookingSlots();fields.bkDate.value='2026-10-26';await context.refreshBookingSlots();first({slots:['09:00']});await old;
 assert.ok(fields.bkTime.innerHTML.includes('11:00'));assert.ok(!fields.bkTime.innerHTML.includes('09:00'));
});
