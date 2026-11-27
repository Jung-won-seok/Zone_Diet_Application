const { Pool } = require('pg');

function poolOptions(connectionString, ca) {
  if (!connectionString) throw new Error('LEBEN_DATABASE_URL is required.');
  let url;
  try { url = new URL(connectionString); } catch { throw new Error('Invalid PostgreSQL connection URL.'); }
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || !url.hostname) {
    throw new Error('Invalid PostgreSQL connection URL.');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode && !['require', 'verify-ca', 'verify-full', ...(local ? ['disable'] : [])].includes(sslmode)) {
    throw new Error('Use a verified TLS connection for PostgreSQL.');
  }
  // Set TLS explicitly. Driver URL overrides must not replace the verified configuration.
  if (Array.from(url.searchParams.keys()).some(key => /^(ssl(?!mode$)|host|uselibpqcompat)/i.test(key))) {
    throw new Error('Use LEBEN_DATABASE_CA for a custom database certificate.');
  }
  url.searchParams.delete('sslmode');
  const useTls = !local || (sslmode && sslmode !== 'disable') || ca;
  return {
    connectionString: url.toString(),
    ssl: useTls ? { rejectUnauthorized: true, ...(ca ? { ca: ca.replace(/\\n/g, '\n') } : {}) } : false,
    max: 4,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    allowExitOnIdle: true,
    application_name: 'leben-api',
  };
}

let pool;
function getPool() {
  if (!pool) {
    pool = new Pool(poolOptions(process.env.LEBEN_DATABASE_URL, process.env.LEBEN_DATABASE_CA));
    pool.on('error', () => console.error('PostgreSQL idle connection closed.'));
  }
  return pool;
}
module.exports = { getPool, poolOptions };
