// New conversations collect contact details; existing conversations require Gmail verification.
function initChatFlow() {
  chatFlow={step:'identity',profile:null,message:'',bubbles:[]};renderChatIdentity();
}
function renderChatIdentity() {
  document.getElementById('visitorContent').innerHTML=`<div class="card card-pad visitor-page-wrap chat-contact-card"><div class="chat-contact-head"><h3>Your contact details</h3><p>Enter your details to start a conversation with OSS.</p></div><div class="form-row"><div class="field" id="fwChatFirst"><label for="chatFirst">First name *</label><input id="chatFirst" placeholder="Juan" autocomplete="given-name" maxlength="80" oninput="autoCapitalizeInput(this)"><div class="field-error"></div></div><div class="field" id="fwChatLast"><label for="chatLast">Last name *</label><input id="chatLast" placeholder="Dela Cruz" autocomplete="family-name" maxlength="80" oninput="autoCapitalizeInput(this)"><div class="field-error"></div></div></div><div class="form-row"><div class="field" id="fwChatContact"><label for="chatContact">Contact number *</label><div class="ph-phone-input"><span class="ph-phone-prefix" title="Philippines (+63)"><span class="ph-phone-flag" aria-hidden="true"><svg viewBox="0 0 30 20" width="24" height="16"><path fill="#0038a8" d="M0 0h30v10H0z"/><path fill="#ce1126" d="M0 10h30v10H0z"/><path fill="#fff" d="M0 0l17 10L0 20z"/><g fill="#fcd116"><circle cx="5.5" cy="10" r="2.2"/><path d="M5 6h1v8H5zM1.5 9.5h8v1h-8zM2.3 7.3l.7-.7 5.7 5.7-.7.7zM2.3 12.7L8 7l.7.7L3 13.4z"/><circle cx="2.4" cy="3.2" r=".8"/><circle cx="2.4" cy="16.8" r=".8"/><circle cx="13" cy="10" r=".8"/></g></svg></span><span aria-hidden="true">+63</span><span class="sr-only">Philippines country code +63</span></span><input id="chatContact" type="tel" inputmode="tel" autocomplete="tel" maxlength="16" placeholder="9171234567" aria-label="Philippine mobile number, country code +63" oninput="formatContactInput(this)"></div><div class="field-error"></div></div><div class="field" id="fwChatEmail"><label for="chatEmail">Gmail *</label><input id="chatEmail" type="email" autocomplete="email" maxlength="120" placeholder="name@gmail.com"><div class="field-error"></div></div></div><p class="field-hint">Use your own Gmail. Verify your inbox before starting or reopening a conversation.</p><div class="visit-pass-actions chat-contact-actions"><button class="btn btn-primary" onclick="startContactChat()">Continue</button><button class="btn btn-ghost" onclick="resumeChatByEmail()">Resume a conversation</button></div></div>`;
}
function chatProfileValidation(profile) {
  const name=value=>String(value||'').trim().length>=2 && /^[\p{L}\p{M}][\p{L}\p{M}'\u2019\u2018 .-]*$/u.test(value);
  return {first:name(profile.first),last:name(profile.last),contact:isValidContact(profile.contact),email:isValidGmail(profile.email)};
}
function startContactChat() {
  if(!isOfficeHours()){renderClosedScreen();return;}
  const profile={first:document.getElementById('chatFirst').value.trim(),last:document.getElementById('chatLast').value.trim(),contact:'+63'+document.getElementById('chatContact').value.replace(/\D/g,'').replace(/^(?:63|0)/,''),email:normEmail(document.getElementById('chatEmail').value)};
  const valid=chatProfileValidation(profile);let ok=true;
  for(const [key,id,message] of [['first','fwChatFirst','Enter a valid first name.'],['last','fwChatLast','Enter a valid last name.'],['contact','fwChatContact','Enter a valid Philippine mobile number.'],['email','fwChatEmail','Enter a valid Gmail address.']])ok=markField(id,valid[key],message)&&ok;
  if(!ok){focusFirstError();return;}
  const capitalize=value=>value.replace(/(^|[\s-])\p{L}/gu,letter=>letter.toLocaleUpperCase());
  profile.first=capitalize(profile.first);profile.last=capitalize(profile.last);
  chatFlow={step:'message',profile,message:'',bubbles:[{sender:'staff',text:`Hi ${profile.first}! What would you like to ask or report to OSS?`}]};renderChatFlowScreen();
}
let contactChatPending=false;
async function finalizeChatFlow() {
  if(contactChatPending)return;
  if(!isOfficeHours()){renderClosedScreen();return;}
  if(!chatFlow?.profile){initChatFlow();return;}
  contactChatPending=true;
  try {
    const files=document.getElementById('cfFiles')?.files||[],errors=validateAttachments(files);
    if(errors.length){toast(escapeHtml(errors.join(' ')),'err');return;}
    const attachments=await readFilesAsAttachments(files),profile=chatFlow.profile,name=joinName(profile.first,profile.last),db=loadDB();
    const chat=mkChat({visitorName:name,firstName:profile.first,lastName:profile.last,email:profile.email,contact:profile.contact,visitId:null,createdAt:new Date(),updatedAt:new Date()});
    chat.messages.push({id:uid('MSG'),sender:'visitor',senderName:name,text:chatFlow.message,ts:new Date(),attachments});chat.staffUnread=1;db.chats.push(chat);saveDB(db);
    currentPublicChatId=chat.id;persistSession();chatFlow=null;renderChatScreen();renderVisitorSidebar();
  }catch(error){toast(escapeHtml(error.message||'Could not start the conversation. Please try again.'),'err');}
  finally{contactChatPending=false;}
}
function resumeChatByEmail() {
  openModal('Resume a conversation',`<div class="field"><label for="resumeChatEmail">Gmail</label><input id="resumeChatEmail" type="email" autocomplete="email" placeholder="name@gmail.com"></div><p class="field-hint">We will send a verification code before showing your conversations.</p>${VisitorTurnstile.markup('resumeChatSecurity')}`,[{label:'Send code',cls:'btn-primary',action:async()=>{
    const email=normEmail(document.getElementById('resumeChatEmail').value);if(!isValidGmail(email)){toast('Enter a valid Gmail address.','err');return;}
    const turnstileToken=await VisitorTurnstile.getToken('resumeChatSecurity');
    let result;
    try { result=await UniServeUX.request('/history/code','POST',{email,turnstileToken}); } finally { VisitorTurnstile.reset('resumeChatSecurity'); }
    openModal('Verify Gmail',`<div class="field"><label for="resumeChatCode">Verification code</label><input id="resumeChatCode" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div><p class="field-hint">Enter the code sent to ${escapeHtml(email)}. It expires in five minutes.</p>`,[{label:'Verify and resume',cls:'btn-primary',action:async()=>{
      await UniServeUX.request('/history/verify','POST',{challengeId:result.challengeId,code:document.getElementById('resumeChatCode').value.trim()});
      const db=loadDB(),matches=db.chats.filter(c=>normEmail(c.email||findVisitByRef(db,c.visitId)?.email)===email).sort((a,b)=>new Date(b.updatedAt)-new Date(a.updatedAt));
      if(!matches.length){toast('No conversation found for this Gmail in this browser. You can start a new conversation.','err');return;}
      closeModal();currentPublicChatId=matches[0].id;persistSession();chatFlow=null;renderChatScreen();renderVisitorSidebar();
    }}]);
  }}]);
  VisitorTurnstile.mount('resumeChatSecurity');
}
function resumeChat(){resumeChatByEmail();}
function toggleChatResume(){resumeChatByEmail();}
if(visitorView==='chat' && !currentPublicChatId)initChatFlow();
