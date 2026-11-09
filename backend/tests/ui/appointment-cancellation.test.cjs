const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.resolve(__dirname, '../../../shared/appointment-api.js'), 'utf8');

test('verification validates email and restores Send Code after a request failure', async () => {
  let modal, requests=0;
  const input={value:'',setAttribute(){},removeAttribute(){},focus(){},addEventListener(){}};
  const status={textContent:''};
  const button={disabled:false,textContent:'Send Code',isConnected:true};
  const context={
    window:{},
    VisitorTurnstile:{markup:()=>'',mount(){},getToken:async()=> 'visitor-token',reset(){}},
    openModal:(title,body,buttons)=>{modal={title,body,buttons};},
    closeModal(){},escapeHtml:String,
    document:{getElementById:id=>({appointmentEmail:input,appointmentEmailStatus:status,modalBtn1:button})[id]},
    request:async()=>{requests++;assert.equal(button.disabled,true);throw Error('Please wait one minute before requesting another code.');},
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  function verify('),source.indexOf('  async function visitorRequest(')),context);
  context.verify(()=>{});
  await modal.buttons[1].action();
  assert.equal(requests,0);
  assert.match(status.textContent,/valid email/);
  input.value='visitor@university.edu.ph';
  await modal.buttons[1].action();
  assert.equal(requests,1);
  assert.match(status.textContent,/wait one minute/);
  assert.equal(button.disabled,false);
  assert.equal(button.textContent,'Send Code');
});

test('visitor cancellation waits for fresh email verification before changing the appointment', async () => {
  const requests = [];
  let verification, displayed;
  const appointment = {id:'a1', visitId:'VIS-1', email:'visitor@gmail.com'};
  const context = {
    window:{}, visitorView:'checkvisit',
    UniServeUX:{confirm:async()=>true},
    loadDB:()=>({appointments:[appointment]}),
    verify:(callback, options)=>{verification={callback, options};},
    request:async(url, method)=>{requests.push({url, method});return {appointment:{...appointment, status:'Cancelled'}};},
    cache:value=>value,
    showPassModalReadonly:value=>{displayed=value;},
    toast:message=>assert.fail(message), escapeHtml:String,
  };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  window.cancelSharedAppointment='), source.indexOf("  if(typeof visitorView==='undefined') {")), context);
  await context.window.cancelSharedAppointment('a1');
  assert.equal(requests.length, 0);
  assert.equal(verification.options.purpose, 'cancellation');
  assert.equal(verification.options.email, appointment.email);
  context.UniServeUX.confirm=async()=>false;
  await verification.callback();
  assert.equal(requests.length,0,'declining confirmation must leave the appointment unchanged');
  context.UniServeUX.confirm=async()=>true;
  await verification.callback();
  assert.equal(requests[0].url, '/appointments/a1/cancel');
  assert.equal(requests[0].method, 'POST');
  assert.equal(displayed.status, 'Cancelled');
});
