// Mobile browsers request a desktop user agent when Desktop site is enabled.
// Give that mode a full desktop canvas and let the browser scale it to the phone.
(function () {
  const viewport = document.querySelector('meta[name="viewport"]');
  const touchDevice = navigator.maxTouchPoints > 0;
  const mobileAgent = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (viewport && touchDevice && !mobileAgent && window.innerWidth >= 900) {
    viewport.setAttribute('content', 'width=1440');
    document.documentElement.dataset.desktopSite = 'true';
  }
})();
