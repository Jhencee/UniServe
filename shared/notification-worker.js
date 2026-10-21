// Notification delivery only: no caching, fetch interception, or background push.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = new URL(event.notification.data?.url || '/', self.location.origin);
    if (url.origin !== self.location.origin) return;
    const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const tab = tabs.find(client => client.url === url.href);
    if (tab) return tab.focus();
    return self.clients.openWindow(url.href);
  })());
});
