const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../Admin/admin.js'),'utf8');
test('reset clears saved appointment status, search through rerender, and date range',()=>{
 let rendered;const c={staffViewMemory:{appointments:{apptFilter:'Booked'}},apptFilter:'Booked',RANGES:{appt:{from:'2026-11-01',to:'2026-11-06'}},renderAppointments:keep=>rendered=keep};vm.createContext(c);
 vm.runInContext(source.slice(source.indexOf('function resetStaffTableFilters('),source.indexOf('function setApptFilter(')),c);
 c.resetStaffTableFilters('appt');assert.equal(c.apptFilter,'all');assert.equal(c.staffViewMemory.appointments.apptFilter,'all');assert.equal(c.RANGES.appt.from,'');assert.equal(rendered,false);
});
