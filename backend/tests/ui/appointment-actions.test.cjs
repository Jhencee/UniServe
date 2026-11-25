const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '../../../Admin/admin.js'), 'utf8');
const context = { icon: () => '', escapeHtml: String };
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('function appointmentActionsHtml('), source.indexOf('function showAppointmentAccess(')), context);
function labels(status, extras = {}) {
  const html = context.appointmentActionsHtml({id:'test', shared:true, status, date:'2026-11-25', ...extras});
  return [...html.matchAll(/class="kebab-item(?: appointment-cancel-item)?"[^]*?">([^<]+)<\/button>/g)].map(match => match[1].trim());
}
test('cancelled appointments offer only details and email', () => {
  assert.deepEqual(labels('Cancelled', {followUpTasks:[{id:'task'}], attachments:[{}]}), ['View details', 'Email details']);
});
test('requested and booked actions reflect scheduling and uploaded requirements', () => {
  assert.deepEqual(labels('Requested', {attachments:[{}]}), ['View details','Follow-up tasks','Review requirements','Review request','Email details','Cancel']);
  assert.deepEqual(labels('Booked'), ['View details','Follow-up tasks','Reschedule','Email details','Cancel']);
});
test('completed and checked-in appointments omit schedule and cancellation actions', () => {
  assert.deepEqual(labels('Completed', {followUpTasks:[{id:'task'}]}), ['View details','Email details','Print']);
  assert.deepEqual(labels('Checked-in'), ['View details','Follow-up tasks','Email details']);
});
test('restricted appointments expose only the access control', () => {
  const html=context.appointmentActionsHtml({id:'test',shared:true,status:'Booked',restricted:true});
  assert.match(html,/Confidential access required/);
  assert.doesNotMatch(html,/Follow-up tasks|Review requirements|Reschedule/);
});
