let bookingNotificationPage = null;

function cleanupBookingNotifications() {
  const page = bookingNotificationPage;
  if (!page) return;
  bookingNotificationPage = null;
  clearInterval(page.timer);
  page.controller.abort();
  document.removeEventListener('visibilitychange', page.onVisible);
  navigator.serviceWorker?.removeEventListener('message', page.onMessage);
}

function bookingPushSupport() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && !navigator.standalone && !window.matchMedia('(display-mode: standalone)').matches) {
    return '아이폰·아이패드는 공유 메뉴에서 ‘홈 화면에 추가’한 다음, 홈 화면의 레벤 앱에서 기기 알림을 켜주세요.';
  }
  if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return '이 브라우저에서는 아래 알림함에서 예약 확정을 확인할 수 있어요.';
  }
  return '';
}

function pushKeyBytes(key) {
  return Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/')), char => char.charCodeAt(0));
}

async function bookingDeviceId(endpoint) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function bookingNoticeActive(page) { return bookingNotificationPage === page && session?.id === page.userId; }

function paintBookingInbox(page) {
  if (!bookingNoticeActive(page)) return;
  const unread = page.items.filter(item => !item.read).length;
  page.host.querySelector('summary').textContent = unread ? '예약 알림 · 읽지 않음 ' + unread + '건' : '예약 알림';
  const list = page.host.querySelector('[data-notice-list]');
  const content = page.items.map(item =>
    '<li><a href="#reservations/' + encodeURIComponent(item.date) + '">' + escapeHTML(item.date) +
      ' ' + escapeHTML(item.startTime) + ' 수업 예약 확정</a>' + (item.read ? '' : ' · 읽지 않음') + '</li>').join('');
  if (page.lastContent !== content) { list.innerHTML = content; page.lastContent = content; }
  page.host.querySelector('[data-notice-empty]').hidden = !page.loaded || page.items.length > 0;
  const mark = page.host.querySelector('[data-mark-notices]');
  mark.hidden = !unread; mark.disabled = page.busy;
  const toggle = page.host.querySelector('[data-notice-toggle]');
  toggle.hidden = Boolean(page.unsupported);
  toggle.disabled = page.busy || !page.loaded;
  toggle.textContent = page.subscribed ? '이 기기 알림 끄기' : '이 기기 알림 켜기';
  page.host.querySelector('[data-notice-feedback]').textContent = page.message || page.unsupported;
}

async function refreshBookingInbox(page) {
  if (!bookingNoticeActive(page) || page.loading || page.busy || document.hidden) return;
  page.loading = true;
  try {
    const data = await api('/api/notifications', { signal: page.controller.signal });
    if (!bookingNoticeActive(page)) return;
    if (data.memberId !== page.userId) {
      cleanupBookingNotifications();
      page.items = [];
      page.lastContent = '';
      page.endpointId = null;
      page.subscribed = false;
      page.host.innerHTML = '<p role="alert">로그인한 계정이 바뀌었어요. 새로고침 후 예약 알림을 확인해주세요.</p>';
      return;
    }
    page.items = data.items;
    page.loaded = true;
    if (page.loadFailed) page.message = '';
    page.loadFailed = false;
    page.subscribed = Boolean(page.endpointId && data.devices.includes(page.endpointId));
  } catch (err) {
    if (bookingNoticeActive(page)) { page.loadFailed = true; page.message = err.message || '알림함을 불러오지 못했습니다.'; }
  } finally {
    page.loading = false;
    paintBookingInbox(page);
  }
}

async function getBookingRegistration() {
  const registration = await navigator.serviceWorker.register('/push-worker.js', { scope: '/' });
  return registration.active ? registration : navigator.serviceWorker.ready;
}

async function disableBookingPushOnLogout() {
  if (!('serviceWorker' in navigator)) return;
  const signedIn = session;
  const cleanup = async () => {
    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration || session !== signedIn) return;
    try { for (const notice of await registration.getNotifications()) notice.close(); } catch { /* Some browsers cannot enumerate notifications. */ }
    const sub = await registration?.pushManager?.getSubscription();
    if (!sub || session !== signedIn) return;
    // Stop delivery locally and remotely. Either can succeed when the other is unavailable.
    const operations = [sub.unsubscribe()];
    if (session && !session.isAdmin && !session.pendingApproval) {
      operations.push(api('/api/notifications/device', { method: 'DELETE', body: JSON.stringify({ endpoint: sub.endpoint }), signal: AbortSignal.timeout(3000) }));
    }
    await Promise.allSettled(operations);
  };
  let timer;
  try {
    await Promise.race([cleanup(), new Promise(resolve => { timer = setTimeout(resolve, 3000); })]);
  } catch { /* A failed push-provider cleanup must not prevent signing out. */ }
  finally { clearTimeout(timer); }
}

async function toggleBookingPush(page) {
  if (!bookingNoticeActive(page) || page.busy) return;
  page.busy = true;
  page.message = '';
  paintBookingInbox(page);
  try {
    if (page.subscribed) {
      const registration = await getBookingRegistration();
      const sub = await registration.pushManager.getSubscription();
      if (sub && bookingNoticeActive(page)) {
        await api('/api/notifications/device', { method: 'DELETE', body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      page.subscribed = false;
      page.endpointId = null;
      page.message = '기기 알림을 껐어요. 예약 알림은 알림함에서 확인할 수 있어요.';
    } else {
      // iOS requires the permission prompt to originate in this button's click.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('기기 알림을 받으려면 브라우저나 기기 설정에서 알림을 허용해주세요.');
      if (!bookingNoticeActive(page)) return;
      const registration = await getBookingRegistration();
      if (!bookingNoticeActive(page)) return;
      const data = await api('/api/notifications/push-key', { method: 'POST', body: '{}' });
      if (!bookingNoticeActive(page)) return;
      const key = pushKeyBytes(data.publicKey);
      let sub = await registration.pushManager.getSubscription();
      if (sub && String(new Uint8Array(sub.options.applicationServerKey)) !== String(key)) {
        await sub.unsubscribe(); sub = null;
      }
      if (!bookingNoticeActive(page)) return;
      sub = sub || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      if (!bookingNoticeActive(page)) return;
      await api('/api/notifications/device', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint, publicKey: data.publicKey }) });
      page.endpointId = await bookingDeviceId(sub.endpoint);
      page.subscribed = true;
      page.message = '대기하던 수업이 확정되면 이 기기로 알려드려요.';
    }
  } catch (err) {
    page.message = err.message || '기기 알림 설정에 실패했습니다. 다시 시도해주세요.';
  } finally {
    page.busy = false;
    paintBookingInbox(page);
  }
}

function mountBookingNotifications() {
  cleanupBookingNotifications();
  const host = document.getElementById('booking-notifications');
  if (!host || !session || session.isAdmin || session.pendingApproval) return;
  const page = { host, userId: session.id, items: [], loaded: false, busy: false, loading: false, subscribed: false,
    unsupported: bookingPushSupport(), controller: new AbortController(), message: '' };
  bookingNotificationPage = page;
  host.innerHTML = '<details class="booking-inbox"><summary>예약 알림</summary><div class="booking-inbox-content">' +
    '<p data-notice-empty hidden>아직 대기에서 확정된 수업이 없어요.</p><ul data-notice-list></ul>' +
    '<div class="booking-inbox-actions"><button class="booking-refresh" type="button" data-mark-notices hidden>모두 읽음</button>' +
    '<button class="booking-refresh" type="button" data-notice-toggle hidden>이 기기 알림 켜기</button></div>' +
    '<p data-notice-feedback role="status"></p></div></details>';
  host.querySelector('details').ontoggle = event => { if (event.target.open) refreshBookingInbox(page); };
  host.querySelector('[data-notice-toggle]').onclick = () => toggleBookingPush(page);
  host.querySelector('[data-mark-notices]').onclick = async () => {
    if (page.busy || !bookingNoticeActive(page)) return;
    const ids = page.items.filter(item => !item.read).map(item => item.id);
    page.busy = true; paintBookingInbox(page);
    try {
      await api('/api/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) });
      const marked = new Set(ids);
      page.items = page.items.map(item => marked.has(item.id) ? { ...item, read: true } : item);
      page.message = '';
    } catch (err) { page.message = err.message; }
    finally { page.busy = false; paintBookingInbox(page); }
  };
  page.onVisible = () => { if (!document.hidden) refreshBookingInbox(page); };
  page.onMessage = event => { if (event.data?.type === 'booking-promotion') refreshBookingInbox(page); };
  document.addEventListener('visibilitychange', page.onVisible);
  navigator.serviceWorker?.addEventListener('message', page.onMessage);
  page.timer = setInterval(() => refreshBookingInbox(page), 60000);
  paintBookingInbox(page);
  refreshBookingInbox(page);
  if (!page.unsupported) {
    getBookingRegistration().then(registration => registration.pushManager.getSubscription()).then(async sub => {
      if (!sub || !bookingNoticeActive(page)) return;
      const id = await bookingDeviceId(sub.endpoint);
      if (!bookingNoticeActive(page)) return;
      page.endpointId = id;
      if (page.loaded) await refreshBookingInbox(page);
    }).catch(() => {
      if (bookingNoticeActive(page)) { page.unsupported = '이 기기에서는 알림함에서 예약 확정을 확인해주세요.'; paintBookingInbox(page); }
    });
  }
}
