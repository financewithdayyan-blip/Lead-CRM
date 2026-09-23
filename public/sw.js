// Push notification service worker — registered at scope '/crm/' only
// (see usePushNotifications.ts), not the origin default, since this origin
// also serves the public marketing site from the same deployment.
//
// No fetch handler and nothing cached here, so there's no reason for a new
// version to wait behind an old one still controlling open tabs — skip
// straight to activating and taking control. Without this, a tab open from
// before a sw.js update sits on the old worker until closed/reopened, and
// pushManager.subscribe() fails with "no active Service Worker" in the
// meantime since the newly-registered worker never leaves "waiting".
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Bluebird CRM', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Bluebird CRM';
  const options = {
    body: data.body || '',
    icon: '/logo-mark.svg',
    badge: '/logo-mark.svg',
    data: { url: data.url || '/crm/notifications' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/crm/notifications';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(targetUrl) && 'focus' in client) return client.focus();
      }
      // No matching window open — focus any CRM window if one exists,
      // otherwise open a fresh one at the target.
      for (const client of clients) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) return client.navigate(targetUrl);
        }
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
