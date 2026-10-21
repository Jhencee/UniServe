/* Opt-in browser alerts for authorized realtime updates while the portal is open. */
(function () {
  const supported = globalThis.isSecureContext && 'Notification' in window;
  const key = 'uniserve:browser-alerts';
  let enabled = false, registration, lastAlert = 0;
  try { enabled = localStorage.getItem(key) === 'on'; } catch (_) {}
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'icon-btn browser-alert-toggle';
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  status.className = 'browser-alert-status';
  function render() {
    const active = enabled && supported && Notification.permission === 'granted';
    const label = active ? 'Turn off visit and chat notifications' : 'Turn on visit and chat notifications';
    button.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>' + (active ? '<circle cx="19" cy="5" r="3" fill="currentColor" stroke="none"/>' : '') + '</svg>';
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(active));
    button.disabled = !supported;
    button.title = supported ? (active ? 'Notifications are on. Click to turn them off.' : 'Notifications are off. Click to get visit and chat updates.') : 'Notifications are unavailable. Open UniServe using HTTPS in a supported browser.';
    if (!supported) status.textContent = 'Notifications are unavailable here. Open UniServe using HTTPS in a supported browser.';
  }
  async function worker() {
    if (!('serviceWorker' in navigator)) return null;
    if (!registration) registration = navigator.serviceWorker.register(new URL('notification-worker.js', scriptUrl)).then(async reg => {
      if (reg.active) return reg;
      const installing = reg.installing || reg.waiting;
      if (!installing) throw Error('Notification worker unavailable');
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Error('Notification worker timed out')), 10000);
        installing.addEventListener('statechange', () => {
          if (installing.state === 'activated') { clearTimeout(timer); resolve(); }
          if (installing.state === 'redundant') { clearTimeout(timer); reject(Error('Notification worker unavailable')); }
        });
      });
      return reg;
    }).catch(() => null);
    return registration;
  }
  const scriptUrl = document.currentScript.src;
  async function show(body, tag) {
    const options = { body, tag, data: { url: location.href } };
    const reg = await worker();
    if (reg) return reg.showNotification('UniServe', options);
    const alert = new Notification('UniServe', options);
    alert.onclick = () => { window.focus(); alert.close(); };
    setTimeout(() => alert.close(), 15000);
  }
  button.addEventListener('click', async () => {
    if (enabled && Notification.permission === 'granted') {
      enabled = false;
      status.textContent = 'Notifications off. Tap the bell to turn them on.';
    } else {
      try {
        const permission = await Notification.requestPermission();
        enabled = permission === 'granted';
        status.textContent = enabled ? 'Notifications on. Keep UniServe open for visit and chat updates.' : permission === 'denied' ? 'Notifications are blocked. In your browser, open this site’s permissions and allow Notifications. Then tap the bell again.' : 'Notifications are still off. Tap the bell and choose Allow to receive visit and chat updates.';
        if (enabled) await show('Notifications on. Keep UniServe open for visit and chat updates.', 'uniserve-enabled');
      } catch (_) { enabled = false; status.textContent = 'Notifications could not be turned on. Try again, or check this site’s notification permissions in your browser.'; }
    }
    try { localStorage.setItem(key, enabled ? 'on' : 'off'); } catch (_) {}
    render();
    if (typeof window.toast === 'function') window.toast(status.textContent);
  });
  window.addEventListener('uniserve:browser-update', event => {
    if (!enabled || !supported || Notification.permission !== 'granted' || document.visibilityState !== 'hidden') return;
    const resource = event.detail?.resource;
    if (!['chats', 'queue', 'visits', 'appointments'].includes(resource) || Date.now() - lastAlert < 5000) return;
    lastAlert = Date.now();
    show(resource === 'chats' ? 'Your conversation has an update. Open UniServe to review it.' : 'There is a portal update. Open UniServe to review it.', 'uniserve-update').catch(() => {});
  });
  window.addEventListener('uniserve:near-turn',event=>{
    const data=event.detail;if(!data?.id)return;
    const body=data.ahead===0?'You are next in the waiting queue. Stay near OSS.':'Your turn is near. Only '+data.ahead+' people are ahead of you. Stay near OSS.';
    if(document.visibilityState==='visible'&&typeof window.toast==='function')window.toast(body,'ok');
    if(enabled&&supported&&Notification.permission==='granted')show(body,'uniserve-near-turn-'+data.id).catch(()=>{});
  });
  const intakeEvents = new Set();
  window.addEventListener('uniserve:intake-notification', event => {
    const data = event.detail;
    if (!data?.id || intakeEvents.has(data.id)) return;
    intakeEvents.add(data.id);
    if (intakeEvents.size > 100) intakeEvents.delete(intakeEvents.values().next().value);
    const message = data.mode === 'closed' ? `Head Admin closed walk-in intake${data.time ? ' at ' + data.time + '' : ''}.`
      : data.mode === 'scheduled' ? `Head Admin scheduled walk-in cutoff for ${data.time}.`
      : data.mode === 'extra' ? 'Head Admin allowed extra walk-ins today.' : 'Head Admin restored automatic walk-in cutoff.';
    const body = message;
    if (document.visibilityState === 'visible' && typeof window.toast === 'function') {
      const safe = window.UniServeUX?.escape || (value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])));
      window.toast(safe(body), 'ok');
    }
    if (document.visibilityState === 'hidden' && enabled && supported && Notification.permission === 'granted') {
      show(body, 'uniserve-intake-' + data.id).catch(() => {});
    }
  });
  const container = document.querySelector('.topbar-right');
  if (container) container.append(button, status);
  render();
})();
