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

function insertSession(db, { provider, sessionId, startedAt, endedAt, confidence }) {
  const now = "2026-05-09T00:00:00.000Z";
  db.prepare(
    `INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence, override_user,
      model, total_tokens, total_cost_usd,
      created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, NULL,
      '/tmp', NULL, NULL, NULL,
      NULL, 'D', ?, NULL,
      NULL, 1, 0.0,
      ?, ?
    );`,
  ).run(provider, sessionId, startedAt, endedAt, confidence, now, now);
}

test("GET /functions/vibedeck-attribution-stats returns { high, medium, low, unattributed, total }", async () => {
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vd-attribution-stats-"));
  try {
    const trackerDir = path.join(tmpRoot, "tracker");
    await fs.mkdir(trackerDir, { recursive: true });
    const queuePath = path.join(trackerDir, "queue.jsonl");
    await fs.writeFile(queuePath, "", "utf8");

    const dbPath = path.join(trackerDir, "vibedeck.sqlite3");
    ensureSchema(dbPath);
    const db = new DatabaseSync(dbPath);
    try {
      insertSession(db, {
        provider: "codex",
        sessionId: "s1",
        startedAt: "2026-05-09T00:00:00.000Z",
        endedAt: null,
        confidence: "high",
      });
      insertSession(db, {
        provider: "codex",
        sessionId: "s2",
        startedAt: "2026-05-09T00:10:00.000Z",
        endedAt: null,
        confidence: "medium",
      });
      insertSession(db, {
        provider: "codex",
        sessionId: "s3",
        startedAt: "2026-05-09T00:20:00.000Z",
        endedAt: null,
        confidence: "low",
      });
      insertSession(db, {
        provider: "codex",
        sessionId: "s4",
        startedAt: "2026-05-09T00:30:00.000Z",
        endedAt: null,
        confidence: "unattributed",
      });
      insertSession(db, {
        provider: "codex",
        sessionId: "s5",
        startedAt: "2026-05-09T00:40:00.000Z",
        endedAt: null,
        confidence: "high",
      });
    } finally {
      db.close();
    }

    delete require.cache[require.resolve("../src/lib/local-api")];
    const { createLocalApiHandler } = require("../src/lib/local-api");
    const handler = createLocalApiHandler({ queuePath });

    const req = createRequest({ method: "GET" });
    const res = createResponse();
    const handled = await handler(
      req,
      res,
      new URL("http://127.0.0.1/functions/vibedeck-attribution-stats"),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body.toString("utf8")), {
      high: 2,
      medium: 1,
      low: 1,
      unattributed: 1,
      total: 5,
    });
  } finally {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

