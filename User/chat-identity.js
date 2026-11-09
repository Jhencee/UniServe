// New conversations collect contact details; existing conversations require email verification.
function initChatFlow() {
  chatFlow={step:'identity',profile:null,message:'',bubbles:[]};renderChatIdentity();
}
function renderChatIdentity() {
  document.getElementById('visitorContent').innerHTML=`<div class="card card-pad visitor-page-wrap chat-contact-card"><div class="chat-contact-head"><h3>Your contact details</h3><p>Enter your details to start a conversation with OSS.</p></div><div class="form-row"><div class="field" id="fwChatFirst"><label for="chatFirst">First name *</label><input id="chatFirst" placeholder="Juan" autocomplete="given-name" maxlength="80" oninput="autoCapitalizeInput(this)"><div class="field-error"></div></div><div class="field" id="fwChatLast"><label for="chatLast">Last name *</label><input id="chatLast" placeholder="Dela Cruz" autocomplete="family-name" maxlength="80" oninput="autoCapitalizeInput(this)"><div class="field-error"></div></div></div><div class="form-row"><div class="field" id="fwChatContact"><label for="chatContact">Contact number *</label><div class="ph-phone-input"><span class="ph-phone-prefix" title="Philippines (+63)"><span class="ph-phone-flag" aria-hidden="true"><svg viewBox="0 0 30 20" width="24" height="16"><path fill="#0038a8" d="M0 0h30v10H0z"/><path fill="#ce1126" d="M0 10h30v10H0z"/><path fill="#fff" d="M0 0l17 10L0 20z"/><g fill="#fcd116"><circle cx="5.5" cy="10" r="2.2"/><path d="M5 6h1v8H5zM1.5 9.5h8v1h-8zM2.3 7.3l.7-.7 5.7 5.7-.7.7zM2.3 12.7L8 7l.7.7L3 13.4z"/><circle cx="2.4" cy="3.2" r=".8"/><circle cx="2.4" cy="16.8" r=".8"/><circle cx="13" cy="10" r=".8"/></g></svg></span><span class="sr-only">Philippines country code +63</span></span><input id="chatContact" type="tel" inputmode="tel" autocomplete="tel" maxlength="17" placeholder="+63 917 123 4567" aria-label="Philippine mobile number, country code +63" onfocus="if (!this.value) this.value='+63'" oninput="formatContactInput(this)"></div><div class="field-error"></div></div><div class="field" id="fwChatEmail"><label for="chatEmail">Email *</label><input id="chatEmail" type="email" autocomplete="email" maxlength="120" placeholder="name@gmail.com"><div class="field-error"></div></div></div><p class="field-hint">Use your own email. Verify your inbox before starting or reopening a conversation.</p><div class="visit-pass-actions chat-contact-actions"><button class="btn btn-primary" onclick="startContactChat()">Continue</button><button class="btn btn-ghost" onclick="resumeChatByEmail()">Resume a conversation</button></div></div>`;
}
function chatProfileValidation(profile) {
  const name=value=>String(value||'').trim().length>=2 && /^[\p{L}\p{M}][\p{L}\p{M}'\u2019\u2018 .-]*$/u.test(value);
  return {first:name(profile.first),last:name(profile.last),contact:isValidContact(profile.contact),email:isValidEmail(profile.email)};
}
function startContactChat() {
  if(!isOfficeHours()){renderClosedScreen();return;}
  const profile={first:document.getElementById('chatFirst').value.trim(),last:document.getElementById('chatLast').value.trim(),contact:'+63'+document.getElementById('chatContact').value.replace(/\D/g,'').replace(/^(?:63|0)/,''),email:normEmail(document.getElementById('chatEmail').value)};
  const valid=chatProfileValidation(profile);let ok=true;
  for(const [key,id,message] of [['first','fwChatFirst','Enter a valid first name.'],['last','fwChatLast','Enter a valid last name.'],['contact','fwChatContact','Enter a valid Philippine mobile number.'],['email','fwChatEmail','Enter a valid email address.']])ok=markField(id,valid[key],message)&&ok;
  if(!ok){focusFirstError();return;}
  const capitalize=value=>value.replace(/(^|[\s-])\p{L}/gu,letter=>letter.toLocaleUpperCase());
  profile.first=capitalize(profile.first);profile.last=capitalize(profile.last);
  chatFlow={step:'message',profile,message:'',bubbles:[{sender:'staff',text:`Hi ${profile.first}! What would you like to ask or report to OSS?`}]};renderChatFlowScreen();
}
let contactChatPending=false;
// Sending and resuming conversations use the authenticated API in portal-api.js.
function resumeChat(){resumeChatByEmail();}
function toggleChatResume(){resumeChatByEmail();}
if(visitorView==='chat' && !currentPublicChatId)initChatFlow();
