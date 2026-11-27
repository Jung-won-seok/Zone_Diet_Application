const { get, put, del, BlobPreconditionFailedError } = require('@vercel/blob');
const { seedStore, ApiError } = require('../index');
const { getStoreMode } = require('./storage-mode');
const STORE_PATH = 'app/store-v1.json';

function blobOptions() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new ApiError(503, '온라인 저장소가 연결되지 않았습니다. 관리자에게 문의해주세요.');
  return { access: 'private', token };
}

function readSnapshot(options) {
  // Request an uncompressed representation to preserve the strong ETag for conditional writes.
  return get(STORE_PATH, { ...options, useCache: false, headers: { 'accept-encoding': 'identity' } });
}

async function parseSnapshot(result) {
  if (!result?.stream) throw new ApiError(503, '저장된 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  const store = await new Response(result.stream).json();
  if (store?.version !== 1 || !Array.isArray(store.users)) throw new ApiError(503, '저장 데이터 형식을 확인해야 합니다.');
  return store;
}

async function readLegacyBlobStore() {
  return parseSnapshot(await readSnapshot(blobOptions()));
}

async function createBlobContext(options) {
  let result = await readSnapshot(options);
  if (!result) {
    let passwords;
    try { passwords = JSON.parse(process.env.INITIAL_ACCOUNT_PASSWORDS || 'null'); } catch {}
    const demoMembers = passwords && Object.keys(passwords).some(name => name !== 'admin');
    const accounts = ['admin'];
    if (demoMembers) accounts.push(...Array.from({length:20}, (_,i) => `member${String(i+1).padStart(2,'0')}`));
    if (!passwords || accounts.some(name => typeof passwords[name] !== 'string' || passwords[name].length < 8)) {
      throw new ApiError(503, '초기 로그인 계정이 설정되지 않았습니다. 관리자에게 문의해주세요.');
    }
    try {
      await put(STORE_PATH, JSON.stringify(seedStore(passwords, { demoMembers })), { ...options, contentType: 'application/json', addRandomSuffix: false, allowOverwrite: false, cacheControlMaxAge: 60 });
    } catch (error) {
      result = await readSnapshot(options);
      if (!result) throw error;
    }
    if (!result) result = await readSnapshot(options);
  }
  const initialStore = await parseSnapshot(result);
  let etag = result.blob.etag;
  return {
    initialStore,
    async persistStore(next) {
      try {
        const saved = await put(STORE_PATH, JSON.stringify(next), { ...options, contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, ifMatch: etag, cacheControlMaxAge: 60 });
        etag = saved.etag;
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError) {
          const conflict = new ApiError(409, '다른 회원의 변경사항이 먼저 저장됐어요. 최신 현황을 확인한 뒤 다시 시도해주세요.');
          conflict.code = 'STORE_CONFLICT';
          throw conflict;
        }
        throw error;
      }
    },
  };
}

function blobMediaStorage(options) {
  return {
    async write(id, buffer, mime) { await put(`media/${id}`, buffer, { ...options, contentType: mime, addRandomSuffix: false, allowOverwrite: false }); },
    async read(id) {
      const image = await get(`media/${id}`, options);
      if (!image?.stream) throw new ApiError(404, '사진을 찾을 수 없습니다.');
      return Buffer.from(await new Response(image.stream).arrayBuffer());
    },
    async remove(id) { await del(`media/${id}`, { token: options.token }); },
  };
}

async function createCloudContext(request = {}) {
  const mode = getStoreMode();
  const options = blobOptions();
  const context = mode === 'postgres'
    ? await require('../db/store').createPostgresContext(require('../db/pool').getPool(), request)
    : await createBlobContext(options);
  return { ...context, mediaStorage: blobMediaStorage(options) };
}
module.exports = { createCloudContext, readLegacyBlobStore };
