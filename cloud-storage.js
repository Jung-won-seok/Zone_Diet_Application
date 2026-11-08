const { get, put, del, BlobPreconditionFailedError } = require('@vercel/blob');
const { seedStore, ApiError } = require('./server');
const STORE_PATH = 'app/store-v1.json';

// Each request reads a fresh snapshot. ETag checks make metadata commits atomic
// across Vercel instances; a conflicting request must reload before retrying.
async function createCloudContext() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new ApiError(503, '온라인 저장소가 연결되지 않았습니다. 관리자에게 문의해주세요.');
  const options = { access: 'private', token };
  // Keep the storage ETag strong: compressed GET responses may use a weak ETag,
  // which cannot be used for the next conditional write.
  const read = pathname => get(pathname, { ...options, useCache: false, headers: { 'accept-encoding': 'identity' } });
  let result = await read(STORE_PATH);
  if (!result) {
    let passwords;
    try { passwords = JSON.parse(process.env.INITIAL_ACCOUNT_PASSWORDS || 'null'); } catch {}
    const accounts = ['admin', ...Array.from({length:20}, (_,i) => `member${String(i+1).padStart(2,'0')}`)];
    if (!passwords || accounts.some(name => typeof passwords[name] !== 'string' || passwords[name].length < 8)) {
      throw new ApiError(503, '초기 로그인 계정이 설정되지 않았습니다. 관리자에게 문의해주세요.');
    }
    try {
      await put(STORE_PATH, JSON.stringify(seedStore(passwords)), { ...options, contentType: 'application/json', addRandomSuffix: false, allowOverwrite: false, cacheControlMaxAge: 60 });
    } catch (error) {
      result = await read(STORE_PATH);
      if (!result) throw error;
    }
    if (!result) result = await read(STORE_PATH);
  }
  if (!result?.stream) throw new ApiError(503, '저장된 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  let etag = result.blob.etag;
  const initialStore = await new Response(result.stream).json();
  if (initialStore.version !== 1 || !Array.isArray(initialStore.users)) throw new ApiError(503, '저장 데이터 형식을 확인해야 합니다.');
  return {
    initialStore,
    async persistStore(next) {
      try {
        const saved = await put(STORE_PATH, JSON.stringify(next), { ...options, contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, ifMatch: etag, cacheControlMaxAge: 60 });
        etag = saved.etag;
      } catch (error) {
        if (error instanceof BlobPreconditionFailedError) throw new ApiError(409, '다른 회원의 변경사항이 먼저 저장됐어요. 새로고침 후 다시 저장해주세요.');
        throw error;
      }
    },
    mediaStorage: {
      async write(id, buffer, mime) { await put(`media/${id}`, buffer, { ...options, contentType: mime, addRandomSuffix: false, allowOverwrite: false }); },
      async read(id) {
        const image = await get(`media/${id}`, options);
        if (!image?.stream) throw new ApiError(404, '사진을 찾을 수 없습니다.');
        return Buffer.from(await new Response(image.stream).arrayBuffer());
      },
      async remove(id) { await del(`media/${id}`, { token }); },
    },
  };
}
module.exports = { createCloudContext };
