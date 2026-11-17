const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../../Landing/landing.js'),'utf8');
function setup(results){
  const field=value=>({value,hidden:true,textContent:'',setAttribute(){},removeAttribute(){},focus(){}});
  const elements={loginUser:field('staff'),loginPass:field('password'),loginRemember:{checked:false},loginErr:field(''),loginUserError:field(''),loginPassError:field(''),staffSignIn:field('')};
  const requests=[],sessions=[],fetchOptions=[];let modal;
  const c={document:{getElementById:id=>elements[id]},loadDB:()=>({users:[]}),LoginTurnstile:{getToken:async()=>'',reset(){}},
    fetch:async(url,options)=>{fetchOptions.push(options);requests.push(JSON.parse(options.body));return results.shift();},
    openModal:(title,html,buttons)=>{modal={title,html,buttons};elements.loginMfaCode=field('');elements.loginMfaErr=field('');if(html.includes('id="loginTrustDevice"'))elements.loginTrustDevice={checked:html.includes('type="checkbox" checked')};else delete elements.loginTrustDevice;},closeModal(){},
    localStorage:{removeItem(){}},logActivity(){},saveDB(){},saveSession:s=>sessions.push(s),location:{},window:{},navigator:{}};
  vm.createContext(c);vm.runInContext(source.slice(source.indexOf('let loginPending = false;'),source.indexOf('// The login form handles Enter')),c);
  return {c,elements,requests,sessions,fetchOptions,get modal(){return modal;}};
}
const challenge=()=>({ok:false,status:422,json:async()=>({mfaRequired:true,message:'Enter the current six-digit code.'})});
test('login MFA opens a verification modal and keeps rejected codes inside it',async()=>{
  const s=setup([challenge(),challenge()]);await s.c.doLogin();
  assert.equal(s.modal.title,'Verify your sign-in');assert.match(s.modal.html,/verification-code-input/);
  assert.equal(s.modal.buttons[1].label,'Verify and sign in');assert.equal(s.sessions.length,0);
  assert.equal(s.elements.loginErr.hidden,true);
  s.elements.loginMfaCode.value='123456';await s.modal.buttons[1].action();
  assert.equal(s.requests[1].mfaCode,'123456');assert.equal(s.elements.loginMfaErr.hidden,false);
  assert.equal(s.elements.loginErr.hidden,true);assert.equal(s.sessions.length,0);
});
test('incomplete codes do not submit and verified MFA completes sign-in',async()=>{
  const s=setup([challenge(),{ok:true,json:async()=>({user:{id:'staff',role:'SUPER_ADMIN'},token:'verified'})}]);
  await s.c.doLogin();s.elements.loginMfaCode.value='123';await s.modal.buttons[1].action();assert.equal(s.requests.length,1);
  s.elements.loginMfaCode.value='123456';await s.modal.buttons[1].action();
  assert.equal(s.sessions[0].token,'verified');assert.equal(s.c.location.href,'../Super Admin/superadmin.html');
});
test('recovery codes use a separate text field and are normalized before submission',async()=>{
  const s=setup([challenge()]);s.c.showLoginMfa(true);
  assert.match(s.modal.html,/Recovery code/);assert.doesNotMatch(s.modal.html,/verification-code-input/);
  s.elements.loginMfaCode.value='ABCDEF0123456789';await s.modal.buttons[1].action();
  assert.equal(s.requests[0].mfaCode,'abcdef0123456789');
});
test('offers an unchecked trust option only when the server marks the Admin eligible',async()=>{
  const s=setup([{ok:false,status:422,json:async()=>({mfaRequired:true,trustedDeviceEligible:true})},challenge()]);
  await s.c.doLogin();assert.match(s.modal.html,/Trust this device for 30 days/);assert.equal(s.elements.loginTrustDevice.checked,false);
  s.elements.loginTrustDevice.checked=true;s.elements.loginMfaCode.value='123456';await s.modal.buttons[1].action();
  assert.equal(s.requests[1].trustDevice,true);assert.equal(s.fetchOptions[1].credentials,'include');
});
test('does not offer trust to Super Admin and never saves a session at the MFA challenge',async()=>{
  const s=setup([{ok:false,status:422,json:async()=>({mfaRequired:true,trustedDeviceEligible:false})}]);await s.c.doLogin();
  assert.doesNotMatch(s.modal.html,/loginTrustDevice/);assert.equal(s.sessions.length,0);assert.equal(s.requests[0].trustDevice,false);
});
test('keeps trust opt-in when switching between authenticator and recovery-code input',async()=>{
  const s=setup([{ok:false,status:422,json:async()=>({mfaRequired:true,trustedDeviceEligible:true})}]);await s.c.doLogin();
  s.elements.loginTrustDevice.checked=true;s.c.showLoginMfa(true);assert.equal(s.elements.loginTrustDevice.checked,true);
  assert.doesNotMatch(s.modal.html,/verification-code-input/);
});
