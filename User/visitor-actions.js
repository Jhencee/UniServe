/* Keep existing settings handlers while presenting them in one disclosure. */
(() => {
  const menu = document.getElementById('visitorActions');
  if (!menu) return;
  const panel = menu.querySelector('.visitor-actions-panel');
  const alerts = document.querySelector('.browser-alert-toggle');
  const status = document.querySelector('.browser-alert-status');
  if (alerts) panel.append(alerts);
  if (status) panel.append(status);
  const theme = document.getElementById('visitorThemeToggle');
  const syncTheme = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    theme.setAttribute('aria-checked', String(dark));
    theme.querySelector('.visitor-theme-state').textContent = dark ? 'On' : 'Off';
  };
  theme.addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    syncTheme();
  });
  new MutationObserver(syncTheme).observe(document.documentElement, { attributes:true, attributeFilter:['data-theme'] });
  syncTheme();
  document.addEventListener('click', event => {
    if (!menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) {
      menu.open = false;
      menu.querySelector('summary').focus();
    }
  });
  panel.addEventListener('click', event => {
    if (event.target.closest('#a11yBtn')) menu.open = false;
  });
})();
