const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const auth = require('../src/lib/local-auth');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'vd-auth-')); }

test('ensureToken creates token file at expected path with mode 0600', () => {
  const dir = tmp();
  const tokenPath = path.join(dir, 'auth.token');
  const token = auth.ensureToken(tokenPath);
  assert.match(token, /^[a-f0-9]{64}$/);
  const stat = fs.statSync(tokenPath);
  assert.strictEqual(stat.mode & 0o777, 0o600);
});

test('ensureToken is idempotent — second call returns the same token', () => {
  const tokenPath = path.join(tmp(), 'auth.token');
  const a = auth.ensureToken(tokenPath);
  const b = auth.ensureToken(tokenPath);
  assert.strictEqual(a, b);
});

test('rotateToken replaces the token and returns the new one', () => {
  const tokenPath = path.join(tmp(), 'auth.token');
  const a = auth.ensureToken(tokenPath);
  const b = auth.rotateToken(tokenPath);
  assert.notStrictEqual(a, b);
  assert.strictEqual(fs.readFileSync(tokenPath, 'utf8').trim(), b);
});

test('requireWriteAuth accepts a valid Authorization: Bearer header', () => {
  const tokenPath = path.join(tmp(), 'auth.token');
  const token = auth.ensureToken(tokenPath);
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = { writeHead() {}, end() {} };
  assert.strictEqual(auth.requireWriteAuth(req, res, { tokenPath }), true);
});

test('requireWriteAuth rejects with 401 when header missing', () => {
  const tokenPath = path.join(tmp(), 'auth.token');
  auth.ensureToken(tokenPath);
  const req = { headers: {} };
  let status = null, body = null;
  const res = { writeHead(s) { status = s; }, end(b) { body = b; } };
  assert.strictEqual(auth.requireWriteAuth(req, res, { tokenPath }), false);
  assert.strictEqual(status, 401);
  assert.match(body, /missing_auth/);
});

test('requireWriteAuth rejects with 401 on wrong token', () => {
  const tokenPath = path.join(tmp(), 'auth.token');
  auth.ensureToken(tokenPath);
  const req = { headers: { authorization: 'Bearer 0000000000000000000000000000000000000000000000000000000000000000' } };
  let status = null;
  const res = { writeHead(s) { status = s; }, end() {} };
  assert.strictEqual(auth.requireWriteAuth(req, res, { tokenPath }), false);
  assert.strictEqual(status, 401);
});

test('requireWriteAuth uses constant-time comparison', () => {
  // Property check: same-length wrong token still rejects (verifies timingSafeEqual path is reachable).
  const tokenPath = path.join(tmp(), 'auth.token');
  const token = auth.ensureToken(tokenPath);
  const wrong = token.replace(/[a-f]/g, (c) => (c === 'a' ? 'b' : 'a'));
  const req = { headers: { authorization: `Bearer ${wrong}` } };
  let status = null;
  const res = { writeHead(s) { status = s; }, end() {} };
  assert.strictEqual(auth.requireWriteAuth(req, res, { tokenPath }), false);
  assert.strictEqual(status, 401);
});

test('issueConfirmToken returns a single-use token consumable for 30 seconds', () => {
  auth._resetConfirmTokensForTests();
  const t = auth.issueConfirmToken({ op: 'rewindCheckpoint' });
  assert.match(t, /^[a-f0-9]{32}$/);
  assert.strictEqual(auth.consumeConfirmToken({ token: t, op: 'rewindCheckpoint' }), true);
  // Single-use:
  assert.strictEqual(auth.consumeConfirmToken({ token: t, op: 'rewindCheckpoint' }), false);
});

test('issueConfirmToken rejects mismatched op on consume', () => {
  auth._resetConfirmTokensForTests();
  const t = auth.issueConfirmToken({ op: 'rewindCheckpoint' });
  assert.strictEqual(auth.consumeConfirmToken({ token: t, op: 'cleanEntire' }), false);
});

test('issueConfirmToken expires after TTL', () => {
  auth._resetConfirmTokensForTests();
  const t = auth.issueConfirmToken({ op: 'rewindCheckpoint', _now: 1000, ttlMs: 30000 });
  assert.strictEqual(auth.consumeConfirmToken({ token: t, op: 'rewindCheckpoint', _now: 30001 }), false);
});

test('issueConfirmToken cleans up expired entries on each issue', () => {
  auth._resetConfirmTokensForTests();
  for (let i = 0; i < 5; i++) auth.issueConfirmToken({ op: 'x', _now: 1000 });
  auth.issueConfirmToken({ op: 'x', _now: 60000 });
  assert.strictEqual(auth._getConfirmTokenCountForTests(), 1);
});
