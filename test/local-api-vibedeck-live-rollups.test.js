const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const { ensureSchema } = require("../src/lib/db");

function createRequest({ method = "GET" } = {}) {
  const req = new EventEmitter();
  req.method = method;
  process.nextTick(() => req.emit("end"));
  return req;
}

function createResponse() {
  return {
    statusCode: null,
    headers: null,
    body: Buffer.alloc(0),
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk) {
      this.body = chunk ? Buffer.from(chunk) : Buffer.alloc(0);
    },
  };
}

test("live snapshot returns backend workstreams with active and audit totals", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vd-live-rollup-api-"));
  const trackerDir = path.join(root, ".vibedeck", "tracker");
  const queuePath = path.join(trackerDir, "queue.jsonl");
  const dbPath = path.join(trackerDir, "vibedeck.sqlite3");
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, "", "utf8");
  ensureSchema(dbPath);

  const db = new DatabaseSync(dbPath);
  db.exec(`
    INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence, override_user,
      model, total_tokens, total_cost_usd, last_observed_at,
      cost_estimated, cost_quality, created_at, updated_at
    ) VALUES
    ('codex', 'past', '2026-05-12T00:00:00.000Z', '2026-05-12T00:30:00.000Z', 'complete',
     '/repo/VibeDeck', '/repo/VibeDeck', NULL, '/repo/VibeDeck',
     'main', 'A', 'high', NULL,
     'gpt-5.5', 1000, 1.25, '2026-05-12T00:30:00.000Z',
     0, 'stored', '2026-05-12T00:00:00.000Z', '2026-05-12T00:30:00.000Z'),
    ('claude', 'active', '2026-05-12T01:00:00.000Z', NULL, NULL,
     '/repo/VibeDeck', '/repo/VibeDeck', NULL, '/repo/VibeDeck',
     'feature/live', 'A', 'high', NULL,
     'claude-sonnet-4', 2000, 2.75, '${new Date().toISOString()}',
     0, 'stored', '2026-05-12T01:00:00.000Z', '${new Date().toISOString()}');
  `);
  db.close();

  const { createLocalApiHandler } = require("../src/lib/local-api");
  const handler = createLocalApiHandler({ queuePath });
  const req = createRequest();
  const res = createResponse();
  await handler(req, res, new URL("http://127.0.0.1/functions/vibedeck-sessions-live-snapshot"));

  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body.toString("utf8"));
  assert.equal(Array.isArray(payload.workstreams), true);
  assert.equal(payload.workstreams.length, 1);
  assert.equal(payload.workstreams[0].active_total_tokens, 2000);
  assert.equal(payload.workstreams[0].audit_total_tokens, 3000);
  assert.equal(payload.workstreams[0].audit_total_cost_usd, 4);
  assert.equal(payload.totals.active_tokens, 2000);
  assert.equal(payload.totals.audit_tokens, 3000);

  await fs.rm(root, { recursive: true, force: true });
});
