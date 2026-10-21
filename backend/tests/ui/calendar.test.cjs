const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
function calendar() {
  const context = {Intl,Date,localStorage:{getItem:()=>null}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../../../shared/office-calendar.js'),'utf8'),context);
  return context.OfficeCalendar;
}
test('Manila hours exclude weekends, holidays and lunch at exact boundaries', () => {
  const c = calendar();
  for (const [date,open] of [['2026-10-12T07:59:00+08:00',false],['2026-10-12T08:00:00+08:00',true],['2026-10-12T11:59:00+08:00',true],['2026-10-12T12:00:00+08:00',false],['2026-10-12T13:00:00+08:00',true],['2026-10-12T17:00:00+08:00',false],['2026-10-10T10:00:00+08:00',false],['2026-06-12T10:00:00+08:00',false]]) assert.equal(c.status(new Date(date)).open,open,date);
  assert.equal(c.status(new Date('2026-10-12T12:15:00+08:00')).message,'Closed for lunch, back at 1:00 PM');
  assert.equal(c.status(new Date('2026-06-12T10:00:00+08:00')).next.date,'2026-06-15');
});
test('special hours and explicit open override defaults and skip lunch when half day ends', () => {
  const c = calendar(), cfg = c.defaults();
  cfg.days['2026-10-12'] = {type:'special',start:'08:00',end:'12:00'};
  assert.equal(c.at('2026-10-12','12:00',cfg).open,false);
  assert.equal(c.status(new Date('2026-10-12T12:00:00+08:00'),cfg).next.date,'2026-10-13');
  cfg.days['2026-10-10'] = {type:'open'};
  assert.equal(c.at('2026-10-10','09:00',cfg).open,true);
  cfg.lunch = {enabled:true,start:'11:30',end:'12:30'};
  assert.equal(c.at('2026-10-10','11:30',cfg).open,false);
  assert.equal(c.at('2026-10-10','12:30',cfg).open,true);
});
test('next opening handles consecutive holidays and fully closed weeks', () => {
  const c = calendar(), cfg = c.defaults();
  assert.equal(c.status(new Date('2026-12-24T10:00:00+08:00'),cfg).next.date,'2026-12-28');
  cfg.weekly.forEach(d=>d.open=false); cfg.days={};
  assert.equal(c.status(new Date('2026-10-12T10:00:00+08:00'),cfg).next,null);
});

function adminCalendar(bookings) {
  const c = calendar(), elements = new Map(), notices = [];
  let modal, saved = null;
  const context = {OfficeCalendar:c,Date,document:{getElementById(id) {if (!elements.has(id)) elements.set(id,{innerHTML:'',textContent:''});return elements.get(id);}},
    escapeHtml:String,icon:()=>'',loadDB:()=>({appointments:bookings}),saveDB:()=>{},logActivity:()=>{},currentUser:{id:'admin'},
    toast:message=>notices.push(message),openModal:(title,body,buttons)=>{modal={title,body,buttons};},closeModal:()=>{},navigate:()=>{},openApptDetail:()=>{}};
  c.parts = () => ({date:'2026-10-12',time:'10:00'});
  c.save = async (cfg,effects) => {saved={cfg,effects};return {calendar:cfg};};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../../../Admin/calendar.js'),'utf8'),context);
  return {context,elements,modal:()=>modal,saved:()=>saved,notices,c};
}
test('closing a day counts active bookings and saving keeps their statuses', async () => {
  const bookings = [{id:'a',date:'2026-10-13',time:'9:00 AM',name:'Visitor',status:'Booked'}, {id:'b',date:'2026-10-13',time:'9:00 AM',name:'Cancelled',status:'Cancelled'}, {id:'c',date:'2026-10-14',time:'9:00 AM',name:'Later',status:'Booked'}];
  const app=adminCalendar(bookings),cfg=app.c.defaults(); cfg.days['2026-10-13']={type:'closed',name:'Maintenance'};
  app.context.calendarConfirmSave(cfg,'2026-10-13');
  assert.ok(app.modal().body.includes('1 booking(s)'));
  assert.equal(app.saved(),null);
  await app.modal().buttons[1].action();
  assert.equal(app.saved().effects.affected,1); assert.equal(app.saved().effects.decision,'keep');
  assert.equal(bookings[0].status,'Booked'); assert.equal(bookings[1].status,'Cancelled');
});
test('weekly lunch edits warn about affected appointments and grid exposes all day types', () => {
  const app=adminCalendar([{id:'a',date:'2026-10-13',time:'11:30 AM',name:'Visitor',status:'Booked'}]);
  const cfg=app.c.defaults();cfg.lunch.start='11:00';
  assert.equal(app.context.calendarAffected(cfg,'Daily hours').length,1);
  app.context.renderCalendar();
  const html=app.elements.get('content').innerHTML;
  for(const label of ['Daily hours','Lunch break','Coming up','cal-open','cal-closed','pill-info','pill-warn']) assert.ok(html.includes(label),label);
});
test('calendar review includes recovered bookings and excludes elapsed times',()=>{
 const app=adminCalendar([{id:'old',date:'2026-10-12',time:'09:00',status:'Booked'},{id:'recovered',date:'2026-10-13',time:'10:00',status:'Booked',queueId:'retained-queue'}]);
 const cfg=app.c.defaults();cfg.days['2026-10-12']={type:'closed',name:'Meeting'};cfg.days['2026-10-13']={type:'closed',name:'Meeting'};
 assert.deepEqual(Array.from(app.context.calendarAffected(cfg,'Daily hours'),a=>a.id),['recovered']);
});
test('appointment selection shows a warning for lunch and clears it for an open time', () => {
  const app=adminCalendar([]);
  app.context.document.getElementById('mApptDate').value='2026-10-13';
  app.context.document.getElementById('mApptTime').value='12:00';
  app.context.calendarAppointmentWarning();
  assert.ok(app.elements.get('calendarApptWarning').textContent.includes('Closed for lunch'));
  app.elements.get('mApptTime').value='13:00';app.context.calendarAppointmentWarning();
  assert.equal(app.elements.get('calendarApptWarning').textContent,'');
});
