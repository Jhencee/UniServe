const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../Landing/landing.js'),'utf8');
test('contact hours show today and its lunch break using the office calendar',()=>{
 let ready=true,open=true;
 const c={escapeHtml:String,OfficeCalendar:{ready:()=>ready,parts:()=>({date:'2026-11-23'}),day:()=>({open,start:'08:00',end:'17:00'}),intervals:()=>open?[['08:00','12:00'],['13:00','17:00']]:[],clock:value=>({'08:00':'8:00 AM','12:00':'12:00 PM','13:00':'1:00 PM','17:00':'5:00 PM'})[value]}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function contactHoursHtml()')),c);
 assert.match(c.contactHoursHtml(),/Today: 8 AM – 5 PM/);assert.match(c.contactHoursHtml(),/Lunch: 12 PM – 1 PM/);
 open=false;assert.match(c.contactHoursHtml(),/Today: Closed/);assert.doesNotMatch(c.contactHoursHtml(),/Lunch/);
 ready=false;assert.match(c.contactHoursHtml(),/temporarily unavailable/);
});
