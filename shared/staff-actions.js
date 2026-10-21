/* Header settings share one keyboard-accessible disclosure. */
(() => {
  const themes = document.querySelector('.topbar-right .theme-toggle');
  if (!themes) return;
  const menu = document.createElement('details');
  menu.className = 'admin-actions';
  menu.innerHTML = '<summary aria-label="More options" title="More options"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg></summary><div class="admin-actions-panel"></div>';
  const panel = menu.querySelector('.admin-actions-panel');
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-label', 'Dark mode');
  toggle.innerHTML = themes.querySelector('[data-theme-btn="dark"]').innerHTML + '<span>Dark mode</span><span class="admin-theme-state" aria-hidden="true"></span>';
  const sync = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    toggle.setAttribute('aria-checked', String(dark));
    toggle.querySelector('.admin-theme-state').textContent = dark ? 'On' : 'Off';
  };
  toggle.addEventListener('click', () => { setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); sync(); });
  panel.append(toggle);
  themes.replaceWith(menu);
  const alerts = document.querySelector('.browser-alert-toggle');
  const status = document.querySelector('.browser-alert-status');
  if (alerts) panel.append(alerts);
  if (status) panel.append(status);
  new MutationObserver(sync).observe(document.documentElement, { attributes:true, attributeFilter:['data-theme'] });
  sync();
  document.addEventListener('click', event => { if (!menu.contains(event.target)) menu.open = false; });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary').focus(); }
  });
})();
