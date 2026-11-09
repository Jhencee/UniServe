const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function setup() {
  let database = { users: [
    { id: 'u1', username: 'admin', fullName: 'Super Admin', role: 'SUPER_ADMIN', active: true },
    { id: 'u2', username: 'staff', fullName: 'Staff', role: 'ADMIN', active: true, confidentialAccess: false }
  ] };
  const elements = new Map();
  const calls = [];
  const notices = [];
  let modal;
  let closed = 0;
  const context = {
    state_view: 'users', currentUser: database.users[0],
    ROLES: { ADMIN: { label: 'Admin' }, SUPER_ADMIN: { label: 'Super Admin' } },
    document: { getElementById(id) {
      if (id === 'activeModal') return null;
      if (!elements.has(id)) elements.set(id, { value: '', checked: false, innerHTML: '', textContent: '', hidden: true, checkValidity: () => true });
      return elements.get(id);
    } },
    loadDB: () => database, saveDB: value => { database = value; }, loadSession: () => ({ token: 'test-token' }),
    icon: () => '', escapeHtml: text => String(text).replaceAll('<', '&lt;'),
    btoa: value => Buffer.from(value).toString('base64'),
    logActivity: () => {}, toast: (text, type) => notices.push({ text, type }),
    openModal: (title, body, buttons) => { modal = { title, body, buttons }; },
    closeModal: () => { closed++; },
    fetch: async (url, options) => {
      calls.push({ url, ...options });
      return { ok: true, json: async () => options.method === 'GET' ? { users: database.users.filter(user => user.role === 'ADMIN') } : { user: {} } };
    }
  };
  vm.createContext(context);
  const sharedUI=fs.readFileSync(path.resolve(__dirname,'../../../shared/ui-components.js'),'utf8');
  vm.runInContext(sharedUI.slice(sharedUI.indexOf('function profilePasswordEye('),sharedUI.indexOf('function toggleProfilePassword(')),context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../../Super Admin/admin-management.js'), 'utf8'), context);
  return { context, elements, calls, notices, modal: () => modal, closed: () => closed };
}

test('confidential access confirms the current session password instead of repeating login',async()=>{
  const s=setup();
  s.context.document.getElementById('mCaPass').value='test-password';
  s.context.readSelectedReason=()=> 'Assigned to confidential cases';
  s.context.fetch=async(url,options)=>{
    s.calls.push({url,...options});
    return {ok:true,json:async()=>url.endsWith('/password/confirm')?{confirmed:true}:{user:{}}};
  };
  await s.context.applyConfAccess('u2',true);
  assert.ok(s.calls[0].url.endsWith('/password/confirm'));
  assert.equal(s.calls[0].headers.Authorization,'Bearer test-token');
  assert.equal(JSON.parse(s.calls[0].body).password,'test-password');
  assert.ok(s.calls.some(call=>call.method==='PATCH'&&call.url.endsWith('/admins/u2')));
});

test('table exposes every Admin action while protecting Super Admin', async () => {
  const app = setup();
  await app.context.renderUsers();
  const html = app.elements.get('userBody').innerHTML;
  for (const action of ['Edit Account', 'Confidential Access', 'Reset Password', 'Deactivate', 'Remove']) assert.ok(html.includes(action));
  assert.ok(html.includes('Manage in My Profile'));
  assert.ok(!html.includes("openEditUserModal('u1')"));
});

test('create button sends account fields to MySQL API', async () => {
  const app = setup();
  app.context.openUserForm();
  for (const [id, value] of Object.entries({ mUsFirst: 'New', mUsLast: 'Staff', mUsUser: 'New.staff', mUsEmail: 'staff@example.com', mUsPass: 'TestPassword123!' })) app.context.document.getElementById(id).value = value;
  app.context.document.getElementById('mUsConf').checked = true;
  await app.modal().buttons[1].action();
  assert.equal(app.calls[0].method, 'POST');
  const data = JSON.parse(app.calls[0].body);
  assert.equal(data.username, 'New.staff');
  assert.equal(data.confidentialAccess, true);
  assert.equal(app.closed(), 1);
});

test('remove requires its confirmation button and sends DELETE', async () => {
  const app = setup();
  app.context.deleteUser('u2');
  assert.equal(app.calls.length, 0);
  await app.modal().buttons[1].action();
  assert.equal(app.calls[0].method, 'DELETE');
  assert.ok(app.calls[0].url.endsWith('/u2'));
});

test('failed save keeps the modal open and reports an error', async () => {
  const app = setup();
  app.context.fetch = async () => ({ ok: false, json: async () => ({ errors: { username: ['Username already exists.'] } }) });
  await app.context.saveAdminAction(null, { username: 'duplicate' }, 'Created');
  assert.equal(app.closed(), 0);
  assert.equal(app.notices[0].type, 'err');
  assert.match(app.notices[0].text, /already exists/);
});
test('account deactivation requires confirmation before PATCH', async () => {
  const app=setup();app.context.toggleUser('u2');assert.equal(app.calls.length,0);
  assert.equal(app.modal().title,'Deactivate Admin Account');
  await app.modal().buttons[1].action();assert.equal(app.calls[0].method,'PATCH');
  assert.equal(JSON.parse(app.calls[0].body).active,false);
});
