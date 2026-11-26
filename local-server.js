const http = require('node:http');
const { createServer, ApiError, isLocalHost, sendStatic } = require('./server');
const { getStoreMode, checkMaintenance } = require('./storage-mode');

function createLocalServer() {
  const mode = getStoreMode('local');
  if (mode === 'local' && process.env.LEBEN_MAINTENANCE !== '1') return createServer();

  return http.createServer(async (req, res) => {
    try {
      if (!isLocalHost(req.headers.host)) throw new ApiError(403, '허용되지 않은 접속 주소입니다.');
      const { pathname } = new URL(req.url, 'http://localhost');
      if (!pathname.startsWith('/api/')) return await sendStatic(req, res, pathname);
      checkMaintenance();
      // For isolated development PostgreSQL uses the existing local media directory.
      // Setting the private Blob token also exercises the deployed media implementation.
      const request = { cookie: req.headers.cookie };
      const context = mode === 'postgres' && !process.env.BLOB_READ_WRITE_TOKEN
        ? await require('./db/store').createPostgresContext(require('./db/pool').getPool(), request)
        : await require('./cloud-storage').createCloudContext(request);
      const app = createServer({ ...context, sharedSessions: true });
      await app.listeners('request')[0](req, res);
    } catch (error) {
      if (res.headersSent || res.destroyed) return;
      const status = error.status || 503;
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...(status === 503 && { 'Retry-After': '60' }),
      });
      res.end(JSON.stringify({ error: error.status ? error.message : '온라인 저장소에 연결하지 못했어요.' }));
    }
  });
}

module.exports = { createLocalServer };
