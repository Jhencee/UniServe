(function(){
  const nativeFetch=window.fetch.bind(window),API=(globalThis.UniServeConfig?.apiBase||'http://127.0.0.1:8000/api');
  const visitor=typeof visitorView!=='undefined',staff=typeof state_view!=='undefined';
  let sessionEnding=false;
  const sessionRequests=new AbortController();
  if(staff){
    const originalEnd=endSession,originalToast=toast;
    endSession=function(reason){if(sessionEnding)return;sessionEnding=true;sessionRequests.abort();window.dispatchEvent(new Event('uniserve:session-ended'));originalEnd(reason);};
    toast=function(...args){if(!sessionEnding)return originalToast(...args);};
  }
  window.fetch=async function(url,options={}){
    const visitorIdentity=window.visitorIdentityVersion||0;
    const staffRequest=staff&&typeof url==='string'&&url.startsWith(API),logout=staffRequest&&url===API+'/logout';
    if(staffRequest&&!logout){
      if(sessionEnding)throw new DOMException('Session ended.','AbortError');
      options={...options,signal:options.signal?AbortSignal.any([options.signal,sessionRequests.signal]):sessionRequests.signal};
    }
    if(typeof url==='string'&&url.startsWith(API)){
      const headers=new Headers(options.headers||{});
      const visitorToken=sessionStorage.getItem('ossuniserve_visitor_token');
      if(visitorToken)headers.set('X-Visitor-Token',visitorToken);
      const visit=url.match(/\/visits\/([^/]+)/)?.[1];
      if(visit){const token=sessionStorage.getItem('visit-token:'+decodeURIComponent(visit));if(token)headers.set('X-Visit-Token',token);}
      options={...options,headers};
    }
    const response=await nativeFetch(url,options);
    if(visitor&&typeof url==='string'&&url.startsWith(API)&&visitorIdentity!==(window.visitorIdentityVersion||0))throw new DOMException('Visitor changed. The previous request was discarded.','AbortError');
    if(staffRequest&&!logout){
      if(sessionEnding)throw new DOMException('Session ended.','AbortError');
      if(response.status===401)endSession('Your session ended. Please sign in again.');
    }
    if(typeof url==='string'&&url===API+'/visits'&&response.ok){const result=await response.clone().json();if(visitor&&visitorIdentity!==(window.visitorIdentityVersion||0))throw new DOMException('Visitor changed.','AbortError');if(result.visitToken)sessionStorage.setItem('visit-token:'+result.queue.visitId,result.visitToken);}
    if(visitor&&typeof url==='string'&&url.startsWith(API)){
      const readJson=response.json.bind(response);
      response.json=async function(){const data=await readJson();if(visitorIdentity!==(window.visitorIdentityVersion||0))throw new DOMException('Visitor changed.','AbortError');return data;};
    }
    return response;
  };
  async function request(path,method='GET',body,options={}){
    const headers={Accept:'application/json','Content-Type':'application/json'};
    if(staff){const session=JSON.parse(sessionStorage.getItem('ossuniserve_session')||'{}');headers.Authorization='Bearer '+(session.token||'');}
    const chat=path.match(/^\/chats\/([^/]+)/)?.[1];if(chat&&visitor&&!sessionStorage.getItem('ossuniserve_visitor_token')){const token=sessionStorage.getItem('chat-token:'+chat);if(token)headers['X-Chat-Token']=token;}
    const feedbackId=path.match(/^\/queue\/([^/]+)\/feedback$/)?.[1];
    if(feedbackId&&visitor){const q=loadDB().queues.find(q=>q.id===feedbackId),token=q&&sessionStorage.getItem('visit-token:'+q.visitId);if(token)headers['X-Visit-Token']=token;}
    const response=await fetch(API+path,{method,headers,signal:AbortSignal.timeout(15000),...options,...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();if(!response.ok){const e=Error(Object.values(data.errors||{}).flat().join(' ')||data.message||'Request failed.');e.status=response.status;throw e;}return data;
  }
  function cache(data){
    if(staff&&typeof sharedQueueSnapshot!=='undefined')for(const q of [...(data.queues||[]),...(data.queue?[data.queue]:[])])sharedQueueSnapshot.set(q.id,JSON.stringify(q));
    const db=loadDB();if(data.chats)db.chats=(db.chats||[]).filter(c=>!c.shared&&!data.chats.some(s=>s.id===c.id)).concat(data.chats);if(data.chat)db.chats=db.chats.filter(c=>c.id!==data.chat.id).concat(data.chat);if(data.queues)db.queues=(db.queues||[]).filter(q=>!q.shared&&!data.queues.some(s=>s.id===q.id)).concat(data.queues);if(data.queue)db.queues=db.queues.filter(q=>q.id!==data.queue.id).concat(data.queue);
    if(data.services)db.services=data.services;
    if(data.settings)db.systemSettings={...db.systemSettings,...data.settings};
    // Shared chats are an in-memory API snapshot, not persistent browser records.
    const persist={...db,chats:db.chats.filter(c=>!c.shared)};saveDB(persist);
    chats=db.chats;return data;
  }
  let chats=[],serverAudit=null;
  const originalLoad=loadDB;
  loadDB=function(){const db=originalLoad();if(chats.length)db.chats=chats;if(serverAudit)db.activityLog=serverAudit;return db;};
  const originalSave=saveDB;
  saveDB=function(db){chats=db.chats||chats;originalSave({...db,users:(db.users||[]).map(({password,password_hash,...user})=>user),chats:(db.chats||[]).filter(c=>!c.shared)});};
  async function refreshChats(){cache(await request('/chats'));}
  let settingsRevision=0,settingsRefreshPromise=null;
  async function refreshPortalSettings(){
    if(settingsRefreshPromise)return settingsRefreshPromise;
    settingsRefreshPromise=(async()=>{
      const data=await request('/settings'),changed=data.revision!==settingsRevision;
      settingsRevision=data.revision;cache(data);return changed;
    })();
    try{return await settingsRefreshPromise;}finally{settingsRefreshPromise=null;}
  }
  document.addEventListener('visibilitychange',async()=>{
    if(document.visibilityState==='hidden'||sessionEnding)return;
    try{if(await refreshPortalSettings())window.dispatchEvent(new CustomEvent('uniserve:changed',{detail:{resource:'settings-refreshed'}}));}catch(_){}
  });
  let headRequestRefresh=null;
  async function refreshHeadAccessRequests(){
    if(!staff||currentUser?.role!=='ADMIN')return;
    if(headRequestRefresh)return headRequestRefresh;
    headRequestRefresh=(async()=>{
      const [result,own]=await Promise.all([currentUser.confidentialApprover?request('/confidential/notifications'):Promise.resolve({requests:[]}),request('/confidential/approvals')]);
      window.headAccessRequestNotifications=result.requests||[];
      window.approvedAccessNotifications=own.approvals||[];
      if(typeof window.refreshSidebarNotificationCount==='function'){window.refreshSidebarNotificationCount();return;}
      const badge=document.querySelector('#sidebarNotifications .notification-bell-count');
      if(badge){const previous=Number(badge.dataset.accessRequests||0);badge.textContent=Math.max(0,Number(badge.textContent||0)-previous)+window.headAccessRequestNotifications.length+window.approvedAccessNotifications.length;badge.dataset.accessRequests=String(window.headAccessRequestNotifications.length+window.approvedAccessNotifications.length);}
    })();
    try{await headRequestRefresh;}finally{headRequestRefresh=null;}
  }
  if(staff&&typeof renderNotifications==='function'){
    const originalNotifications=renderNotifications;
    let notificationDataRefresh=null;
    renderNotifications=async function(){
      try{
        if(!notificationDataRefresh)notificationDataRefresh=Promise.all([
          refreshHeadAccessRequests(),
          SharedAppointments.request('/appointments').then(SharedAppointments.cache),
          SharedAppointments.reloadRecords()
        ]).finally(()=>{notificationDataRefresh=null;});
        await notificationDataRefresh;
        if(!sessionEnding&&state_view==='notifications')originalNotifications();
      }catch(e){if(state_view==='notifications')toast(escapeHtml(e.message),'err');}
    };
    const refresh=async()=>{if(sessionEnding||document.visibilityState==='hidden')return;try{if(state_view==='notifications')await renderNotifications();else await refreshHeadAccessRequests();}catch(_){};};
    if(currentUser?.role==='ADMIN'){refresh();setInterval(refresh,15000);}
  }
  let realtimeRefreshBusy=false;
  window.addEventListener('uniserve:changed',async event=>{
    if(document.visibilityState==='hidden')return;
    if(event.detail?.resource==='settings'){try{await refreshPortalSettings();}catch(_){return;}}
    if(realtimeRefreshBusy||document.visibilityState==='hidden')return;realtimeRefreshBusy=true;
    try{
      if(staff){
        await refreshHeadAccessRequests();
        if(state_view==='notifications'){await renderNotifications();}
        else if(state_view==='messages'){
          await refreshChats();renderChatThreadList();const c=loadDB().chats.find(c=>c.id===activeStaffChatId),area=document.getElementById('chatMsgArea');if(c&&area)area.innerHTML=renderBubbles(c);
        }else if(state_view==='queue')await renderQueueDashboard();
        else if(state_view==='dashboard')await renderDashboard();
        else if(state_view==='appointments')await renderAppointments(true);
        else if(state_view==='logbook')await renderVisitorLogbook(true);
        else if(state_view==='feedback'&&typeof renderFeedback==='function')await renderFeedback();
        else if(state_view==='transactions'){if(document.getElementById('confidentialAccessBody')&&typeof openConfidentialAccess==='function')await openConfidentialAccess();else await renderTransactions();}
        else if(state_view==='activitylog'&&typeof loadCentralAudit==='function')await loadCentralAudit();
      }else if(visitor){
        if(['settings','settings-refreshed'].includes(event.detail?.resource)){
          if(visitorHubOpen)renderHubOfficeNotice();else if(visitorView==='visit'){captureVisitorDraft();renderVisitScreen();}
        }
        if(visitorView==='chat'&&currentPublicChatId)await refreshChatIfNeeded(currentPublicChatId);
        else if(['visit','checkvisit'].includes(visitorView)&&myActiveQueueId)await renderQueueTicket();
        else if(['visit','checkvisit'].includes(visitorView)&&sessionStorage.getItem('oss_activeAppointmentId'))await refreshAppointmentPass();
      }else if(typeof renderPublicDisplay==='function'){
        cache(await request('/public-queue'));renderLandingLive();if(document.getElementById('publicDisplayContent'))await renderPublicDisplay();
      }
    }catch(_){}finally{realtimeRefreshBusy=false;}
  });
  if(staff)doLogout=function(){openModal('Log Out?','<p class="logout-confirm-copy">Are you sure you want to log out?</p>',[
    {label:'Cancel',cls:'btn-ghost',action:closeModal},
    {label:'Log Out',cls:'btn-primary',action:()=>{request('/logout','POST',{}, {keepalive:true}).catch(()=>{});chats=[];window.SecureState?.clear();closeModal();endSession();}}
  ]);};
  refreshPortalSettings().catch(()=>{});
  if(staff&&currentUser?.requiresPasswordChange){navigate('profile');toast('At least 12 characters with uppercase and lowercase letters, a number, and a special character.','err');}
  if(staff&&typeof SharedAppointments!=='undefined'){
    const legacy=originalLoad(),origin=localStorage.getItem('oss_legacy_origin')||crypto.randomUUID(),payload={origin};localStorage.setItem('oss_legacy_origin',origin);
    for(const key of ['transactions','appointments','chats','queues','visitorLog'])payload[key]=(legacy[key]||[]).filter(r=>{
      if(r.shared||r.restricted||typeof r.id!=='string'||!r.id.match(/^[a-zA-Z0-9_-]{1,80}$/))return false;
      if(key==='queues')return !!(r.visitId&&r.visitorType&&r.serviceLabel);
      if(key==='appointments')return !!(r.visitId&&r.email&&r.service);
      return true;
    });
    const retryKey='oss_legacy_import_after',mayImport=Date.now()>Number(localStorage.getItem(retryKey)||0);
    if(mayImport&&Object.entries(payload).some(([key,rows])=>key!=='origin'&&rows.length)){
    localStorage.setItem(retryKey,String(Date.now()+60000));
    request('/import-browser','POST',payload).then(result=>{
      const db=originalLoad();for(const key of Object.keys(payload).filter(key=>key!=='origin'))db[key]=db[key].map(row=>{if(!(result.accepted[key]||[]).includes(row.id))return row;const copy={...row,id:result.mapping[key][row.id],shared:true};for(const [field,kind] of Object.entries({queueId:'queues',appointmentId:'appointments',transactionId:'transactions'}))if(result.mapping[kind]?.[copy[field]])copy[field]=result.mapping[kind][copy[field]];return copy;});
      saveDB(db);SharedAppointments.reloadRecords();
    }).catch(e=>{if(e.status===429)localStorage.setItem(retryKey,String(Date.now()+300000));else toast('Legacy records preserved locally: '+escapeHtml(e.message),'err');});
    }
  }
  if(staff&&typeof saveSettings==='function'){
    async function overview(){
      const [result,catalog]=await Promise.all([request('/reports'),request('/services'),refreshPortalSettings(),typeof refreshAdmins==='function'?refreshAdmins():Promise.resolve()]);
      const db=loadDB();
      if(result.activityLog)serverAudit=result.activityLog;
      for(const key of ['activityLog','transactions','appointments','queues'])if(Array.isArray(result[key]))db[key]=result[key];
      db.feedbackSummary=result.feedbackSummary;
      db.services=catalog.services;
      saveDB(db);
    }
    const originalDashboard=renderDashboard,originalReports=renderReports;
    renderDashboard=async function(){try{await overview();if(state_view==='dashboard')originalDashboard();}catch(e){if(state_view==='dashboard')toast(escapeHtml(e.message),'err');}};
    renderReports=async function(){try{await overview();if(state_view==='reports')originalReports();}catch(e){if(state_view==='reports')toast(escapeHtml(e.message),'err');}};
    let systemReportOutputBusy=false;
    async function systemReportOutput(render){
      if(systemReportOutputBusy)return;systemReportOutputBusy=true;
      try{await overview();render();}catch(error){toast(escapeHtml(error.message||'Could not authorize report output.'),'err');}finally{systemReportOutputBusy=false;}
    }
    const originalSystemPrint=printReport,originalSystemExcel=downloadReportExcel;
    printReport=function(){return systemReportOutput(()=>{if(state_view==='reports'&&document.getElementById('reportSheet')){buildReport();originalSystemPrint();}});};
    downloadReportExcel=function(){return systemReportOutput(()=>{if(state_view==='reports')originalSystemExcel();});};
    if(typeof printAuditReport==='function'){const originalAuditPrint=printAuditReport;printAuditReport=function(){return systemReportOutput(originalAuditPrint);};}
    if(typeof exportAuditExcel==='function'){const originalAuditExcel=exportAuditExcel;exportAuditExcel=function(){return systemReportOutput(()=>{auditRowsCache=auditFiltered(loadDB());originalAuditExcel();});};}
    const oldAudit=renderActivityLog;
    renderActivityLog=async function(){if(typeof renderCentralAudit==='function'){document.getElementById('content').innerHTML='';centralAuditPage=1;await renderCentralAudit();return;}try{let result=await request('/audit');const db=loadDB();db.activityLog=result.data.map(e=>({id:e.id,user:e.actor_name,role:'Staff',action:e.action,category:e.category,target:e.target,changes:e.changes,ts:e.created_at}));saveDB(db);oldAudit();}catch(e){toast(escapeHtml(e.message),'err');}};
    const oldSettings=renderSettings;
    renderSettings=async function(){try{const data=await request('/settings');settingsRevision=data.revision;cache(data);await overview();oldSettings();}catch(e){toast(escapeHtml(e.message),'err');}};
    saveSettings=async function(){try{const db=loadDB(),s={...db.systemSettings,orgName:document.getElementById('stOrg').value,supportEmail:document.getElementById('stEmail').value,supportPhone:document.getElementById('stPhone').value,maintenanceMode:document.getElementById('stMaint').checked,allowParallelService:document.getElementById('stParallel').checked,appointmentOffices:[...new Set(document.getElementById('stAppointmentOffices').value.split(/\r?\n/).map(v=>v.trim()).filter(Boolean))],appointmentSlotCapacity:Number(document.getElementById('stSlotCapacity').value),sessionTimeout:Number(document.getElementById('stTimeout').value),gracePeriodMinutes:Number(document.getElementById('stGraceMin').value),noShowThresholdMinutes:Number(document.getElementById('stNoShowMin').value),queuePrefixStudent:document.getElementById('stQPrefixStudent').value.toUpperCase(),queuePrefixGuest:document.getElementById('stQPrefixGuest').value.toUpperCase()};const data=await request('/settings','PUT',{settings:s,revision:settingsRevision});settingsRevision=data.revision;cache(data);if(typeof markSuperSettingsSaved==='function')markSuperSettingsSaved();toast(s.maintenanceMode?'Settings saved. Maintenance mode is on; new visits are unavailable.':'Settings saved. Maintenance mode is off.','ok');}catch(e){toast(escapeHtml(e.message),'err');}};
  }
  if(staff&&typeof renderMessages==='function'){
    if(typeof renderFeedback==='function'&&typeof loadSharedQueue==='function'){
      const originalFeedback=renderFeedback;
      renderFeedback=async function(){try{await loadSharedQueue();if(state_view==='feedback')originalFeedback();}catch(e){if(state_view==='feedback')toast(escapeHtml(e.message),'err');}};
    }
    const originalMessages=renderMessages;
    const originalStaffChat=openStaffChat;
    openStaffChat=async function(id){try{cache(await request('/chats/'+id+'/read','POST',{}));originalStaffChat(id);}catch(e){toast(escapeHtml(e.message),'err');}};
    renderMessages=async function(){try{await refreshChats();if(state_view==='messages')originalMessages();}catch(e){if(state_view==='messages')toast(escapeHtml(e.message),'err');}};
    window.sendStaffReply=async function(id){try{cache(await request('/chats/'+id+'/messages','POST',{text:document.getElementById('staffReplyBox').value.trim(),attachments:pendingStaffAttachments}));pendingStaffAttachments=[];openStaffChat(id);}catch(e){toast(escapeHtml(e.message),'err');}};
    window.setChatStatus=async function(id,status){try{cache(await request('/chats/'+id,'PATCH',{status}));renderChatThreadList();openStaffChat(id);}catch(e){toast(escapeHtml(e.message),'err');}};
    window.removeChatThread=async function(id){if(!await UniServeUX.confirm('Delete conversation','Delete this conversation permanently?','Delete conversation'))return;try{await request('/chats/'+id,'DELETE');chats=chats.filter(c=>c.id!==id);activeStaffChatId=null;renderChatThreadList();document.getElementById('chatPanel').innerHTML=emptyChatPanel();}catch(e){toast(escapeHtml(e.message),'err');}};
    setInterval(async()=>{if(state_view!=='messages'||window.UniServeRealtime?.connected||document.visibilityState==='hidden')return;try{await refreshChats();renderChatThreadList();if(activeStaffChatId){if(document.visibilityState==='visible')cache(await request('/chats/'+activeStaffChatId+'/read','POST',{}));const c=loadDB().chats.find(c=>c.id===activeStaffChatId),area=document.getElementById('chatMsgArea');if(c&&area){area.innerHTML=renderBubbles(c);}}}catch(_){}},4000);
  }
  if(visitor){
    let historyEntryBusy=false;
    window.openVerifiedVisitorHistory=async function(){
      if(historyEntryBusy)return;historyEntryBusy=true;
      const enter=async()=>{
        const result=await request('/history','GET',undefined,{headers:{Accept:'application/json','X-Visitor-Token':sessionStorage.getItem('ossuniserve_visitor_token')||''}});
        SharedAppointments.cache({appointments:result.appointments});cache({queues:result.queues});
        historyFlow={step:'verified',email:result.email,code:''};
        window.visitorHistoryGateEntering=true;
        try{navigateVisitor('history');}finally{window.visitorHistoryGateEntering=false;}
      };
      try{
        if(sessionStorage.getItem('ossuniserve_visitor_token')){
          try{await enter();return;}catch(e){if(e.status!==401&&e.status!==403)throw e;if(typeof clearVisitorIdentity==='function')clearVisitorIdentity();else sessionStorage.removeItem('ossuniserve_visitor_token');historyFlow=null;}
        }
        SharedAppointments.verify(enter,{purpose:'history'});
      }catch(e){toast(escapeHtml(e.message),'err');}finally{historyEntryBusy=false;}
    };
    if(window.pendingVisitorHistory){window.pendingVisitorHistory=false;window.openVerifiedVisitorHistory();}
    let chatEntryBusy=false;
    window.openVerifiedVisitorChat=async function(){
      if(chatEntryBusy)return;chatEntryBusy=true;
      const enter=async()=>{
        await refreshChats();currentPublicChatId=chats[0]?.id||null;chatFlow=null;
        window.visitorChatGateEntering=true;
        try{navigateVisitor('chat');persistSession();}finally{window.visitorChatGateEntering=false;}
      };
      try{
        if(sessionStorage.getItem('ossuniserve_visitor_token')){
          try{await enter();return;}catch(e){if(e.status!==401&&e.status!==403)throw e;}
        }
        SharedAppointments.verify(enter,{purpose:'chat'});
      }catch(e){toast(escapeHtml(e.message),'err');}finally{chatEntryBusy=false;}
    };
    if(window.pendingVisitorChat){window.pendingVisitorChat=false;window.openVerifiedVisitorChat();}
    window.finalizeChatFlow=async function(){
      if(contactChatPending)return;contactChatPending=true;
      try{const p=chatFlow.profile,files=document.getElementById('cfFiles')?.files||[];const errors=validateAttachments(files);if(errors.length)throw Error(errors.join(' '));const result=await request('/chats','POST',{visitorName:joinName(p.first,p.last),email:p.email,contact:p.contact.replace(/\D/g,''),text:chatFlow.message,attachments:await readFilesAsAttachments(files)});sessionStorage.setItem('chat-token:'+result.chat.id,result.chatToken);cache(result);currentPublicChatId=result.chat.id;chatFlow=null;persistSession();renderChatScreen();}catch(e){if(e.status===401||e.status===403)SharedAppointments.verify(()=>finalizeChatFlow(),{purpose:'chat',email:chatFlow?.profile?.email||''});else toast(escapeHtml(e.message),'err');}finally{contactChatPending=false;}
    };
    window.resumeChatByEmail=function(){SharedAppointments.verify(async()=>{await refreshChats();if(!chats.length){toast('No conversations found.','err');return;}currentPublicChatId=chats[0].id;chatFlow=null;persistSession();renderChatScreen();},{purpose:'chat'});};
    window.sendVisitorMessage=async function(id){try{cache(await request('/chats/'+id+'/messages','POST',{text:document.getElementById('chReply').value.trim(),attachments:await readFilesAsAttachments(document.getElementById('chReplyFiles')?.files)}));renderPublicChatThread(loadDB().chats.find(c=>c.id===id));}catch(e){if(e.status===401)SharedAppointments.verify(()=>sendVisitorMessage(id),{purpose:'chat'});else toast(escapeHtml(e.message),'err');}};
    window.refreshChatIfNeeded=async function(id){try{const result=cache(await request('/chats/'+id+'/read','POST',{}));const area=document.getElementById('chatMsgArea');if(area)area.innerHTML=renderBubbles(result.chat);}catch(_){};};
    let feedbackBusy=false;
    submitVisitFeedback=async function(id,draft){
      if(feedbackBusy)return;const data=draft||{rating:feedbackStars,comment:document.getElementById('fbComment')?.value.trim()||''};
      if(!data.rating){toast('Please select a star rating.','err');return;}
      feedbackBusy=true;
      try{cache(await request('/queue/'+id+'/feedback','POST',data));feedbackStars=0;renderQueueTicket();toast('Thanks for your feedback!','ok');}
      catch(e){if(e.status===401)SharedAppointments.verify(()=>submitVisitFeedback(id,data));else toast(escapeHtml(e.message),'err');}
      finally{feedbackBusy=false;}
    };
    const oldLookup=lookupMyVisit;
    lookupMyVisit=async function(){const code=normVisitRef(document.getElementById('cvInput').value);const local=loadDB().queues.find(q=>q.visitId===code);if(local||sessionStorage.getItem('ossuniserve_visitor_token'))return oldLookup();SharedAppointments.verify(()=>oldLookup());};
    if(currentPublicChatId)request('/chats/'+currentPublicChatId).then(cache).then(()=>{if(visitorView==='chat')renderChatScreen();}).catch(()=>{currentPublicChatId=null;});
  }
  if(!staff&&!visitor&&typeof renderPublicDisplay==='function'){
    request('/services').then(cache).then(()=>{renderServicesPreview();renderLandingInfo();}).catch(()=>{});
    const original=renderPublicDisplay;let loading=false;
    renderPublicDisplay=async function(){if(loading)return;loading=true;try{
      const [queue,settings,intake]=await Promise.all([request('/public-queue'),request('/settings'),request('/walk-in-capacity').catch(()=>null)]);
      cache(queue);cache(settings);window.UniServeWalkInCapacity=intake;original();renderLandingLive();
    }catch(_){window.UniServeWalkInCapacity=null;const el=document.getElementById('publicDisplayContent');if(el)el.innerHTML='<div class="card card-pad">Live queue unavailable. Reconnecting…</div>';}finally{loading=false;}};
    Promise.all([request('/public-queue'),request('/walk-in-capacity').catch(()=>null)]).then(([queue,intake])=>{cache(queue);window.UniServeWalkInCapacity=intake;renderLandingLive();}).catch(()=>{});
  }
})();
