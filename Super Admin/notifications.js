/* System review notifications: server evidence in memory, read IDs only in this tab. */
function superNotificationItems(data) {
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date(data.checkedAt));
  const alerts=oversightAlerts(data);
  if(data.configuration.maintenance)alerts.push({title:'Maintenance is active',note:'New visits are temporarily unavailable. Review System Settings before reopening intake.',page:'settings',action:'Review settings'});
  return alerts.map(a=>{
    let hash=2166136261;
    for(const char of a.page+':'+a.title)hash=Math.imul(hash^char.charCodeAt(0),16777619);
    return {...a,id:day+':'+(hash>>>0).toString(16)};
  });
}
(function(){
  if(typeof currentUser==='undefined'||currentUser.role!=='SUPER_ADMIN')return;
  const host=document.querySelector('.admin-header-controls');if(!host)return;
  const seenKey='super-notifications-seen:'+currentUser.id,archiveKey='super-notifications-archived:'+currentUser.id;
  let seen=new Set(),archived=new Set(),items=[],busy=false,loaded=false,unavailable=false,ended=false,category='all',status='all';
  try{seen=new Set(JSON.parse(sessionStorage.getItem(seenKey)||'[]'));archived=new Set(JSON.parse(sessionStorage.getItem(archiveKey)||'[]'));}catch(_){}
  const tabs=[['all','All'],['security','Security'],['backups','Backups'],['accounts','Accounts'],['system','System']];
  const categoryFor=item=>({activitylog:'security',backup:'backups',users:'accounts'})[item.page]||'system';
  const matchesStatus=item=>status==='archived'?archived.has(item.id):!archived.has(item.id)&&(status==='all'||(status==='read'?seen.has(item.id):!seen.has(item.id)));
  const bell=document.createElement('button');bell.type='button';bell.className='icon-btn staff-notification-button';bell.title='Notifications';
  bell.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span class="staff-notification-count" hidden>0</span>';
  host.insertBefore(bell,host.querySelector('.admin-actions-panel'));
  function save(){try{sessionStorage.setItem(seenKey,JSON.stringify([...seen].slice(-500)));sessionStorage.setItem(archiveKey,JSON.stringify([...archived].slice(-500)));}catch(_){}paint();}
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
    feed.innerHTML=filtered.map(item=>'<article class="notification-entry" data-read="'+seen.has(item.id)+'"><div class="notification-entry-copy"><small class="notification-entry-label">'+tabs.find(t=>t[0]===categoryFor(item))[1]+' &middot; '+(seen.has(item.id)?'Read':'Unread')+'</small><p>'+escapeHtml(item.title)+'</p><span>'+escapeHtml(item.note)+'</span></div><div class="notification-entry-controls"><button type="button" class="notification-entry-action" data-super-notification="'+escapeHtml(item.id)+'">'+escapeHtml(item.action)+'</button><div class="notification-state-actions"><button type="button" data-state-id="'+escapeHtml(item.id)+'" data-state-action="read">Mark as '+(seen.has(item.id)?'unread':'read')+'</button><button type="button" data-state-id="'+escapeHtml(item.id)+'" data-state-action="archive">'+(archived.has(item.id)?'Restore':'Archive')+'</button></div></div></article>').join('')||'<p class="notification-empty" role="status">No notifications in this view.</p>';
    feed.querySelectorAll('[data-super-notification]').forEach(button=>button.addEventListener('click',()=>{const item=items.find(n=>n.id===button.dataset.superNotification);if(!item)return;seen.add(item.id);save();navigate(item.page);}));
    feed.querySelectorAll('[data-state-id]').forEach(button=>button.addEventListener('click',()=>{const set=button.dataset.stateAction==='read'?seen:archived;const id=button.dataset.stateId;set.has(id)?set.delete(id):set.add(id);save();}));
  }
  function paint(){
    const count=items.filter(item=>!seen.has(item.id)&&!archived.has(item.id)).length;
    const badge=bell.querySelector('.staff-notification-count');badge.textContent=count>99?'99+':String(count);badge.hidden=!count;
    const sidebar=document.querySelector('#sidebarNotifications .notification-bell-count');if(sidebar){sidebar.textContent=count>99?'99+':String(count);sidebar.hidden=!count;}
    bell.setAttribute('aria-label',unavailable?'Notifications unavailable':count?'Notifications, '+count+' unread':'Notifications, no unread updates');drawFeed();
  }
  async function refresh(){
    if(busy||ended||document.visibilityState==='hidden')return;busy=true;
    try{const data=await getSystemOversight();if(ended)return;items=superNotificationItems(data);loaded=true;unavailable=false;}
    catch(_){items=[];unavailable=true;}finally{busy=false;if(!ended)paint();}
  }
  window.renderSuperNotifications=function(){
    document.getElementById('content').innerHTML='<section class="notifications-page" aria-label="Notifications"><div class="notification-status-filter"><label for="superNotificationStatus">Show</label><select id="superNotificationStatus"><option value="all">All active</option><option value="unread">Unread</option><option value="read">Read</option><option value="archived">Archived</option></select></div><div class="notification-tabs" role="tablist" aria-label="Notification categories">'+tabs.map(([key,label])=>'<button type="button" class="notification-tab" id="super-notification-tab-'+key+'" role="tab" aria-controls="superNotificationFeed" data-category="'+key+'">'+label+' <span class="notification-tab-count">0</span></button>').join('')+'</div><div class="notifications-page-feed" id="superNotificationFeed" role="tabpanel"></div></section>';
    const select=document.getElementById('superNotificationStatus');select.value=status;select.addEventListener('change',()=>{status=select.value;paint();});
    const buttons=[...document.querySelectorAll('.notification-tab')];buttons.forEach((button,index)=>{
      button.addEventListener('click',()=>{category=button.dataset.category;paint();});
      button.addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight')next=(index+1)%buttons.length;else if(event.key==='ArrowLeft')next=(index+buttons.length-1)%buttons.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=buttons.length-1;else return;event.preventDefault();buttons[next].click();buttons[next].focus();});
    });paint();refresh();
  };
  window.refreshSuperNotificationBadge=paint;
  bell.addEventListener('click',()=>navigate('notifications'));
  paint();refresh();const interval=setInterval(refresh,60000);
  window.addEventListener('uniserve:changed',refresh);document.addEventListener('visibilitychange',refresh);
  window.addEventListener('uniserve:session-ended',()=>{ended=true;items=[];clearInterval(interval);});
})();
