const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');
const { processSessionEvent } = require('../src/lib/sessions/pipeline');
const { createLocalApiHandler } = require('../src/lib/local-api');

async function writeJsonLines(filePath, rows) {
  await fs.promises.writeFile(
    filePath,
    rows.map((row) => JSON.stringify(row)).join('\n') + '\n',
    'utf8',
  );
}

async function callEndpoint(queuePath, endpoint) {
  const handler = createLocalApiHandler({ queuePath });
  const url = new URL(`http://localhost${endpoint}`);
  const req = {
    method: 'GET',
    url: url.pathname + url.search,
    headers: { host: 'localhost' },
  };
  const chunks = [];
  const res = {
    statusCode: 200,
    setHeader() {},
    writeHead() {},
    write(chunk) {
      chunks.push(chunk);
    },
    end(body) {
      if (body) chunks.push(body);
    },
  };
  const handled = await handler(req, res, url);
  assert.ok(handled, `endpoint must be handled: ${endpoint}`);
  return JSON.parse(chunks.join(''));
}

test('usage endpoints prefer SQLite bucket facts over stale queue rows', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'vd-usage-db-first-'));
  try {
    const trackerDir = path.join(root, 'tracker');
    await fs.promises.mkdir(trackerDir, { recursive: true });
    const queuePath = path.join(trackerDir, 'queue.jsonl');
    const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
    await writeJsonLines(queuePath, [
      {
        source: 'cursor',
        model: 'auto',
        hour_start: '2026-05-11T09:00:00.000Z',
        input_tokens: 999,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: 1,
        reasoning_output_tokens: 0,
        total_tokens: 1000,
        conversation_count: 1,
      },
    ]);

    ensureSchema(dbPath);
    await processSessionEvent(dbPath, {
      kind: 'start',
      provider: 'codex',
      session_id: 's-db-first',
      started_at: '2026-05-11T09:00:00.000Z',
      cwd: root,
      model: 'gpt-5.4',
    });
    await processSessionEvent(dbPath, {
      kind: 'update',
      provider: 'codex',
      session_id: 's-db-first',
      observed_at: '2026-05-11T09:01:00.000Z',
      delta_tokens: 120,
      input_tokens: 100,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 20,
      reasoning_output_tokens: 0,
      conversation_count: 1,
      cwd: root,
      model: 'gpt-5.4',
    });

    const summary = await callEndpoint(
      queuePath,
      `/functions/${["token", "tracker"].join("")}-usage-summary?from=2026-05-11&to=2026-05-11&tz=UTC`,
    );
    assert.equal(summary.totals.total_tokens, 120);

    const breakdown = await callEndpoint(
      queuePath,
      `/functions/${["token", "tracker"].join("")}-usage-model-breakdown?from=2026-05-11&to=2026-05-11&tz=UTC`,
    );
    assert.deepEqual(breakdown.sources.map((entry) => entry.source), ['codex']);
    assert.equal(breakdown.sources[0].models[0].model, 'gpt-5.4');
    assert.equal(breakdown.sources[0].models[0].totals.total_tokens, 120);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});
