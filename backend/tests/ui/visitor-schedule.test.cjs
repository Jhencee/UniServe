const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '../../../Admin/admin.js'), 'utf8');
function setup() {
  const host = {innerHTML: ''};
  const records = [
    {name:'Later', date:'2026-11-08', time:'14:00', status:'Booked'},
    {name:'Earlier', date:'2026-11-08', time:'09:00', status:'Requested'},
    {name:'Private', date:'2026-11-08', time:'08:00', status:'Booked', restricted:true},
    {name:'Cancelled visitor', date:'2026-11-08', status:'Cancelled'},
    {name:'Next day', date:'2026-11-09', status:'Booked'}
  ];
  const context = {document:{getElementById:()=>host}, loadDB:()=>({appointments:records}), OfficeCalendar:{parts:()=>({date:'2026-11-08'})}, UniServeUX:{appointmentTime:v=>v}, arrivalVisitorHtml:a=>`<article>${a.name}</article>`};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('let appointmentView ='), source.indexOf('let arrivalLookupQuery =')), context);
  return {context, host};
}
test('visitor calendar counts visible appointments and orders selected-day visitors by time', () => {
  const {context,host} = setup(); context.renderVisitorCalendar();
  assert.match(host.innerHTML, /2026-11-08, 2 visits, 1 requests/);
  assert.ok(host.innerHTML.indexOf('<article>Earlier') < host.innerHTML.indexOf('<article>Later'));
  for (const name of ['Private', 'Cancelled visitor', '<article>Next day']) assert.ok(!host.innerHTML.includes(name));
});
test('month navigation crosses years and displays an empty selected-day agenda', () => {
  const {context,host} = setup(); context.renderVisitorCalendar(); context.moveVisitorMonth(2);
  assert.match(host.innerHTML, /January 2027/);
  assert.match(host.innerHTML, /No visitors scheduled for this date/);
  context.moveVisitorMonth(-2); assert.match(host.innerHTML, /November 2026/);
});
