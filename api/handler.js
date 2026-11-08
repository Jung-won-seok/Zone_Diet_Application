const { createServer } = require('../server');
const { createCloudContext } = require('../cloud-storage');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    const url = new URL(req.url, 'https://app.invalid');
    const route = req.query?.route || url.searchParams.get('route');
    if (typeof route !== 'string' || !/^[a-z0-9/-]+$/.test(route)) {
      res.statusCode = 404; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({error:'페이지를 찾을 수 없습니다.'})); return;
    }
    url.searchParams.delete('route');
    req.url = `/api/${route}${url.search}`;
    const context = await createCloudContext();
    const allowedHosts = [process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL, ...(process.env.APP_HOSTS || '').split(',')].filter(Boolean);
    const app = createServer({ ...context, cloud: true, allowedHosts });
    await app.listeners('request')[0](req,res);
  } catch (error) {
    if (res.headersSent) return;
    res.statusCode = error.status || 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({error:error.status ? error.message : '온라인 저장소에 연결하지 못했어요. 잠시 후 다시 시도해주세요.'}));
    console.error('Application request failed:', error.name);
  }
};
