const { createHash, createPrivateKey, generateKeyPairSync, sign } = require('node:crypto');
const { getClassCapacity } = require('./schedule-server');

const inboxLimit = 50;
const maxDevices = 8;
const dayInMs = 24 * 3600 * 1000;
const pushConcurrency = 24;

function isRemoval(item) { return item.type === 'class_cancelled' || item.type === 'waitlist_removed'; }

function inboxItem(item) {
  const when = item.date + ' ' + item.startTime;
  let message;
  if (item.type === 'class_cancelled') {
    const booking = item.previousStatus === 'waiting' ? '대기가' : '예약이';
    message = item.dayClosed
      ? when + ' 수업 ' + booking + ' 박스 휴관으로 취소됐어요.'
      : when + ' 수업이 휴강되어 ' + booking + ' 취소됐어요.';
  } else if (item.type === 'waitlist_removed') {
    message = when + ' 수업 대기가 취소됐어요.';
  } else {
    message = when + ' 대기하던 수업의 예약이 확정됐어요.';
  }
  if (isRemoval(item) && item.reason) message += ' 사유 · ' + item.reason;
  return { ...item, message };
}

function notificationExpiresAt(item) {
  return isRemoval(item) ? Date.parse(item.createdAt) + dayInMs : Date.parse(item.date + 'T' + item.startTime + ':00+09:00');
}

function pushEndpoint(input) {
  if (typeof input !== 'string' || input.length > 2048) return null;
  let url;
  try { url = new URL(input); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash || url.pathname.length < 2) return null;
  const host = url.hostname;
  const supported =
    (host === 'fcm.googleapis.com' && /^\/(fcm\/send|wp)\/.+/.test(url.pathname)) ||
    (host.endsWith('.push.services.mozilla.com') && /^\/wpush\/.+/.test(url.pathname)) ||
    (host === 'web.push.apple.com' || host.endsWith('.web.push.apple.com')) ||
    (host.endsWith('.notify.windows.com') && /^\/w\//.test(url.pathname));
  return supported ? url.href : null;
}

function deviceId(endpoint) { return createHash('sha256').update(endpoint).digest('hex'); }

function createVapidKeys() {
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = pair.privateKey.export({ format: 'jwk' });
  const publicKey = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]).toString('base64url');
  return { publicKey, privateKey: jwk };
}

// RFC 8292 + RFC 8030. The notification itself contains no private booking data.
// The service worker reads the member's current inbox with their browser session.
function vapidAuthorization(keys, audience, now, subject) {
  const encode = data => Buffer.from(JSON.stringify(data)).toString('base64url');
  const unsigned = encode({ typ: 'JWT', alg: 'ES256' }) + '.' +
    encode({ aud: audience, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject });
  const signature = sign('sha256', Buffer.from(unsigned), {
    key: createPrivateKey({ key: keys.privateKey, format: 'jwk' }), dsaEncoding: 'ieee-p1363',
  });
  return 'vapid t=' + unsigned + '.' + signature.toString('base64url') + ', k=' + keys.publicKey;
}

function createNotificationService({ getStore, commit, ApiError, now = Date.now, fetchImpl = globalThis.fetch,
  subject = 'https://zone-diet-application.vercel.app' }) {
  // Cache the authorization per push service in the private store so that cold
  // serverless instances also reuse Apple's JWT for at least an hour.
  function withAuthorizations(keys, endpoints) {
    if (!keys) return keys;
    const instant = now();
    let result = keys;
    for (const endpoint of endpoints) {
      const valid = pushEndpoint(endpoint);
      if (!valid) continue;
      const origin = new URL(valid).origin;
      if (result.authorizations?.[origin]?.expiresAt > instant + 3600000) continue;
      const item = { header: vapidAuthorization(keys, origin, instant, subject), expiresAt: instant + 12 * 3600000 };
      result = { ...result, authorizations: { ...result.authorizations, [origin]: item } };
    }
    return result;
  }

  function recordPromotion(store, event) {
    const existing = store.promotionInbox?.[event.memberId] || [];
    if (existing.some(item => item.id === event.id)) return store;
    const { id, date, startTime, createdAt } = event;
    const item = { id, date, startTime, createdAt, read: false };
    if (isRemoval(event)) {
      item.type = event.type;
      item.previousStatus = event.previousStatus;
      item.reason = event.reason || '';
      if (event.dayClosed) item.dayClosed = true;
    }
    const updated = { ...store, promotionInbox: { ...store.promotionInbox,
      [event.memberId]: [item, ...existing].slice(0, inboxLimit) } };
    if (store.bookingPushKeys) {
      const targets = Object.entries(store.bookingPushDevices || {}).filter(([, device]) => device.memberId === event.memberId);
      const endpoints = targets.map(([, device]) => device.endpoint);
      if (targets.length) {
        updated.bookingPushDevices = { ...store.bookingPushDevices };
        for (const [key, device] of targets) updated.bookingPushDevices[key] = { ...device, latestPromotionId: id };
      }
      try { updated.bookingPushKeys = withAuthorizations(store.bookingPushKeys, endpoints); }
      catch { /* A broken push key cannot prevent queue promotion or the in-app alert. */ }
    }
    return updated;
  }

  async function deliverPromotions(events) {
    const store = getStore(), keys = store.bookingPushKeys;
    if (!keys || !events.length) return;
    const recipients = new Map(events.map(event => [event.memberId, event]));
    const devices = Object.entries(store.bookingPushDevices || {}).filter(([, device]) => recipients.has(device.memberId));
    if (!devices.length) return;
    // A full day can include many members. Send one wake-up per affected device
    // within a shared deadline, leaving all notices in the privately persisted inbox.
    const deadline = AbortSignal.timeout(12000);
    const jobs = devices.values();
    const expired = [];
    async function sendDevice(id, device) {
      const event = recipients.get(device.memberId);
      const secondsLeft = Math.ceil((notificationExpiresAt(event) - now()) / 1000);
      if (secondsLeft <= 0 || !Number.isFinite(secondsLeft) || (device.latestPromotionId && device.latestPromotionId !== event.id)) return;
      const endpoint = pushEndpoint(device.endpoint);
      if (!endpoint) return;
      const authorization = keys.authorizations?.[new URL(endpoint).origin];
      if (!authorization || authorization.expiresAt <= now()) return;
      const response = await fetchImpl(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.any([deadline, AbortSignal.timeout(3500)]),
        headers: { TTL: String(Math.min(secondsLeft, 24 * 3600)), Urgency: 'high', 'Content-Length': '0',
          Authorization: authorization.header } });
      if (response.status === 404 || response.status === 410) expired.push([id, device]);
      if (response.body) await response.body.cancel();
    }
    async function work() {
      for (const [id, device] of jobs) {
        if (deadline.aborted) break;
        try { await sendDevice(id, device); } catch { /* Other recipients can still receive their notice. */ }
      }
    }
    await Promise.all(Array.from({ length: Math.min(pushConcurrency, devices.length) }, work));
    if (expired.length) {
      const current = getStore(), next = { ...current.bookingPushDevices };
      for (const [id, old] of expired) if (next[id] === old) delete next[id];
      try { await commit({ ...current, bookingPushDevices: next }); } catch { /* Inbox and booking are already committed. */ }
    }
  }

  async function handle(req, res, session, url, readJson, send) {
    const route = url.pathname, base = '/api/notifications';
    if (route !== base && ![base + '/read', base + '/push-key', base + '/device'].includes(route)) return false;
    if (!session?.user) throw new ApiError(401, '로그인이 필요합니다.');
    if (session.user.pendingApproval || session.user.isAdmin) throw new ApiError(403, '등록된 회원만 예약 알림을 이용할 수 있습니다.');
    const memberId = session.user.id;
    if (route === base && req.method === 'GET') {
      const store = getStore(), items = store.promotionInbox?.[memberId] || [];
      const device = url.searchParams.get('device');
      const typedNotices = url.searchParams.get('format') === '2';
      if (device !== null) {
        const target = /^[a-f0-9]{64}$/.test(device) && store.bookingPushDevices?.[device];
        const registered = target?.memberId === memberId;
        // Removal notices survive removal from the roster. Older workers which
        // always show a confirmation receive only a generic wake-up for removals.
        const latest = registered && items.find(item => {
          if (item.id !== target.latestPromotionId || item.read || notificationExpiresAt(item) <= now()) return false;
          if (isRemoval(item)) return typedNotices;
          const queue = store.classReservations?.[item.date]?.[item.startTime] || [];
          const position = queue.indexOf(memberId);
          return position >= 0 && position < getClassCapacity(store, item.date, item.startTime);
        });
        send(res, 200, { registered: Boolean(registered), latest: latest ? inboxItem(latest) : null });
      } else {
        const visible = typedNotices ? items : items.filter(item => !isRemoval(item));
        send(res, 200, { memberId, items: visible.map(inboxItem), devices: Object.entries(store.bookingPushDevices || {}).filter(([, d]) => d.memberId === memberId).map(([id]) => id) });
      }
      return true;
    }
    if (route === base + '/push-key' && req.method === 'POST') {
      await readJson(req);
      const store = getStore(), keys = store.bookingPushKeys || createVapidKeys();
      if (!store.bookingPushKeys) await commit({ ...store, bookingPushKeys: keys });
      send(res, 200, { publicKey: keys.publicKey }); return true;
    }
    if (route === base + '/read' && req.method === 'POST') {
      const body = await readJson(req), ids = body?.ids;
      if (!Array.isArray(ids) || ids.length > inboxLimit || ids.some(id => typeof id !== 'string' || id.length > 64)) {
        throw new ApiError(422, '확인할 알림을 선택해주세요.');
      }
      const store = getStore(), items = store.promotionInbox?.[memberId] || [], selected = new Set(ids);
      if (items.some(item => !item.read && selected.has(item.id))) {
        await commit({ ...store, promotionInbox: { ...store.promotionInbox,
          [memberId]: items.map(item => selected.has(item.id) ? { ...item, read: true } : item) } });
      }
      send(res, 200, { ok: true }); return true;
    }
    if (route === base + '/device' && ['POST', 'DELETE'].includes(req.method)) {
      const body = await readJson(req), endpoint = pushEndpoint(body?.endpoint);
      if (!endpoint) throw new ApiError(422, '이 브라우저의 푸시 서비스를 지원하지 않습니다.');
      const store = getStore(), id = deviceId(endpoint), devices = { ...store.bookingPushDevices };
      if (req.method === 'DELETE') {
        if (devices[id]?.memberId === memberId) {
          delete devices[id]; await commit({ ...store, bookingPushDevices: devices });
        }
      } else if (devices[id]?.memberId !== memberId) {
        if (!store.bookingPushKeys || body.publicKey !== store.bookingPushKeys.publicKey) throw new ApiError(409, '알림 설정을 다시 열어주세요.');
        if (Object.values(devices).filter(d => d.memberId === memberId).length >= maxDevices) throw new ApiError(409, '다른 기기에서 알림을 끈 뒤 다시 시도해주세요.');
        devices[id] = { memberId, endpoint };
        await commit({ ...store, bookingPushDevices: devices, bookingPushKeys: withAuthorizations(store.bookingPushKeys, [endpoint]) });
      }
      send(res, 200, { ok: true }); return true;
    }
    return false;
  }
  return { handle, recordPromotion, deliverPromotion: event => deliverPromotions([event]), deliverPromotions };
}

module.exports = { createNotificationService };
