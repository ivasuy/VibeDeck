const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const { ensureSchema } = require("../src/lib/db");

function createRequest({ method = "GET", headers = {}, body } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = headers;

  process.nextTick(() => {
    if (body != null) req.emit("data", Buffer.from(body));
    req.emit("end");
  });

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

function parseResponseJson(res) {
  return JSON.parse(res.body.toString("utf8"));
}

test("GET /functions/vibedeck-sessions-live-snapshot returns current live sessions", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vd-live-snapshot-"));
  const trackerDir = path.join(root, ".vibedeck", "tracker");
  const queuePath = path.join(trackerDir, "queue.jsonl");
  const dbPath = path.join(trackerDir, "vibedeck.sqlite3");
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, "", "utf8");
  ensureSchema(dbPath);

  const now = new Date().toISOString();
  const db = new DatabaseSync(dbPath);
  db.exec(`
    INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence, override_user,
      model, total_tokens, total_cost_usd,
      created_at, updated_at
    ) VALUES (
      'codex', 'snapshot-open', '${now}', NULL, NULL,
      '/tmp', NULL, NULL, NULL,
      NULL, 'D', 'unattributed', NULL,
      'gpt-5.5', 1000, NULL,
      '${now}', '${now}'
    );
  `);
  db.close();

  const { createLocalApiHandler } = require("../src/lib/local-api");
  const handler = createLocalApiHandler({ queuePath });

  const req = createRequest({ method: "GET" });
  const res = createResponse();
  const handled = await handler(req, res, new URL("http://127.0.0.1/functions/vibedeck-sessions-live-snapshot"));

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  const payload = parseResponseJson(res);
  assert.equal(typeof payload.generated_at, "string");
  assert.equal(typeof payload.last_sync_at, "string");
  assert.equal(Array.isArray(payload.sessions), true);
  assert.equal(payload.sessions.length, 1);
  assert.equal(payload.sessions[0].session_id, "snapshot-open");
  assert.equal(payload.sessions[0].provider, "codex");
  assert.equal(payload.sessions[0].estimated_total_cost_usd > 0, true);
  assert.equal(payload.sessions[0].cost_estimated, true);

  await fs.rm(root, { recursive: true, force: true });
});

test("GET /functions/vibedeck-sessions-live-snapshot excludes ended sessions outside recent window", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vd-live-snapshot-window-"));
  const trackerDir = path.join(root, ".vibedeck", "tracker");
  const queuePath = path.join(trackerDir, "queue.jsonl");
  const dbPath = path.join(trackerDir, "vibedeck.sqlite3");
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, "", "utf8");
  ensureSchema(dbPath);

  const now = Date.now();
  const old = new Date(now - 5 * 60 * 60 * 1000).toISOString();
  const fresh = new Date(now - 10 * 60 * 1000).toISOString();
  const freshEnded = new Date(now).toISOString();

  const db = new DatabaseSync(dbPath);
  db.exec(`
    INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence, override_user,
      model, total_tokens, total_cost_usd,
      created_at, updated_at
    ) VALUES
    ('codex', 'snapshot-old', '${old}', '${old}', 'complete',
     '/tmp', NULL, NULL, NULL,
     NULL, 'D', 'unattributed', NULL,
     'gpt-5.5', 1000, NULL,
     '${old}', '${old}'),
    ('codex', 'snapshot-fresh', '${fresh}', '${freshEnded}', NULL,
     '/tmp', NULL, NULL, NULL,
     NULL, 'D', 'unattributed', NULL,
     'gpt-5.5', 1000, NULL,
     '${fresh}', '${freshEnded}');
  `);
  db.close();

  const { createLocalApiHandler } = require("../src/lib/local-api");
  const handler = createLocalApiHandler({ queuePath });
  const req = createRequest({ method: "GET" });
  const res = createResponse();
  const handled = await handler(req, res, new URL("http://127.0.0.1/functions/vibedeck-sessions-live-snapshot"));

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  const payload = parseResponseJson(res);
  const ids = payload.sessions.map((row) => row.session_id);
  assert.equal(ids.includes("snapshot-old"), false);
  assert.equal(ids.includes("snapshot-fresh"), true);

  await fs.rm(root, { recursive: true, force: true });
});

test("POST /functions/vibedeck-sessions-live-snapshot returns 405", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vd-live-snapshot-method-"));
  const trackerDir = path.join(root, ".vibedeck", "tracker");
  const queuePath = path.join(trackerDir, "queue.jsonl");
  const dbPath = path.join(trackerDir, "vibedeck.sqlite3");
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, "", "utf8");
  ensureSchema(dbPath);

  const { createLocalApiHandler } = require("../src/lib/local-api");
  const handler = createLocalApiHandler({ queuePath });
  const req = createRequest({ method: "POST" });
  const res = createResponse();
  const handled = await handler(req, res, new URL("http://127.0.0.1/functions/vibedeck-sessions-live-snapshot"));

  assert.equal(handled, true);
  assert.equal(res.statusCode, 405);

  await fs.rm(root, { recursive: true, force: true });
});
