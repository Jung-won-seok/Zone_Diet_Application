// No application pages, authenticated responses or personal data are cached by this worker.
self.addEventListener('push', event => {
  event.waitUntil(showBookingPromotion());
});

async function showBookingPromotion() {
  let body = '새 예약 알림이 있어요. 앱에서 확인해주세요.';
  let route = '/#reservations';
  let tag = 'leben-reservations';
  try {
    const sub = await self.registration.pushManager.getSubscription();
    if (sub) {
      const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sub.endpoint));
      const id = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      const result = await fetch('/api/notifications?device=' + id, {
        credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(3000)
      });
      if (result.ok) {
        const data = await result.json();
        const item = data.registered && data.latest;
        if (item && /^\d{4}-\d{2}-\d{2}$/.test(item.date) && /^\d{2}:\d{2}$/.test(item.startTime)) {
          body = item.date + ' ' + item.startTime + ' 수업 예약이 확정됐어요.';
          route += '/' + item.date;
          tag = 'leben-promotion-' + item.id;
        }
      }
    }
  } catch { /* The current session may have expired or the device may be offline. */ }
  await self.registration.showNotification('크로스핏 레벤', { body, tag, data: { route }, icon: '/leben-192.png' });
  for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
    client.postMessage({ type: 'booking-promotion' });
  }
}

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const route = event.notification.data?.route;
  const safeRoute = /^\/#reservations(?:\/\d{4}-\d{2}-\d{2})?$/.test(route) ? route : '/#reservations';
  event.waitUntil(self.clients.openWindow(new URL(safeRoute, self.location.origin).href));
});
