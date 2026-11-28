/* Group the active theme and notification controls in the staff header. */
(() => {
  const themes = document.querySelector('.topbar-right .theme-toggle');
  if (!themes) return;
  const panel = document.createElement('div');
  panel.className = 'admin-actions-panel';
  const controls = document.createElement('div');
  controls.className = 'admin-header-controls';
  themes.replaceWith(controls);
  controls.append(themes);
  if (typeof window.refreshSidebarNotificationCount === 'function') {
    const inbox = document.createElement('button');
    inbox.type = 'button';
    inbox.className = 'icon-btn staff-notification-button';
    inbox.setAttribute('aria-label', 'Notifications');
    inbox.title = 'Notifications';
    inbox.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>'+'<span class="staff-notification-count" hidden>0</span>';
    controls.append(inbox);
    const popup=document.createElement('section');popup.className='staff-notification-popover';popup.hidden=true;popup.setAttribute('aria-label','Notifications');controls.append(popup);
    inbox.setAttribute('aria-expanded','false');
    function close(){popup.hidden=true;inbox.setAttribute('aria-expanded','false');}
    function draw(){
      const prefs=notificationPreferences(),items=staffNotificationItems().filter(n=>{const p=notificationPreference(n,prefs);return !p.deleted&&!p.archived;});
      popup.innerHTML='<div class="staff-popover-head"><strong>Notifications</strong><button type="button" data-mark-all>Mark all as read</button></div><div class="staff-popover-list"></div><button type="button" class="staff-popover-all">See all notifications</button>';
      const list=popup.querySelector('.staff-popover-list');
      if(!items.length)list.innerHTML='<p class="staff-popover-empty">No notifications.</p>';
      items.slice(0,8).forEach(n=>{const row=document.createElement('button'),pref=notificationPreference(n,prefs);row.type='button';row.className='staff-popover-item';row.dataset.unread=String(!pref.read);const title=document.createElement('strong'),detail=document.createElement('span');title.textContent=n.title;detail.textContent=n.detail||'';row.append(title,detail);row.onclick=()=>{const key=notificationPreferenceKey(n);prefs[key]={...prefs[key],read:true};localStorage.setItem('uniserve-notifications:'+currentUser.id,JSON.stringify(prefs));refreshSidebarNotificationCount();close();if(n.kind==='important')openImportantNotification(n.id);else if(n.kind==='approval')openApprovedAccessRequest(n.id);else if(n.kind==='document')openPendingDocuments();else if(n.kind==='case')openTxnDetail(n.id);else if(n.kind==='delivery')openTxnDetail(n.targetId||n.id);else if(n.category==='followups')openAppointmentFollowUps(n.id);else openApptDetail(n.id,true);};list.append(row);});
      popup.querySelector('[data-mark-all]').onclick=()=>{items.forEach(n=>{const key=notificationPreferenceKey(n);prefs[key]={...prefs[key],read:true};});localStorage.setItem('uniserve-notifications:'+currentUser.id,JSON.stringify(prefs));refreshSidebarNotificationCount();draw();};
      popup.querySelector('.staff-popover-all').onclick=()=>{close();navigate('notifications');};
    }
    inbox.onclick=()=>{if(!popup.hidden){close();return;}draw();popup.hidden=false;inbox.setAttribute('aria-expanded','true');};
    window.refreshStaffNotificationPopover=()=>{if(!popup.hidden)draw();};
    document.addEventListener('click',event=>{if(!popup.hidden&&!controls.contains(event.target))close();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!popup.hidden){close();inbox.focus();}});
    window.addEventListener('uniserve:changed',()=>{if(!popup.hidden)draw();});
    if (typeof window.refreshSidebarNotificationCount === 'function') window.refreshSidebarNotificationCount();
  }
  controls.append(panel);
})();
