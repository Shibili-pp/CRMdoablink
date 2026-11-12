function listedOrigins() {
  return (process.env.CLIENT_URL || 'http://localhost:5173')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (listedOrigins().includes(origin)) return true;
  let url;
  try {
    url = new URL(origin);
  } catch (error) {
    return false;
  }
  if (url.protocol === 'http:' && url.hostname === 'localhost') return true;
  return url.protocol === 'https:' && url.hostname.endsWith('.pages.dev');
}

function corsOrigin(origin, callback) {
  callback(null, isAllowedOrigin(origin));
}

module.exports = { corsOrigin, isAllowedOrigin };
