const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const MEALS = ['breakfast', 'lunch', 'dinner'];
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_PHOTOS = 6;
const BLOCK_KEYS = ['carbs', 'protein', 'fat'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function createMealService({ getStore, commit, mediaDir, mediaStorage, ApiError }) {
  const initial = getStore();
  if (!Array.isArray(initial.mealPosts)) initial.mealPosts = [];
  if (!object(initial.mealRevisions)) initial.mealRevisions = {};
  if (!object(initial.media)) initial.media = {};
  if (!Array.isArray(initial.mealReports)) initial.mealReports = [];
  if (!mediaStorage) fs.mkdirSync(mediaDir, { recursive: true, mode: 0o700 });
  const storage = mediaStorage || {
    write(id, buffer) { fs.writeFileSync(path.join(mediaDir, id), buffer, { flag: 'wx', mode: 0o600 }); },
    read(id) { return fs.readFileSync(path.join(mediaDir, id)); },
    remove(id) { fs.unlinkSync(path.join(mediaDir, id)); },
  };
  function assert(condition, message, status = 422) { if (!condition) throw new ApiError(status, message); }
  function validDate(value) {
    assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value && value <= today(), '날짜는 오늘 또는 지난 날짜를 선택해주세요.');
    return value;
  }
  function caption(value, maximum) {
    assert(typeof value === 'string' && value.length <= maximum, `설명은 ${maximum}자 이내로 입력해주세요.`);
    return value.trim();
  }
  const normalizedBlocks = value => Object.fromEntries(BLOCK_KEYS.map(key => [key, typeof value?.[key] === 'number' ? value[key] : null]));
  function validateBlocks(value) {
    assert(object(value) && Object.keys(value).length === BLOCK_KEYS.length && BLOCK_KEYS.every(key => Object.hasOwn(value, key)), '탄수화물·단백질·지방 블록을 확인해주세요.');
    for (const key of BLOCK_KEYS) {
      const count = value[key];
      assert(count === null || (typeof count === 'number' && Number.isFinite(count) && count >= 0 && count <= 100 && Number(count.toFixed(2)) === count), '블록은 0~100 사이의 숫자로 소수점 둘째 자리까지 입력해주세요. 미입력 항목은 비워둘 수 있습니다.');
    }
    return normalizedBlocks(value);
  }
  const publicReport = report => report ? { ...report, posts: report.posts.map(post => ({ ...post, blocks: normalizedBlocks(post.blocks) })) } : null;
  const membership = (store, userId) => store.members.find(member => member.id === userId);
  const revisionKey = (teamId, date) => `${teamId}|${date}`;
  const revision = (store, teamId, date) => `${store.revision}:${store.mealRevisions[revisionKey(teamId, date)] || 0}`;
  function currentPosts(store, teamId, date) {
    const memberIds = new Set(store.members.filter(member => member.teamId === teamId).map(member => member.id));
    return store.mealPosts.filter(post => post.teamId === teamId && post.date === date && memberIds.has(post.memberId)).sort((a, b) => a.memberId.localeCompare(b.memberId) || MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal));
  }
  function postMediaIds(post) {
    if (!post) return [];
    return Array.isArray(post.mediaIds) ? post.mediaIds : post.mediaId ? [post.mediaId] : [];
  }
  function publicPost(store, post) {
    const photos = postMediaIds(post).map(id => ({ id, url: `/api/media/${id}` }));
    return { id: post.id, memberId: post.memberId, name: store.users.find(user => user.id === post.memberId).name, date: post.date, meal: post.meal, caption: post.caption, blocks: normalizedBlocks(post.blocks), photos, imageUrl: photos[0]?.url || '', version: post.version, createdAt: post.createdAt, updatedAt: post.updatedAt };
  }
  function feed(session, date, requestedTeamId) {
    const store = getStore(), own = membership(store, session.user.id);
    assert(session.user.isAdmin || requestedTeamId === undefined, '다른 팀의 식단은 조회할 수 없습니다.', 403);
    const teamId = session.user.isAdmin ? requestedTeamId || store.teams[0]?.id : own?.teamId;
    const team = store.teams.find(team => team.id === teamId) || null;
    if (session.user.isAdmin && requestedTeamId !== undefined) assert(team, '존재하지 않는 팀입니다.');
    return {
      date, team,
      members: team ? store.members.filter(member => member.teamId === teamId).map(member => ({ id: member.id, name: store.users.find(user => user.id === member.id).name, role: member.role, customRole: member.customRole })) : [],
      posts: team ? currentPosts(store, teamId, date).map(post => publicPost(store, post)) : [],
      revision: revision(store, teamId || 'unassigned', date),
      report: team ? publicReport(store.mealReports.find(report => report.teamId === teamId && report.date === date)) : null,
      canPublish: Boolean(team && !session.user.isAdmin && own?.role === 'diet'),
    };
  }
  function decodeImage(value) {
    assert(typeof value === 'string', '식단 사진을 선택해주세요.');
    assert(value.length <= Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 100, '사진은 2 MB 이하로 올려주세요.', 413);
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    assert(match && match[2].length % 4 === 0, 'JPEG, PNG, WebP 사진만 올릴 수 있습니다.');
    const buffer = Buffer.from(match[2], 'base64'), mime = match[1];
    assert(buffer.length > 0 && buffer.length <= MAX_IMAGE_BYTES, '사진은 2 MB 이하로 올려주세요.', 413);
    assert(buffer.toString('base64') === match[2], '사진 데이터 형식이 올바르지 않습니다.');
    let valid = false;
    if (mime === 'image/png') valid = buffer.length >= 45 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && buffer.readUInt32BE(8) === 13 && buffer.toString('ascii', 12, 16) === 'IHDR' && buffer.readUInt32BE(16) > 0 && buffer.readUInt32BE(20) > 0 && buffer.toString('ascii', buffer.length - 8, buffer.length - 4) === 'IEND';
    if (mime === 'image/jpeg') valid = buffer.length >= 4 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255 && buffer[buffer.length - 2] === 255 && buffer[buffer.length - 1] === 217;
    if (mime === 'image/webp') valid = buffer.length >= 20 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' && buffer.readUInt32LE(4) + 8 === buffer.length && ['VP8 ', 'VP8L', 'VP8X'].includes(buffer.toString('ascii', 12, 16));
    assert(valid, '파일 내용이 사진 형식과 일치하지 않습니다. 다른 사진을 선택해주세요.');
    return { buffer, mime };
  }
  async function saveMeal(session, body) {
    assert(object(body), '식단 기록 형식을 확인해주세요.');
    const date = validDate(body.date), text = caption(body.caption, 300);
    assert(MEALS.includes(body.meal), '아침, 점심, 저녁 중 하나를 선택해주세요.');
    assert(Number.isInteger(body.expectedVersion) && body.expectedVersion >= 0, '기록 버전을 확인해주세요.');
    const store = getStore(), own = membership(store, session.user.id);
    assert(!session.user.isAdmin && own?.teamId, '팀에 배정된 회원만 식단을 올릴 수 있습니다.', 403);
    assert(typeof body.expectedTeamId === 'string' && store.teams.some(team => team.id === body.expectedTeamId), '식단을 공유할 팀을 확인해주세요. 화면을 새로 불러온 뒤 다시 시도해주세요.');
    assert(body.expectedTeamId === own.teamId, '식단을 작성하는 동안 소속 팀이 변경되었습니다. 현재 팀을 확인한 뒤 다시 저장해주세요.', 409);
    const existing = store.mealPosts.find(post => post.memberId === session.user.id && post.teamId === own.teamId && post.date === date && post.meal === body.meal);
    assert(body.expectedVersion === (existing?.version || 0), '다른 창에서 식단이 변경되었습니다. 최신 내용을 불러온 뒤 다시 저장해주세요.', 409);
    const blocks = body.blocks === undefined ? normalizedBlocks(existing?.blocks) : validateBlocks(body.blocks);
    const hasPhotos = body.photos !== undefined, hasImage = body.imageData !== undefined;
    assert(!(hasPhotos && hasImage), '사진 목록과 단일 사진을 동시에 지정할 수 없습니다.');
    const photos = hasPhotos ? body.photos : hasImage ? [{ imageData: body.imageData }] : postMediaIds(existing).map(id => ({ id }));
    assert(Array.isArray(photos) && photos.length <= MAX_PHOTOS, '식단 사진은 한 끼에 최대 6장까지 올릴 수 있습니다.');
    assert(photos.length > 0 || BLOCK_KEYS.some(key => blocks[key] !== null), '사진을 선택하거나 탄단지 블록을 하나 이상 입력해주세요.');
    const existingIds = new Set(postMediaIds(existing)), selectedIds = new Set(), uploads = [];
    const mediaIds = photos.map(photo => {
      assert(object(photo) && ((photo.id !== undefined) !== (photo.imageData !== undefined)), '유지할 사진 또는 새 사진을 올바르게 선택해주세요.');
      if (photo.id !== undefined) {
        assert(typeof photo.id === 'string' && existingIds.has(photo.id) && store.media[photo.id]?.memberId === session.user.id, '이 식단에 등록된 본인의 사진만 다시 사용할 수 있습니다.');
        assert(!selectedIds.has(photo.id), '같은 사진을 중복으로 넣을 수 없습니다.');
        selectedIds.add(photo.id);
        return photo.id;
      }
      const image = decodeImage(photo.imageData), id = crypto.randomBytes(16).toString('hex');
      uploads.push({ id, ...image });
      selectedIds.add(id);
      return id;
    });
    const timestamp = new Date().toISOString();
    const post = { id: existing?.id || crypto.randomUUID(), memberId: session.user.id, teamId: own.teamId, date, meal: body.meal, caption: text, blocks, mediaId: mediaIds[0], mediaIds, version: (existing?.version || 0) + 1, createdAt: existing?.createdAt || timestamp, updatedAt: timestamp };
    const mealPosts = existing ? store.mealPosts.map(row => row.id === existing.id ? post : row) : [...store.mealPosts, post];
    const key = revisionKey(own.teamId, date);
    const media = { ...store.media };
    for (const image of uploads) media[image.id] = { id: image.id, memberId: session.user.id, teamId: own.teamId, mime: image.mime };
    const next = { ...store, mealPosts, mealRevisions: { ...store.mealRevisions, [key]: (store.mealRevisions[key] || 0) + 1 }, media };
    const written = [];
    try {
      for (const image of uploads) {
        written.push(image.id);
        await storage.write(image.id, image.buffer, image.mime);
      }
      assert(getStore() === store, '저장 중 다른 기록이 변경되었습니다. 최신 내용을 불러온 뒤 다시 저장해주세요.', 409);
      await commit(next);
    } catch (error) {
      await Promise.allSettled(written.map(id => Promise.resolve().then(() => storage.remove(id))));
      throw error;
    }
    return feed(session, date);
  }
  async function publishReport(session, body) {
    assert(object(body), '팀 정리 형식을 확인해주세요.');
    const date = validDate(body.date), text = caption(body.caption, 500);
    const store = getStore(), own = membership(store, session.user.id);
    assert(!session.user.isAdmin && own?.teamId && own.role === 'diet', '현재 팀의 식단 담당만 전체 공개 정리를 게시할 수 있습니다.', 403);
    const sourceRevision = revision(store, own.teamId, date);
    assert(typeof body.expectedRevision === 'string' && body.expectedRevision === sourceRevision, '팀 식단 또는 팀 배정이 변경되었습니다. 최신 내용을 확인한 뒤 다시 게시해주세요.', 409);
    assert(Number.isInteger(body.expectedReportVersion) && body.expectedReportVersion >= 0, '공개 정리의 버전을 확인해주세요. 최신 내용을 불러온 뒤 다시 시도해주세요.');
    const existing = store.mealReports.find(report => report.teamId === own.teamId && report.date === date);
    assert(body.expectedReportVersion === (existing?.version || 0), '다른 창에서 공개 정리가 변경되었습니다. 최신 정리를 확인한 뒤 다시 게시해주세요.', 409);
    const team = store.teams.find(team => team.id === own.teamId);
    const posts = currentPosts(store, team.id, date).map(post => publicPost(store, post));
    assert(posts.length > 0, '정리할 식단 기록이 하나 이상 필요합니다.');
    const members = store.members.filter(member => member.teamId === team.id).map(member => ({ id: member.id, name: store.users.find(user => user.id === member.id).name }));
    const report = { id: existing?.id || crypto.randomUUID(), teamId: team.id, teamName: team.name, date, caption: text, publishedBy: { id: session.user.id, name: session.user.name }, publishedAt: new Date().toISOString(), version: (existing?.version || 0) + 1, sourceRevision, members, posts, completedCount: posts.length, expectedCount: members.length * 3 };
    assert(getStore() === store, '게시 중 다른 기록이 변경되었습니다. 최신 내용을 불러온 뒤 다시 게시해주세요.', 409);
    await commit({ ...store, mealReports: existing ? store.mealReports.map(row => row.id === existing.id ? report : row) : [...store.mealReports, report] });
    return { report };
  }
  async function readMedia(session, id, res) {
    const store = getStore(), media = store.media[id];
    assert(/^[a-f0-9]{32}$/.test(id) && media, '사진을 찾을 수 없습니다.', 404);
    const own = membership(store, session.user.id);
    const imageUrl = `/api/media/${id}`;
    const published = store.mealReports.some(report => report.posts.some(post => post.imageUrl === imageUrl || post.photos?.some(photo => photo.url === imageUrl)));
    assert(session.user.isAdmin || media.memberId === session.user.id || (own?.teamId && own.teamId === media.teamId) || published, '이 사진을 볼 수 있는 권한이 없습니다.', 403);
    const buffer = Buffer.from(await storage.read(id));
    res.writeHead(200, { 'Content-Type': media.mime, 'Content-Length': buffer.length, 'Cache-Control': 'no-store', 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' });
    res.end(buffer);
  }
  function photoMealCounts(user) {
    if (user.isAdmin) return {};
    const store = getStore(), own = membership(store, user.id), counts = {};
    if (!own?.teamId) return counts;
    for (const post of store.mealPosts) if (post.memberId === user.id && post.teamId === own.teamId && postMediaIds(post).length) counts[post.date] = (counts[post.date] || 0) + 1;
    return counts;
  }
  async function handle(req, res, session, url, readJson, send) {
    if (url.pathname === '/api/meals' && req.method === 'GET') {
      send(res, 200, feed(session, validDate(url.searchParams.get('date') || today()), url.searchParams.has('teamId') ? url.searchParams.get('teamId') : undefined)); return true;
    }
    if (url.pathname === '/api/meals' && req.method === 'POST') {
      send(res, 200, await saveMeal(session, await readJson(req, 3 * 1024 * 1024))); return true;
    }
    if (url.pathname === '/api/reports' && req.method === 'GET') {
      const date = validDate(url.searchParams.get('date') || today());
      send(res, 200, { date, reports: getStore().mealReports.filter(report => report.date === date).sort((a,b) => a.teamId.localeCompare(b.teamId)).map(publicReport) }); return true;
    }
    if (url.pathname === '/api/reports' && req.method === 'POST') {
      send(res, 200, await publishReport(session, await readJson(req))); return true;
    }
    if (url.pathname.startsWith('/api/media/') && req.method === 'GET') {
      await readMedia(session, url.pathname.slice('/api/media/'.length), res); return true;
    }
    return false;
  }
  return { handle, photoMealCounts };
}
module.exports = { createMealService };
