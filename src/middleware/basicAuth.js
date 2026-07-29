const crypto = require('crypto');

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function basicAuth(req, res, next) {
  const user = process.env.DASHBOARD_USER;
  const pass = process.env.DASHBOARD_PASS;

  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [reqUser, reqPass] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
    if (reqUser && reqPass && safeEqual(reqUser, user) && safeEqual(reqPass, pass)) {
      return next();
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="Dashboard de funnel"');
  res.status(401).send('Autenticación requerida.');
}

module.exports = basicAuth;
