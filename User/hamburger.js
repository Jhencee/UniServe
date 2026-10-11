/* Sidebar toggle. Load AFTER user.js and a11y.js. Does not modify existing code.
   Desktop: sidebar visible by default; the button in the sidebar header collapses it,
            the button in the top bar brings it back. State is remembered.
   Mobile:  sidebar is a slide-over drawer (uses the existing .open class). */
(function () {
  var shell = document.getElementById('visitorApp');
  var sb = document.getElementById('visitorSidebar');
  var menuBtn = document.querySelector('.menu-btn');
  var inBtn = document.getElementById('sbToggle');
  if (!shell || !sb) return;

  var KEY = 'oss_sidebar_collapsed';
  var mq = window.matchMedia('(max-width: 880px)');

  function isMobile() { return mq.matches; }
  function isOpen() { return isMobile() ? sb.classList.contains('open') : !shell.classList.contains('collapsed'); }

  function sync() {
    var open = isOpen();
    [menuBtn, inBtn].forEach(function (b) {
      if (!b) return;
      b.setAttribute('aria-expanded', String(open));
    });
    if (menuBtn) menuBtn.setAttribute('aria-label', 'Open menu');
    if (inBtn) inBtn.setAttribute('aria-label', open ? 'Collapse menu' : 'Expand menu');
  }

  window.toggleSidebarUI = function () {
    if (isMobile()) {
      sb.classList.toggle('open');
    } else {
      shell.classList.toggle('collapsed');
      try { localStorage.setItem(KEY, shell.classList.contains('collapsed') ? '1' : '0'); } catch (e) { /* ignore */ }
    }
    sync();
  };

  try { if (localStorage.getItem(KEY) === '1') shell.classList.add('collapsed'); } catch (e) { /* ignore */ }

  new MutationObserver(sync).observe(sb, { attributes: true, attributeFilter: ['class'] });
  if (mq.addEventListener) mq.addEventListener('change', sync);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && isMobile() && !document.getElementById('activeModal')) sb.classList.remove('open');
  });

  sync();
})();