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
  document.getElementById('visitorContent').innerHTML=`<div class="card card-pad visitor-page-wrap chat-contact-card"><div class="chat-contact-head"><h3>Your details</h3><p>Enter your details to start a conversation with OSS.</p></div><div class="field" id="fwChatType"><label for="chatType">Visitor type ${uxReq}</label><select id="chatType" onchange="updateChatEmailPlaceholder()"><option value="">Select visitor type</option><option value="Student">Student</option><option value="Guest">Guest</option></select><div class="field-error"></div></div><div class="field" id="fwChatName"><label for="chatName">Full name ${uxReq}</label><input id="chatName" placeholder="Juan Dela Cruz" autocomplete="name" maxlength="74" oninput="autoCapitalizeInput(this)"><div class="field-error"></div></div><div class="field" id="fwChatEmail"><label for="chatEmail">Email address ${uxReq}</label><input id="chatEmail" type="email" autocomplete="email" maxlength="120" placeholder="name@example.com"><div class="field-error"></div></div><p id="chatHoursNotice" class="field-hint" role="status" hidden>New chats are available during office hours. You can still resume an existing chat.</p><div class="visit-pass-actions chat-contact-actions"><button class="btn btn-ghost" onclick="toggleChatResume()">Resume a chat</button><button class="btn btn-primary" onclick="startContactChat()">Continue</button></div></div>`;
}
function updateChatEmailPlaceholder() {
  const type=document.getElementById('chatType').value;
  document.getElementById('chatEmail').placeholder=type==='Student'?'name@iskolarngbayan.pup.edu.ph':type==='Guest'?'name@gmail.com':'name@example.com';
}
function chatProfileValidation(profile) {
  return {name:isValidPersonName(profile.name),type:['Student','Guest'].includes(profile.type),email:isValidEmail(profile.email)&&(profile.type==='Student'?profile.email.endsWith('@iskolarngbayan.pup.edu.ph'):profile.type==='Guest'&&profile.email.endsWith('@gmail.com'))};
}
async function startContactChat() {
  if(!isOfficeHours()){const notice=document.getElementById('chatHoursNotice');if(notice)notice.hidden=false;return;}
  const profile={name:document.getElementById('chatName').value.trim(),type:document.getElementById('chatType').value,email:normEmail(document.getElementById('chatEmail').value)};
  const valid=chatProfileValidation(profile);let ok=true;
  for(const [key,id,message] of [['type','fwChatType','Select your visitor type.'],['name','fwChatName','Enter a valid full name.'],['email','fwChatEmail',profile.type==='Student'?'Use your @iskolarngbayan.pup.edu.ph email.':'Use your @gmail.com email.']])ok=markField(id,valid[key],message)&&ok;
  if(!ok){focusFirstError();return;}
  SharedAppointments.verify(()=>{
    if(visitorHubOpen || visitorView!=='chat')return;
    const capitalize=value=>value.replace(/(^|[\s-])\p{L}/gu,letter=>letter.toLocaleUpperCase());
    profile.name=capitalize(profile.name);
    chatFlow={step:'message',profile,message:'',bubbles:[{sender:'staff',text:`Hi ${profile.name}! What would you like to ask or report to OSS?`}]};renderChatFlowScreen();
  },{purpose:'submission',email:profile.email});
}
let contactChatPending=false;
// Sending and resuming conversations use the authenticated API in portal-api.js.
function toggleChatResume(){
  document.getElementById('visitorContent').innerHTML=`<div class="card card-pad visitor-page-wrap chat-contact-card"><div class="chat-contact-head"><h3>Resume a chat</h3><p>Enter the chat code sent to your email.</p></div><div class="field"><label class="verification-code-label" for="chatResumeCode">Chat code</label><input id="chatResumeCode" class="chat-code-input" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="6" onkeydown="if(event.key==='Enter')resumeChatByCode()"></div><div class="visit-pass-actions chat-contact-actions"><button class="btn btn-ghost" onclick="renderChatIdentity()">Back</button><button class="btn btn-primary" onclick="resumeChatByCode()">Open chat</button></div></div>`;
}
if(visitorView==='chat' && !currentPublicChatId)initChatFlow();
