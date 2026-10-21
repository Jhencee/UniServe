const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(root, 'shared/browser-notifications.js'), 'utf8');
function setup({ permission = 'default', answer = 'granted', secure = true, saved = null, serviceWorker = false } = {}) {
  const events = {}, elements = [], alerts = [], stored = {};
  let calls = 0, now = 100000;
  function Notification(title, options) { alerts.push({ title, ...options }); this.close = () => {}; }
  Notification.permission = permission;
  Notification.requestPermission = async () => { calls++; Notification.permission = answer; return answer; };
  const reg = { active: {}, showNotification: async (title, options) => alerts.push({ title, ...options }) };
  const c = { isSecureContext: secure, Notification, URL, location: { href: 'https://example.test/User/user.html' }, navigator: serviceWorker ? { serviceWorker: { register: async url => { assert.equal(url.href, 'https://example.test/shared/notification-worker.js'); return reg; } } } : {}, localStorage: { getItem: () => saved, setItem: (k, v) => stored[k] = v }, Date: { now: () => now }, setTimeout: () => 0, clearTimeout() {}, focus() {}, document: { currentScript: { src: 'https://example.test/shared/browser-notifications.js' }, visibilityState: 'hidden', createElement: () => ({ style: {}, setAttribute() {}, addEventListener(name, fn) { this[name] = fn; } }), querySelector: () => ({ append(...items) { elements.push(...items); } }) }, addEventListener: (name, fn) => events[name] = fn };
  c.window = c;
  vm.runInNewContext(source, c);
  return { events, c, alerts, stored, button: elements[0], status: elements[1], calls: () => calls, tick: () => now += 6000, update: async resource => { events['uniserve:browser-update']({ detail: { resource } }); await new Promise(resolve => setImmediate(resolve)); } };
}
test('permission is requested only on click; disable persists', async () => {
  const s = setup(); assert.equal(s.calls(), 0); await s.update('chats'); assert.equal(s.alerts.length, 0);
  await s.button.click(); assert.equal(s.calls(), 1); assert.equal(s.alerts.length, 1);
  await s.update('chats'); assert.equal(s.alerts.length, 2);
  await s.button.click(); s.tick(); await s.update('queue'); assert.equal(s.alerts.length, 2); assert.equal(s.stored['uniserve:browser-alerts'], 'off');
});
test('denied and dismissed permissions never deliver alerts', async () => {
  for (const answer of ['denied', 'default']) { const s = setup({ answer }); await s.button.click(); await s.update('chats'); assert.equal(s.alerts.length, 0); assert.equal(s.stored['uniserve:browser-alerts'], 'off'); }
});
test('insecure contexts disable the control', () => { const s = setup({ secure: false }); assert.equal(s.button.disabled, true); assert.match(s.status.textContent, /HTTPS/); });
test('visible pages, irrelevant resources and repeated updates are suppressed', async () => {
  const s = setup({ permission: 'granted', saved: 'on' }); s.c.document.visibilityState = 'visible'; await s.update('chats'); assert.equal(s.alerts.length, 0);
  s.c.document.visibilityState = 'hidden'; await s.update('settings'); assert.equal(s.alerts.length, 0);
  await s.update('queue'); await s.update('chats'); assert.equal(s.alerts.length, 1);
  s.tick(); await s.update('chats'); assert.equal(s.alerts.length, 2); assert.ok(!s.alerts[0].body.includes('email'));
});
test('service worker delivers persistent notifications', async () => { const s = setup({ serviceWorker: true }); await s.button.click(); await s.update('appointments'); assert.equal(s.alerts.length, 2); assert.equal(s.alerts[1].data.url, s.c.location.href); });
test('all three portals load notification code before realtime code', () => {
  for (const file of ['User/user.html', 'Admin/admin.html', 'Super Admin/superadmin.html']) { const html = fs.readFileSync(path.join(root, file), 'utf8'); const index = html.indexOf('shared/browser-notifications.js'); assert.ok(index > 0); assert.ok(index < html.indexOf('shared/realtime-updates.js')); }
});
test('worker focuses the existing portal and rejects cross-origin destinations', async () => {
  let handler, focused = 0, opened = 0;
  const c = { URL, self: { location: { origin: 'https://example.test' }, addEventListener: (name, fn) => handler = fn, clients: { matchAll: async () => [{ url: 'https://example.test/User/user.html', focus: () => focused++ }], openWindow: () => opened++ } } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'shared/notification-worker.js'), 'utf8'), c);
  async function click(url) { let pending; handler({ notification: { data: { url }, close() {} }, waitUntil: p => pending = p }); await pending; }
  await click('https://example.test/User/user.html'); assert.equal(focused, 1); assert.equal(opened, 0);
  await click('https://other.test/'); assert.equal(opened, 0);
  await click('https://example.test/Admin/admin.html'); assert.equal(opened, 1);
});

test('Head Admin cutoff alerts show time without reason, deduplicate and respect permission',async()=>{
 const s=setup({permission:'granted',saved:'on'});
 const data={id:'cutoff-1',mode:'closed',time:'2:30 PM',reason:'Staff meeting'};
 s.events['uniserve:intake-notification']({detail:data});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(s.alerts.length,1);assert.match(s.alerts[0].body,/Head Admin closed/);assert.match(s.alerts[0].body,/2:30 PM/);assert.ok(!s.alerts[0].body.includes('Staff meeting'));assert.ok(!s.alerts[0].body.includes('Reason:'));
 s.events['uniserve:intake-notification']({detail:data});await new Promise(resolve=>setImmediate(resolve));assert.equal(s.alerts.length,1);
 const disabled=setup();disabled.events['uniserve:intake-notification']({detail:data});await new Promise(resolve=>setImmediate(resolve));assert.equal(disabled.alerts.length,0);
});
test('visible staff portals show cutoff time without reason or browser permission',()=>{
 const s=setup();const messages=[];s.c.document.visibilityState='visible';s.c.toast=message=>messages.push(message);
 s.events['uniserve:intake-notification']({detail:{id:'scheduled-1',mode:'scheduled',time:'3:00 PM',reason:'<img src=x>'}});
 assert.equal(messages.length,1);assert.match(messages[0],/scheduled walk-in cutoff/);assert.match(messages[0],/3:00 PM/);assert.ok(!messages[0].includes('<img'));assert.ok(!messages[0].includes('Reason:'));assert.equal(s.alerts.length,0);
});
