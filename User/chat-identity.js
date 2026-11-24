// New conversations use a name; saved codes reopen existing conversations.
function initChatFlow() {
  chatFlow={step:'identity',profile:null,message:'',bubbles:[]};renderChatIdentity();
}
function renderChatIdentity() {
  const closed=!isOfficeHours();
  if(closed){
    document.getElementById('visitorContent').innerHTML=`<div class="card card-pad visitor-page-wrap chat-contact-card"><div class="chat-contact-head"><h3>Chat with OSS</h3><p role="status">New chats are available during office hours. You can still resume an existing chat.</p></div><div class="visit-pass-actions chat-contact-actions"><button class="btn btn-ghost" onclick="toggleChatResume()">Resume a chat</button></div></div>`;
    return;
  }
  document.getElementById('visitorContent').innerHTML=`<div class="card card-pad visitor-page-wrap chat-contact-card"><div class="chat-contact-head"><h3>Your name</h3><p>Enter your name to start a conversation with OSS.</p></div><div class="form-row"><div class="field" id="fwChatFirst"><label for="chatFirst">First name *</label><input id="chatFirst" placeholder="Juan" autocomplete="given-name" maxlength="80" oninput="autoCapitalizeInput(this)" ${closed?'disabled':''}><div class="field-error"></div></div><div class="field" id="fwChatLast"><label for="chatLast">Last name *</label><input id="chatLast" placeholder="Dela Cruz" autocomplete="family-name" maxlength="80" oninput="autoCapitalizeInput(this)" ${closed?'disabled':''}><div class="field-error"></div></div></div><p id="chatHoursNotice" class="field-hint" role="status" ${closed?'':'hidden'}>New chats are available during office hours. You can still resume an existing chat.</p><div class="visit-pass-actions chat-contact-actions"><button class="btn btn-primary" onclick="startContactChat()" ${closed?'disabled':''}>Continue</button><button class="btn btn-ghost" onclick="toggleChatResume()">Resume a chat</button></div></div>`;
}
function chatProfileValidation(profile) {
  return {first:isValidPersonName(profile.first),last:isValidPersonName(profile.last)};
}
function startContactChat() {
  if(!isOfficeHours()){const notice=document.getElementById('chatHoursNotice');if(notice)notice.hidden=false;return;}
  const profile={first:document.getElementById('chatFirst').value.trim(),last:document.getElementById('chatLast').value.trim()};
  const valid=chatProfileValidation(profile);let ok=true;
  for(const [key,id,message] of [['first','fwChatFirst','Enter a valid first name.'],['last','fwChatLast','Enter a valid last name.']])ok=markField(id,valid[key],message)&&ok;
  if(!ok){focusFirstError();return;}
  const capitalize=value=>value.replace(/(^|[\s-])\p{L}/gu,letter=>letter.toLocaleUpperCase());
  profile.first=capitalize(profile.first);profile.last=capitalize(profile.last);
  chatFlow={step:'message',profile,message:'',bubbles:[{sender:'staff',text:`Hi ${profile.first}! What would you like to ask or report to OSS?`}]};renderChatFlowScreen();
}
let contactChatPending=false;
// Sending and resuming conversations use the authenticated API in portal-api.js.
function toggleChatResume(){
  document.getElementById('visitorContent').innerHTML=`<div class="card card-pad visitor-page-wrap chat-contact-card"><div class="chat-contact-head"><h3>Resume a chat</h3><p>Enter the private code you saved when you started your chat.</p></div><div class="field"><label class="verification-code-label" for="chatResumeCode">Chat code</label><input id="chatResumeCode" class="chat-code-input" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="6" onkeydown="if(event.key==='Enter')resumeChatByCode()"></div><div class="visit-pass-actions chat-contact-actions"><button class="btn btn-primary" onclick="resumeChatByCode()">Open chat</button><button class="btn btn-ghost" onclick="renderChatIdentity()">Back</button></div></div>`;
}
if(visitorView==='chat' && !currentPublicChatId)initChatFlow();
