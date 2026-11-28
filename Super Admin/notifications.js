/* System review notifications: server evidence in memory, read IDs only in this tab. */
function superNotificationItems(data) {
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date(data.checkedAt));
  const alerts=oversightAlerts(data);
  if(data.configuration.maintenance)alerts.push({title:'Maintenance is active',note:'New visits are temporarily unavailable. Review System Settings before reopening intake.',page:'settings',action:'Review settings'});
  return alerts.map(a=>{
    let hash=2166136261;
    for(const char of a.page+':'+a.title)hash=Math.imul(hash^char.charCodeAt(0),16777619);
    const auditContext=a.auditReview?{kind:a.auditReview,title:a.title,to:data.checkedAt,from:a.auditReview==='failed'?new Date(new Date(data.checkedAt).getTime()-86400000).toISOString():null}:null;
    return {...a,auditContext,id:day+':'+(hash>>>0).toString(16)};
  });
}
(function(){
  if(typeof currentUser==='undefined'||currentUser.role!=='SUPER_ADMIN')return;
  const host=document.querySelector('.admin-header-controls');if(!host)return;
  const seenKey='super-notifications-seen:'+currentUser.id,archiveKey='super-notifications-archived:'+currentUser.id,deletedKey='super-notifications-deleted:'+currentUser.id;
  let seen=new Set(),archived=new Set(),deleted=new Set(),selected=new Set(),items=[],busy=false,loaded=false,unavailable=false,ended=false,category='all',status='all',selectionMode=false;
  try{seen=new Set(JSON.parse(sessionStorage.getItem(seenKey)||'[]'));archived=new Set(JSON.parse(sessionStorage.getItem(archiveKey)||'[]'));deleted=new Set(JSON.parse(sessionStorage.getItem(deletedKey)||'[]'));}catch(_){}
  const tabs=[['all','All'],['requests','Requests'],['security','Security'],['backups','Backups'],['accounts','Accounts'],['system','System']];
  const categoryFor=item=>item.category||({activitylog:'security',backup:'backups',users:'accounts'})[item.page]||'system';
  const matchesStatus=item=>!deleted.has(item.id)&&(status==='archived'?archived.has(item.id):!archived.has(item.id)&&(status==='all'||(status==='read'?seen.has(item.id):!seen.has(item.id))));
  const bell=document.createElement('button');bell.type='button';bell.className='icon-btn staff-notification-button';bell.title='Notifications';
  bell.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span class="staff-notification-count" hidden>0</span>';
  host.insertBefore(bell,host.querySelector('.admin-actions-panel'));
  const popup=document.createElement('section');popup.className='staff-notification-popover';popup.hidden=true;popup.setAttribute('aria-label','Notifications');host.append(popup);bell.setAttribute('aria-expanded','false');
  function closePopup(){popup.hidden=true;bell.setAttribute('aria-expanded','false');}
  function drawPopup(){
    if(popup.hidden)return;
    const visible=items.filter(item=>!deleted.has(item.id)&&!archived.has(item.id));
    popup.innerHTML='<div class="staff-popover-head"><strong>Notifications</strong><button type="button" data-mark-all>Mark all as read</button></div><div class="staff-popover-list"></div><button type="button" class="staff-popover-all">See all notifications</button>';
    const list=popup.querySelector('.staff-popover-list');
    if(unavailable)list.innerHTML='<p class="staff-popover-empty">Notifications could not be loaded.</p>';else if(!loaded)list.innerHTML='<p class="staff-popover-empty">Checking notifications...</p>';else if(!visible.length)list.innerHTML='<p class="staff-popover-empty">No notifications.</p>';
    visible.slice(0,8).forEach(item=>{const row=document.createElement('button'),title=document.createElement('strong'),detail=document.createElement('span');row.type='button';row.className='staff-popover-item';row.dataset.unread=String(!seen.has(item.id));title.textContent=item.title;detail.textContent=item.note||'';row.append(title,detail);row.onclick=()=>{seen.add(item.id);save();closePopup();if(item.kind==='confidential-access'){openConfidentialRequests();return;}if(item.page==='activitylog')window.centralAuditReview=item.auditContext?{...item.auditContext,locate:true,scroll:true}:null;navigate(item.page);};list.append(row);});
    popup.querySelector('[data-mark-all]').onclick=()=>{visible.forEach(item=>seen.add(item.id));save();};popup.querySelector('.staff-popover-all').onclick=()=>{closePopup();navigate('notifications');};
  }
  function save(){try{sessionStorage.setItem(seenKey,JSON.stringify([...seen].slice(-500)));sessionStorage.setItem(archiveKey,JSON.stringify([...archived].slice(-500)));sessionStorage.setItem(deletedKey,JSON.stringify([...deleted].slice(-500)));}catch(_){}paint();}
  function syncSelection(){
    const feed=document.getElementById('superNotificationFeed'),toolbar=feed?.querySelector('.notification-bulk-toolbar'),page=toolbar?.closest('.notifications-page');if(!toolbar)return;
    const rows=[...feed.querySelectorAll('.notification-entry:not([hidden])')],count=rows.filter(row=>selected.has(row.dataset.notificationId)).length;
    selectionMode=count>0;
    page.classList.toggle('is-selecting',selectionMode);
    const all=toolbar.querySelector('.notification-select-all');if(all){all.checked=rows.length>0&&count===rows.length;all.indeterminate=count>0&&count<rows.length;}
    toolbar.querySelector('.notification-selected-count').textContent=count+' selected';
    toolbar.querySelector('.notification-select-all-label').hidden=!selectionMode;
    toolbar.querySelector('.notification-selected-count').hidden=!selectionMode;
    page.querySelector('.notification-bulk-action').hidden=!selectionMode;
    toolbar.hidden=!rows.length||!selectionMode;
  }
  function applyBulkAction(){
    const page=document.querySelector('#superNotificationFeed')?.closest('.notifications-page'),action=page?.querySelector('.notification-bulk-action')?.value,ids=[...selected];if(!action||!ids.length)return;
    if(action==='delete'&&!window.confirm('Delete '+ids.length+' selected notification'+(ids.length===1?'':'s')+' from your notification list?'))return;
    ids.forEach(id=>{if(action==='read')seen.add(id);else if(action==='unread')seen.delete(id);else if(action==='archive')archived.add(id);else if(action==='restore')archived.delete(id);else if(action==='delete')deleted.add(id);});
    selected.clear();selectionMode=false;save();
  }
  function drawFeed(){
    const feed=document.getElementById('superNotificationFeed');if(!feed||state_view!=='notifications')return;
    document.querySelectorAll('.notification-tab').forEach(tab=>{
      const key=tab.dataset.category;tab.setAttribute('aria-selected',String(key===category));tab.tabIndex=key===category?0:-1;
      tab.querySelector('.notification-tab-count').textContent=String(items.filter(item=>matchesStatus(item)&&(key==='all'||categoryFor(item)===key)).length);
    });
    feed.setAttribute('aria-labelledby','super-notification-tab-'+category);
    if(unavailable){feed.innerHTML='<p class="notification-empty" role="status">Notifications could not be loaded. Check your connection and try again.</p>';return;}
    if(!loaded){feed.innerHTML='<p class="notification-empty" role="status">Checking system updates...</p>';return;}
    const filtered=items.filter(item=>matchesStatus(item)&&(category==='all'||categoryFor(item)===category));
    feed.innerHTML='<div class="notification-bulk-toolbar"><label class="notification-select-all-label" hidden><input class="notification-select-all" type="checkbox" aria-label="Select all visible notifications"> Select all visible</label><span class="notification-selected-count" hidden>0 selected</span><select class="notification-bulk-action" aria-label="Action for selected notifications" hidden><option value="">Choose action</option><option value="read">Mark read</option><option value="unread">Mark unread</option><option value="archive">Archive</option><option value="restore">Restore</option><option value="delete">Delete</option></select></div>'+((filtered.map(item=>'<article class="notification-entry" data-notification-id="'+escapeHtml(item.id)+'" data-read="'+seen.has(item.id)+'"><label class="notification-select-control"><input class="notification-select" type="checkbox" aria-label="Select notification: '+escapeHtml(item.title)+'" '+(selected.has(item.id)?'checked':'')+'></label><div class="notification-entry-copy"><small class="notification-entry-label">'+tabs.find(t=>t[0]===categoryFor(item))[1]+' &middot; '+(seen.has(item.id)?'Read':'Unread')+'</small><p>'+escapeHtml(item.title)+'</p><span>'+escapeHtml(item.note)+'</span></div><div class="notification-entry-controls"><button type="button" class="notification-entry-action" data-super-notification="'+escapeHtml(item.id)+'">'+escapeHtml(item.action)+'</button><div class="notification-state-actions"><button type="button" data-state-id="'+escapeHtml(item.id)+'" data-state-action="read">Mark as '+(seen.has(item.id)?'unread':'read')+'</button><button type="button" data-state-id="'+escapeHtml(item.id)+'" data-state-action="archive">'+(archived.has(item.id)?'Restore':'Archive')+'</button></div></div></article>').join(''))||'<p class="notification-empty" role="status">No notifications in this view.</p>');
    feed.querySelectorAll('[data-super-notification]').forEach(button=>button.addEventListener('click',()=>{const item=items.find(n=>n.id===button.dataset.superNotification);if(!item)return;seen.add(item.id);save();if(item.kind==='confidential-access'){openConfidentialRequests();return;}if(item.page==='activitylog')window.centralAuditReview=item.auditContext?{...item.auditContext,locate:true,scroll:true}:null;navigate(item.page);}));
    feed.querySelectorAll('[data-state-id]').forEach(button=>button.addEventListener('click',()=>{const set=button.dataset.stateAction==='read'?seen:archived;const id=button.dataset.stateId;set.has(id)?set.delete(id):set.add(id);selected.clear();save();}));
    feed.querySelectorAll('.notification-select').forEach(input=>input.addEventListener('change',()=>{const id=input.closest('.notification-entry').dataset.notificationId;input.checked?selected.add(id):selected.delete(id);syncSelection();}));
    const all=feed.querySelector('.notification-select-all');all?.addEventListener('change',()=>{feed.querySelectorAll('.notification-entry:not([hidden])').forEach(row=>{const input=row.querySelector('.notification-select');input.checked=all.checked;all.checked?selected.add(row.dataset.notificationId):selected.delete(row.dataset.notificationId);});syncSelection();});
    const action=feed.querySelector('.notification-bulk-action')||document.querySelector('.notification-status-filter .notification-bulk-action');action?.addEventListener('change',()=>{if(action.value)applyBulkAction();else syncSelection();});
    syncSelection();
  }
  function paint(){
    const count=items.filter(item=>!deleted.has(item.id)&&!seen.has(item.id)&&!archived.has(item.id)).length;
    const badge=bell.querySelector('.staff-notification-count');badge.textContent=count>99?'99+':String(count);badge.hidden=!count;
    const sidebar=document.querySelector('#sidebarNotifications .notification-bell-count');if(sidebar){sidebar.textContent=count>99?'99+':String(count);sidebar.hidden=!count;}
    bell.setAttribute('aria-label',unavailable?'Notifications unavailable':count?'Notifications, '+count+' unread':'Notifications, no unread updates');drawFeed();drawPopup();
  }
  async function refresh(){
    if(busy||ended||document.visibilityState==='hidden')return;busy=true;
    try{const [data,access]=await Promise.all([getSystemOversight(),UniServeUX.request('/confidential/notifications')]);if(ended)return;items=superNotificationItems(data);items.push(...(access.requests||[]).map(request=>({id:'confidential-access:'+request.id,title:'Confidential access requested',note:request.requester_name+' · '+request.code+' · '+(request.scope==='print'?'View and Print':'View'),page:'users',category:'requests',action:'Review request',kind:'confidential-access'})));loaded=true;unavailable=false;}
    catch(_){items=[];unavailable=true;}finally{busy=false;if(!ended)paint();}
  }
  window.renderSuperNotifications=function(){
    document.getElementById('content').innerHTML='<section class="notifications-page" aria-label="Notifications"><div class="notification-status-filter"><label for="superNotificationStatus">Show</label><select id="superNotificationStatus"><option value="all">All active</option><option value="unread">Unread</option><option value="read">Read</option><option value="archived">Archived</option></select></div><div class="notification-tabs" role="tablist" aria-label="Notification categories">'+tabs.map(([key,label])=>'<button type="button" class="notification-tab" id="super-notification-tab-'+key+'" role="tab" aria-controls="superNotificationFeed" data-category="'+key+'">'+label+' <span class="notification-tab-count">0</span></button>').join('')+'</div><div class="notifications-page-feed" id="superNotificationFeed" role="tabpanel"></div></section>';
    const select=document.getElementById('superNotificationStatus');select.value=status;select.addEventListener('change',()=>{status=select.value;selected.clear();paint();});
    const buttons=[...document.querySelectorAll('.notification-tab')];buttons.forEach((button,index)=>{
      button.addEventListener('click',()=>{category=button.dataset.category;selected.clear();paint();});
      button.addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight')next=(index+1)%buttons.length;else if(event.key==='ArrowLeft')next=(index+buttons.length-1)%buttons.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=buttons.length-1;else return;event.preventDefault();buttons[next].click();buttons[next].focus();});
    });paint();refresh();
  };
  window.refreshSuperNotificationBadge=paint;
  bell.addEventListener('click',()=>{if(!popup.hidden){closePopup();return;}popup.hidden=false;bell.setAttribute('aria-expanded','true');drawPopup();refresh();});
  document.addEventListener('click',event=>{if(!popup.hidden&&!host.contains(event.target))closePopup();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!popup.hidden){closePopup();bell.focus();}});
  paint();refresh();const interval=setInterval(refresh,60000);
  window.addEventListener('uniserve:changed',refresh);document.addEventListener('visibilitychange',refresh);
  window.addEventListener('uniserve:session-ended',()=>{ended=true;items=[];clearInterval(interval);});
})();
