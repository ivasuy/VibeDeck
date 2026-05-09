'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function _writeTokenFile(tokenPath, token) {
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  // Open with mode 0600 from creation. Some umasks would otherwise widen perms.
  const fd = fs.openSync(tokenPath, 'w', 0o600);
  try {
    fs.writeSync(fd, `${token}\n`);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(tokenPath, 0o600);
}

function _readTokenFile(tokenPath) {
  return fs.readFileSync(tokenPath, 'utf8').trim();
}

function ensureToken(tokenPath) {
  if (fs.existsSync(tokenPath)) return _readTokenFile(tokenPath);
  const token = crypto.randomBytes(32).toString('hex');
  _writeTokenFile(tokenPath, token);
  return token;
}

function rotateToken(tokenPath) {
  const token = crypto.randomBytes(32).toString('hex');
  _writeTokenFile(tokenPath, token);
  return token;
}

function _writeError(res, status, errorCode, message) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: errorCode, message }));
}

function requireWriteAuth(req, res, { tokenPath } = {}) {
  if (!tokenPath) throw new Error('requireWriteAuth: tokenPath required');
  const expected = _readTokenFile(tokenPath);
  const header = String((req.headers && req.headers.authorization) || '');
  const m = header.match(/^Bearer\s+([a-f0-9]+)$/i);
  if (!m) {
    _writeError(res, 401, 'missing_auth', 'Authorization: Bearer <token> required');
    return false;
  }
  const provided = m[1];
  const a = Buffer.from(provided, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    _writeError(res, 401, 'invalid_auth', 'Token does not match');
    return false;
  }
  return true;
}

module.exports = { ensureToken, rotateToken, requireWriteAuth };
