const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, createPublicKey, verify } = require('node:crypto');
const { readPublicAsset } = require('./support/public-assets');
const vm = require('node:vm');
const { createNotificationService } = require('../server/services/notifications');

const now = Date.parse('2026-11-25T07:00:00+09:00');
const endpoint = 'https://fcm.googleapis.com/fcm/send/a-registration-token';
const event = { memberId: 'member', date: '2026-11-25', startTime: '19:30', createdAt: new Date(now).toISOString(), id: 'notice-1' };

function harness(transport = async () => ({ status: 201 }), clock = () => now) {
  let store = {};
  const commit = async next => { store = next; };
  class ApiError extends Error { constructor(status, message) { super(message); this.status = status; } }
  const service = createNotificationService({ getStore: () => store, commit, ApiError, now: clock, fetchImpl: transport });
  async function request(method, path, body = {}, who = { id: 'member' }) {
    let value;
    await service.handle({ method }, {}, who ? { user: who } : null, new URL('/api/notifications' + path, 'https://example.org'), async () => body,
      (res, status, data) => { assert.equal(status, 200); value = data; });
    return value;
  }
  async function subscribe(who = { id: 'member' }, target = endpoint) {
    const { publicKey } = await request('POST', '/push-key', {}, who);
    await request('POST', '/device', { endpoint: target, publicKey }, who);
    return publicKey;
  }
  return { service, request, subscribe, commit, get store() { return store; } };
}

test('promotion persists with booking, appears only in its own inbox, and reading a snapshot cannot mark newer alerts', async () => {
  const h = harness();
  let next = h.service.recordPromotion(h.store, event);
  next = h.service.recordPromotion(next, event);
  await h.commit(h.service.recordPromotion(next, { ...event, id: 'notice-2' }));
  assert.equal((await h.request('GET', '')).memberId, 'member');
  assert.equal((await h.request('GET', '', {}, { id: 'other' })).memberId, 'other');
  assert.deepEqual((await h.request('GET', '')).items.map(x => x.id), ['notice-2', 'notice-1']);
  assert.deepEqual((await h.request('GET', '', {}, { id: 'other' })).items, []);
  await h.request('POST', '/read', { ids: ['notice-1'] }, { id: 'other' });
  assert.equal((await h.request('GET', '')).items[1].read, false);
  await h.request('POST', '/read', { ids: ['notice-1'] });
  assert.deepEqual((await h.request('GET', '')).items.map(x => x.read), [false, true]);
  for (const who of [null, { id: 'unapproved', pendingApproval: true }, { id: 'admin', isAdmin: true }]) {
    await assert.rejects(h.request('GET', '', {}, who), e => e.status === (who ? 403 : 401));
  }
});

test('a stale tab discards inbox details and device state from a switched account, stops polling and removes controls', async () => {
  const page = { host: { innerHTML: 'previous member notification and buttons' }, userId: 'original', timer: 12,
    items: [event], lastContent: 'old details', endpointId: 'old device', subscribed: true, controller: new AbortController() };
  let calls = 0, cleared;
  const context = vm.createContext({ page, session: { id: 'original' },
    api: async () => { calls++; return { memberId: 'other', items: [{ id: 'private new details' }], devices: ['other device'] }; },
    clearInterval: timer => { cleared = timer; }, document: { hidden: false, removeEventListener() {} }, navigator: {} });
  vm.runInContext(readPublicAsset('notifications.js'), context);
  await vm.runInContext('bookingNotificationPage = page; refreshBookingInbox(page)', context);
  assert.equal(cleared, page.timer);
  assert.equal(page.controller.signal.aborted, true);
  assert.equal(page.items.length, 0);
  assert.equal(page.lastContent, '');
  assert.equal(page.subscribed, false);
  assert.equal(page.endpointId, null);
  assert.match(page.host.innerHTML, /새로고침/);
  assert.doesNotMatch(page.host.innerHTML, /button|previous|private|old details/);
  await vm.runInContext('refreshBookingInbox(page)', context);
  assert.equal(calls, 1);
});

test('opt-in rejects arbitrary destinations; VAPID sends a signed, payload-free message only to the promoted member', async () => {
  const sent = [];
  const h = harness(async (url, opts) => { sent.push({ url, opts }); return { status: 201 }; });
  const publicKey = await h.subscribe();
  assert.equal(publicKey, (await h.request('POST', '/push-key')).publicKey);
  await h.subscribe({ id: 'other' }, 'https://web.push.apple.com/a-device');
  for (const url of ['http://fcm.googleapis.com/fcm/send/id', 'https://user@fcm.googleapis.com/fcm/send/id',
    'https://fcm.googleapis.com:8443/fcm/send/id', 'https://fcm.googleapis.com.invalid/fcm/send/id', 'https://127.0.0.1/send', 'https://fcm.googleapis.com/other']) {
    await assert.rejects(h.request('POST', '/device', { endpoint: url, publicKey }), e => e.status === 422);
  }
  await h.service.deliverPromotion(event);
  assert.equal(sent.length, 1);
  const { url, opts } = sent[0];
  assert.equal(url, endpoint);
  assert.equal(opts.body, undefined);
  assert.equal(opts.redirect, 'error');
  const match = opts.headers.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  const [header, claims, signature] = match[1].split('.');
  const pub = Buffer.from(match[2], 'base64url');
  assert.equal(match[2], publicKey);
  assert.equal(JSON.parse(Buffer.from(claims, 'base64url')).aud, new URL(endpoint).origin);
  const key = createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') } });
  assert.ok(verify('sha256', Buffer.from(header + '.' + claims), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
  assert.equal(opts.headers.TTL, String(12.5 * 3600));
  assert.equal(JSON.stringify(await h.request('GET', '')).includes(endpoint), false);
});

test('service worker details require device ownership, a live confirmed seat and an unread notice', async () => {
  const h = harness();
  await h.subscribe();
  const query = '?device=' + createHash('sha256').update(endpoint).digest('hex');
  await h.commit(h.service.recordPromotion({ ...h.store, classReservations: { [event.date]: { [event.startTime]: ['member'] } } }, event));
  assert.equal((await h.request('GET', query)).latest.id, event.id);
  assert.deepEqual(await h.request('GET', query, {}, { id: 'other' }), { registered: false, latest: null });
  await h.commit({ ...h.store, classReservations: {} });
  assert.equal((await h.request('GET', query)).latest, null);
  await h.commit({ ...h.store, classReservations: { [event.date]: { [event.startTime]: ['member'] } } });
  await h.commit(h.service.recordPromotion(h.store, { ...event, id: 'newest' }));
  await h.request('POST', '/read', { ids: ['newest'] });
  assert.equal((await h.request('GET', query)).latest, null);
  await h.request('DELETE', '/device', { endpoint }, { id: 'other' });
  assert.equal((await h.request('GET', query)).registered, true);
  await h.request('DELETE', '/device', { endpoint });
  assert.equal((await h.request('GET', query)).registered, false);
});

test('class cancellation keeps its reason and the original booking status after deleting the roster; unrelated members and legacy workers get no cancellation details', async () => {
  const h = harness();
  await h.subscribe();
  const query = '?device=' + createHash('sha256').update(endpoint).digest('hex');
  const affected = [];
  for (const previousStatus of ['confirmed', 'waiting']) {
    const memberId = previousStatus === 'confirmed' ? 'member' : 'waiter';
    const cancellation = { ...event, memberId, id: 'cancel-' + memberId, type: 'class_cancelled', previousStatus, reason: '박스 시설 점검' };
    affected.push(cancellation);
    await h.commit(h.service.recordPromotion(h.store, cancellation));
    const inbox = await h.request('GET', '?format=2', {}, { id: memberId });
    assert.equal(inbox.items[0].previousStatus, previousStatus);
    assert.ok(inbox.items[0].message.includes(event.date + ' ' + event.startTime));
    assert.match(inbox.items[0].message, previousStatus === 'confirmed' ? /예약이 취소/ : /대기가 취소/);
    assert.match(inbox.items[0].message, /박스 시설 점검/);
  }
  assert.equal((await h.request('GET', '', {}, { id: 'unrelated' })).items.length, 0);
  assert.equal((await h.request('GET', '')).items.length, 0);
  assert.equal((await h.request('GET', query)).latest, null);
  const modernWorker = await h.request('GET', query + '&format=2');
  assert.equal(modernWorker.latest.id, affected[0].id);
  assert.match(modernWorker.latest.message, /박스 시설 점검/);
  assert.equal((await h.request('GET', query + '&format=2', {}, { id: 'waiter' })).latest, null);
  const removed = { ...event, type: 'waitlist_removed', id: 'pass-expired', previousStatus: 'waiting', reason: '회원권이 만료되었습니다.' };
  await h.commit(h.service.recordPromotion(h.store, removed));
  const notice = (await h.request('GET', query + '&format=2')).latest;
  assert.ok(notice.message.includes('수업 대기가 취소'));
  assert.match(notice.message, /회원권이 만료/);
  assert.doesNotMatch(notice.message, /휴강|확정됐어요/);
});

test('a full-day batch wakes each affected device once and prunes stale devices without touching unrelated subscriptions', async () => {
  const sent = [];
  const h = harness(async url => { sent.push(url); return { status: url === endpoint ? 410 : 201 }; });
  const apple = 'https://web.push.apple.com/device-b';
  await h.subscribe();
  await h.subscribe({ id: 'waiter' }, apple);
  await h.subscribe({ id: 'unrelated' }, 'https://web.push.apple.com/device-c');
  const events = [event,
    { ...event, type: 'class_cancelled', id: 'cancel-a', dayClosed: true, previousStatus: 'confirmed', reason: '임시 휴무' },
    { ...event, type: 'class_cancelled', memberId: 'waiter', id: 'cancel-b', dayClosed: true, previousStatus: 'waiting', reason: '임시 휴무' }];
  const changes = events.reduce(h.service.recordPromotion, h.store);
  await h.commit(changes);
  await h.service.deliverPromotions(events);
  assert.deepEqual(sent.sort(), [endpoint, apple].sort());
  const inbox = (await h.request('GET', '?format=2')).items;
  assert.equal(inbox.length, 2);
  assert.match(inbox[0].message, /박스 휴관/);
  assert.equal((await h.request('GET', '')).devices.length, 0);
  assert.equal((await h.request('GET', '', {}, { id: 'unrelated' })).devices.length, 1);
});

test('expired subscriptions are pruned, acceptance errors preserve the inbox, expired class sends nothing', async () => {
  const h = harness(async url => {
    if (url === endpoint) return { status: 410 };
    throw new Error('temporary network failure');
  });
  await h.subscribe();
  await h.subscribe({ id: 'member' }, 'https://web.push.apple.com/second-device');
  await h.commit(h.service.recordPromotion(h.store, event));
  await h.service.deliverPromotion({ ...event, date: '2026-11-24' });
  assert.equal((await h.request('GET', '')).devices.length, 2);
  await h.service.deliverPromotion(event);
  assert.equal((await h.request('GET', '')).devices.length, 1);
  assert.equal((await h.request('GET', '')).items.length, 1);
});

test('promotions reuse the service JWT and renew it near expiry within the existing booking write', async () => {
  let instant = now;
  const h = harness(undefined, () => instant);
  await h.subscribe();
  const first = h.store.bookingPushKeys.authorizations['https://fcm.googleapis.com'];
  instant += 3600000;
  await h.commit(h.service.recordPromotion(h.store, event));
  assert.deepEqual(h.store.bookingPushKeys.authorizations['https://fcm.googleapis.com'], first);
  instant += 10.5 * 3600000;
  await h.commit(h.service.recordPromotion(h.store, { ...event, id: 'notice-2' }));
  assert.notEqual(h.store.bookingPushKeys.authorizations['https://fcm.googleapis.com'].header, first.header);
});

test('worker shows private schedule details only for authenticated device and safe date; expired sessions use a generic alert', async () => {
  const source = readPublicAsset('push-worker.js');
  const cancelled = { ...event, type: 'class_cancelled', message: event.date + ' ' + event.startTime + ' 수업이 휴강되어 예약이 취소됐어요. 사유 · 시설 점검' };
  for (const [allowed, item] of [[true, event], [true, cancelled], [false, cancelled]]) {
    const listeners = {}, shown = [];
    const self = { registration: { pushManager: { getSubscription: async () => ({ endpoint }) }, showNotification: async (...args) => shown.push(args) },
      clients: { matchAll: async () => [] }, addEventListener: (event, fn) => { listeners[event] = fn; } };
    const fetch = async url => {
      assert.match(url, /format=2/);
      return { ok: allowed, json: async () => ({ registered: true, latest: item }) };
    };
    vm.runInNewContext(source, { self, crypto: require('node:crypto').webcrypto, TextEncoder, fetch, AbortSignal });
    let work;
    listeners.push({ waitUntil: promise => { work = promise; } }); await work;
    assert.equal(shown.length, 1);
    assert.equal(shown[0][1].body.includes(event.startTime), allowed);
    assert.equal(shown[0][1].data.route, allowed ? '/#reservations/' + event.date : '/#reservations');
    if (allowed && item.type === 'class_cancelled') assert.equal(shown[0][1].body, cancelled.message);
    if (!allowed) assert.doesNotMatch(shown[0][1].body, /시설 점검/);
  }
});
