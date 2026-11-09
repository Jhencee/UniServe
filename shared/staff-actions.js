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
    inbox.onclick = () => navigate('notifications');
    controls.append(inbox);
    window.refreshSidebarNotificationCount();
    const syncCount = () => {
      const sidebarBadge=document.querySelector('#sidebarNotifications .notification-bell-count');
      const count=Math.max(0,Number(sidebarBadge?.textContent)||0);
      const badge=inbox.querySelector('.staff-notification-count');
      badge.textContent=count>99?'99+':String(count);
      badge.hidden=count===0;
      inbox.setAttribute('aria-label',count?'Notifications, '+count+' unread':'Notifications, no unread updates');
    };
    syncCount();
    const navigation=document.getElementById('navList');
    if(navigation)new MutationObserver(syncCount).observe(navigation,{childList:true,subtree:true,characterData:true});
  }
  controls.append(panel);
})();
