const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs/promises');
const fssync = require('node:fs');
const http = require('node:http');
const cp = require('node:child_process');
const { once } = require('node:events');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');
const { DatabaseSync } = require('node:sqlite');
function buildSessionMetaLine({ model, cwd }) {
  const payload = { model };
  if (typeof cwd === 'string' && cwd.length > 0) payload.cwd = cwd;
  return JSON.stringify({ type: 'session_meta', payload });
}

function buildTokenCountLine({ ts, last, total }) {
  return JSON.stringify({
    type: 'event_msg',
    timestamp: ts,
    payload: {
      type: 'token_count',
      info: { last_token_usage: last, total_token_usage: total },
    },
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const s = http.createServer(() => {});
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function parseSseEvents(buffer) {
  const out = [];
  const parts = buffer.split('\n\n');
  const keep = parts.pop() || '';
  for (const part of parts) {
    const lines = part.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) out.push(JSON.parse(line.slice('data: '.length)));
    }
  }
  return { events: out, rest: keep };
}

async function startServe({ home, port }) {
  const child = cp.spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'vibedeck.js'), 'serve', '--no-open', '--port', String(port)], {
    env: { ...process.env, HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  let out = '';
  child.stdout.on('data', (c) => (out += c));
  child.stderr.on('data', (c) => (out += c));

  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/api/local-auth`, (res) => {
          res.resume();
          res.on('end', resolve);
        });
        req.on('error', reject);
      });
      return { child, out };
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  child.kill('SIGKILL');
  throw new Error(`serve did not start. output:\n${out}`);
}

async function stopServe(child) {
  if (!child) return;
  child.kill('SIGTERM');
  await Promise.race([
    once(child, 'close'),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
  if (!child.killed) child.kill('SIGKILL');
}

async function connectSse(url) {
  const req = http.get(url, { headers: { Accept: 'text/event-stream' } });
  const res = await once(req, 'response').then(([r]) => r);
  assert.equal(res.statusCode, 200);
  res.setEncoding('utf8');
  return { req, res };
}

async function waitForEvent(events, predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = events.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('timed out waiting for SSE event');
}

test('serve pipeline emits SSE session events for new rollout', { timeout: 30_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vibedeck-serve-pipe-'));
  const home = root;
  const trackerDir = path.join(home, '.vibedeck', 'tracker');
  const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');

  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(path.join(trackerDir, 'cursors.json'), JSON.stringify({ version: 1, files: {}, updatedAt: null }), 'utf8');
  await fs.writeFile(path.join(trackerDir, 'queue.jsonl'), '', 'utf8');
  ensureSchema(dbPath);

  // Create a repo so repo resolution can attach repo_root.
  const repoRoot = path.join(root, 'repo');
  await fs.mkdir(repoRoot, { recursive: true });
  cp.execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
  await fs.writeFile(path.join(repoRoot, 'a.txt'), 'hi', 'utf8');
  cp.execFileSync('git', ['add', '.'], { cwd: repoRoot, stdio: 'ignore' });
  cp.execFileSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=test', 'commit', '-m', 'init'], { cwd: repoRoot, stdio: 'ignore' });

  const port = await getFreePort();
  const { child } = await startServe({ home, port });

  try {
    const sse = await connectSse(`http://127.0.0.1:${port}/functions/vibedeck-sessions-live`);
    const got = [];
    let buf = '';
    sse.res.on('data', (chunk) => {
      buf += chunk;
      const parsed = parseSseEvents(buf);
      buf = parsed.rest;
      for (const e of parsed.events) got.push(e);
    });
    await waitForEvent(got, (event) => event.type === 'snapshot', 10_000);

    const dayDir = path.join(home, '.codex', 'sessions', '2026', '05', '09');
    await fs.mkdir(dayDir, { recursive: true });
    const rolloutPath = path.join(dayDir, 'rollout-test.jsonl');
    const usage = {
      input_tokens: 10,
      cached_input_tokens: 0,
      output_tokens: 5,
      reasoning_output_tokens: 0,
      total_tokens: 15,
    };
    const lines = [
      buildSessionMetaLine({ model: 'gpt-5.2', cwd: repoRoot }),
      buildTokenCountLine({ ts: new Date().toISOString(), last: usage, total: usage }),
    ];
    await fs.writeFile(rolloutPath, lines.join('\n') + '\n', 'utf8');

    const update = await waitForEvent(
      got,
      (e) => e.type === 'session:update' && e.provider === 'codex' && typeof e.session_id === 'string',
      10_000,
    );
    assert.ok(update.total_tokens > 0);
    assert.ok(typeof update.confidence === 'string');
    sse.req.destroy();
    sse.res.destroy();
  } finally {
    await stopServe(child);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('sync reaper ends stale live sessions', { timeout: 30_000 }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vibedeck-sync-reap-'));
  const home = root;
  const trackerDir = path.join(home, '.vibedeck', 'tracker');
  const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(path.join(trackerDir, 'cursors.json'), JSON.stringify({ version: 1, files: {}, updatedAt: null }), 'utf8');
  await fs.writeFile(path.join(trackerDir, 'queue.jsonl'), '', 'utf8');
  ensureSchema(dbPath);

  const staleAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare(
      `INSERT INTO vibedeck_sessions (
        provider, session_id, started_at, ended_at, end_reason,
        cwd, repo_root, repo_common_dir, parent_repo,
        branch, branch_resolution_tier, confidence, override_user,
        model, total_tokens, total_cost_usd,
        created_at, updated_at
      ) VALUES (
        'codex', 'stale-1', @started_at, NULL, NULL,
        NULL, NULL, NULL, NULL,
        NULL, 'D', 'unattributed', NULL,
        NULL, 0, 0.0,
        @started_at, @started_at
      )`,
    ).run({ started_at: staleAt });
  } finally {
    db.close();
  }

  const child = cp.spawn(process.execPath, [path.join(__dirname, '..', 'bin', 'vibedeck.js'), 'sync', '--auto'], {
    env: { ...process.env, HOME: home, VIBEDECK_IDLE_TIMEOUT_MIN: '30' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await once(child, 'close');

  const db2 = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db2.prepare('SELECT ended_at, end_reason FROM vibedeck_sessions WHERE provider = ? AND session_id = ?').get('codex', 'stale-1');
    assert.ok(row.ended_at);
    assert.equal(row.end_reason, 'orphan_reaped');
  } finally {
    db2.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
