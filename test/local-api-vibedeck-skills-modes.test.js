'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const auth = require('../src/lib/local-auth');

async function startLocalApiServer({ queuePath }) {
  const { createLocalApiHandler } = require('../src/lib/local-api');
  const handler = createLocalApiHandler({ queuePath });

  const sockets = new Set();
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const handled = await handler(req, res, url);
    if (handled) return;
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : null;
  if (!port) throw new Error('failed to bind test server');

  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      for (const socket of sockets) socket.destroy();
      server.close();
      await once(server, 'close');
    },
  };
}

async function postJson(baseUrl, pathname, body, headers = {}) {
  const payload = JSON.stringify(body ?? {});
  const req = http.request(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(payload),
      ...headers,
    },
  });
  req.end(payload);
  const [res] = await once(req, 'response');
  res.setEncoding('utf8');
  let buf = '';
  for await (const chunk of res) buf += chunk;
  let jsonBody = null;
  try {
    jsonBody = buf ? JSON.parse(buf) : null;
  } catch {
    jsonBody = null;
  }
  return { statusCode: res.statusCode, body: jsonBody };
}

async function getJson(baseUrl, pathname) {
  const req = http.request(`${baseUrl}${pathname}`, { method: 'GET' });
  req.end();
  const [res] = await once(req, 'response');
  res.setEncoding('utf8');
  let buf = '';
  for await (const chunk of res) buf += chunk;
  return { statusCode: res.statusCode, body: buf ? JSON.parse(buf) : null };
}

test('GET /functions/vibedeck-skills supports installed and repos modes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-skills-modes-'));
  const queuePath = path.join(root, 'tracker', 'queue.jsonl');
  await fs.mkdir(path.dirname(queuePath), { recursive: true });
  await fs.writeFile(queuePath, '', 'utf8');
  const srv = await startLocalApiServer({ queuePath });
  try {
    const installedRes = await getJson(srv.baseUrl, '/functions/vibedeck-skills?mode=installed');
    assert.equal(installedRes.statusCode, 200);
    const installed = installedRes.body;
    assert.ok(Array.isArray(installed.skills));
    assert.ok(Array.isArray(installed.targets));

    const installedPageRes = await getJson(srv.baseUrl, '/functions/vibedeck-skills?mode=installed&limit=1&offset=0&q=');
    assert.equal(installedPageRes.statusCode, 200);
    assert.ok(Array.isArray(installedPageRes.body.skills));
    assert.ok(installedPageRes.body.skills.length <= 1);
    assert.equal(installedPageRes.body.offset, 0);
    assert.equal(installedPageRes.body.limit, 1);
    assert.equal(typeof installedPageRes.body.totalCount, 'number');
    assert.ok(Array.isArray(installedPageRes.body.installedKeys));

    const reposRes = await getJson(srv.baseUrl, '/functions/vibedeck-skills?mode=repos');
    assert.equal(reposRes.statusCode, 200);
    const repos = reposRes.body;
    assert.ok(Array.isArray(repos.repos));
  } finally {
    await srv.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('POST /functions/vibedeck-skills/addRepo and removeRepo are auth-gated', async () => {
  const originalFetch = global.fetch;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-skills-repo-'));
  const queuePath = path.join(root, 'tracker', 'queue.jsonl');
  await fs.mkdir(path.dirname(queuePath), { recursive: true });
  await fs.writeFile(queuePath, '', 'utf8');
  const token = auth.ensureToken(path.join(root, 'auth.token'));
  const srv = await startLocalApiServer({ queuePath });
  try {
    global.fetch = async (url) => {
      const href = String(url);
      if (href.includes('/git/trees/')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ tree: [] }),
        };
      }
      throw new Error(`unexpected fetch: ${href}`);
    };

    const unauthorized = await postJson(srv.baseUrl, '/functions/vibedeck-skills/addRepo', {
      repo: { owner: 'owner', name: 'repo', branch: 'main' },
    });
    assert.equal(unauthorized.statusCode, 401);

    const added = await postJson(
      srv.baseUrl,
      '/functions/vibedeck-skills/addRepo',
      { repo: { owner: 'owner', name: 'repo', branch: 'main' } },
      { Authorization: `Bearer ${token}` },
    );
    assert.equal(added.statusCode, 200);
    assert.equal(added.body.repo.owner, 'owner');

    const removed = await postJson(
      srv.baseUrl,
      '/functions/vibedeck-skills/removeRepo',
      { owner: 'owner', name: 'repo' },
      { Authorization: `Bearer ${token}` },
    );
    assert.equal(removed.statusCode, 200);
    assert.equal(removed.body.ok, true);
  } finally {
    global.fetch = originalFetch;
    await srv.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
