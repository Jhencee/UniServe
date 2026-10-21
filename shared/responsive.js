(function () {
  const sidebar = document.querySelector('.app-shell .sidebar');
  if (!sidebar) return;
  const media = window.matchMedia('(max-width: 880px)');
  const backdrop = document.createElement('div');
  backdrop.className = 'mobile-drawer-backdrop';
  backdrop.hidden = true;
  backdrop.setAttribute('aria-hidden', 'true');
  document.body.appendChild(backdrop);
  const opener = document.querySelector('.menu-btn');
  function close() { sidebar.classList.remove('open'); opener?.focus(); }
  function sync() {
    const open = media.matches && sidebar.classList.contains('open');
    backdrop.hidden = !open;
    document.body.classList.toggle('mobile-menu-open', open);
    sidebar.inert = media.matches && !open;
    opener?.setAttribute('aria-expanded', String(open));
    if (sidebar.id) opener?.setAttribute('aria-controls', sidebar.id);
  }
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && media.matches && sidebar.classList.contains('open') && !document.getElementById('activeModal')) close();
    if (event.key !== 'Tab' || !media.matches || !sidebar.classList.contains('open') || document.getElementById('activeModal')) return;
    const controls=Array.from(sidebar.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),[tabindex="0"]')).filter(el=>el.offsetParent!==null);
    if(!controls.length)return;
    const first=controls[0],last=controls[controls.length-1];
    if(event.shiftKey && (document.activeElement===first || !sidebar.contains(document.activeElement))){event.preventDefault();last.focus();}
    else if(!event.shiftKey && (document.activeElement===last || !sidebar.contains(document.activeElement))){event.preventDefault();first.focus();}
  });
  media.addEventListener('change', () => { sidebar.classList.remove('open'); sync(); });
  new MutationObserver(sync).observe(sidebar, { attributes: true, attributeFilter: ['class'] });
  sync();
})();
