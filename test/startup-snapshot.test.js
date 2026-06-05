const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const { ensureSchema } = require("../src/lib/db");
const {
  buildStartupSnapshotFromDb,
  readStartupSnapshot,
  writeStartupSnapshot,
} = require("../src/lib/startup-snapshot");
const { createLocalApiHandler } = require("../src/lib/local-api");
const { cmdSync } = require("../src/commands/sync");

const SNAPSHOT_NOW = new Date("2026-05-29T12:00:00.000Z");

function createRequest({ method = "GET" } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = { host: "127.0.0.1" };
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

async function createTracker(prefix = "vibedeck-startup-snapshot-") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const trackerDir = path.join(root, ".vibedeck", "tracker");
  const queuePath = path.join(trackerDir, "queue.jsonl");
  const dbPath = path.join(trackerDir, "vibedeck.sqlite3");
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, "", "utf8");
  ensureSchema(dbPath);
  return { root, trackerDir, queuePath, dbPath };
}

function insertSession(dbPath, row) {
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare(
      `
      INSERT INTO vibedeck_sessions (
        provider, session_id, started_at, ended_at, end_reason,
        cwd, repo_root, repo_common_dir, parent_repo,
        branch, branch_resolution_tier, confidence, override_user,
        model, total_tokens, total_cost_usd,
        input_tokens, cached_input_tokens, cache_creation_input_tokens,
        output_tokens, reasoning_output_tokens,
        last_observed_at, cost_estimated, cost_quality,
        created_at, updated_at
      ) VALUES (
        @provider, @session_id, @started_at, @ended_at, @end_reason,
        @cwd, @repo_root, NULL, NULL,
        @branch, @branch_resolution_tier, @confidence, '{}',
        @model, @total_tokens, @total_cost_usd,
        @input_tokens, 0, 0,
        @output_tokens, 0,
        @last_observed_at, 0, 'stored',
        @created_at, @updated_at
      )
      `,
    ).run({
      provider: row.provider,
      session_id: row.session_id,
      started_at: row.started_at,
      ended_at: row.ended_at ?? null,
      end_reason: row.end_reason ?? null,
      cwd: row.cwd ?? null,
      repo_root: row.repo_root ?? null,
      branch: row.branch,
      branch_resolution_tier: row.branch_resolution_tier ?? "PROVIDER_LOG",
      confidence: row.confidence ?? "high",
      model: row.model,
      total_tokens: row.total_tokens,
      total_cost_usd: row.total_cost_usd,
      input_tokens: row.input_tokens ?? row.total_tokens,
      output_tokens: row.output_tokens ?? 0,
      last_observed_at: row.last_observed_at ?? row.ended_at ?? row.started_at,
      created_at: row.created_at ?? row.started_at,
      updated_at: row.updated_at ?? row.last_observed_at ?? row.ended_at ?? row.started_at,
    });
  } finally {
    db.close();
  }
}

async function callStartupSnapshot(queuePath) {
  const handler = createLocalApiHandler({ queuePath });
  const req = createRequest();
  const res = createResponse();
  const handled = await handler(
    req,
    res,
    new URL("http://127.0.0.1/functions/vibedeck-startup-snapshot"),
  );
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  return JSON.parse(res.body.toString("utf8"));
}

test("readStartupSnapshot returns a safe empty snapshot when the file is missing", async () => {
  const { root, trackerDir } = await createTracker();
  try {
    const snapshot = readStartupSnapshot({ trackerDir, now: SNAPSHOT_NOW });

    assert.equal(snapshot.ok, true);
    assert.equal(snapshot.source, "snapshot");
    assert.equal(snapshot.fresh, false);
    assert.equal(snapshot.reason, "missing");
    assert.deepEqual(snapshot.totals, {
      today_cost_usd: 0,
      week_cost_usd: 0,
      today_tokens: 0,
      week_tokens: 0,
    });
    assert.deepEqual(snapshot.active_sessions, []);
    assert.deepEqual(snapshot.recent_sessions, []);
    assert.deepEqual(snapshot.top_providers, []);
    assert.deepEqual(snapshot.recent_projects, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("buildStartupSnapshotFromDb summarizes projection rows without changing stored branch labels", async () => {
  const { root, dbPath } = await createTracker();
  try {
    insertSession(dbPath, {
      provider: "codex",
      session_id: "active-1",
      started_at: "2026-05-29T10:00:00.000Z",
      ended_at: null,
      cwd: "/work/vibedeck",
      repo_root: "/work/vibedeck",
      branch: "Unknown branch",
      model: "gpt-5.5",
      total_tokens: 100,
      total_cost_usd: 1.25,
    });
    insertSession(dbPath, {
      provider: "claude",
      session_id: "recent-1",
      started_at: "2026-05-26T10:00:00.000Z",
      ended_at: "2026-05-26T10:30:00.000Z",
      cwd: "/work/archive",
      repo_root: "/work/archive",
      branch: "Historical unknown",
      model: "claude-sonnet-4",
      total_tokens: 50,
      total_cost_usd: 0.5,
    });
    insertSession(dbPath, {
      provider: "codex",
      session_id: "old-1",
      started_at: "2026-05-01T10:00:00.000Z",
      ended_at: "2026-05-01T10:30:00.000Z",
      cwd: "/work/old",
      repo_root: "/work/old",
      branch: "main",
      model: "gpt-5.5",
      total_tokens: 500,
      total_cost_usd: 5,
    });

    const snapshot = buildStartupSnapshotFromDb({ dbPath, now: SNAPSHOT_NOW });

    assert.equal(snapshot.ok, true);
    assert.equal(snapshot.source, "snapshot");
    assert.equal(snapshot.fresh, false);
    assert.deepEqual(snapshot.totals, {
      today_cost_usd: 1.25,
      week_cost_usd: 1.75,
      today_tokens: 100,
      week_tokens: 150,
    });
    assert.equal(snapshot.active_sessions.length, 1);
    assert.equal(snapshot.active_sessions[0].branch, "Unknown branch");
    assert.equal(snapshot.recent_sessions[0].branch, "Unknown branch");
    assert.equal(snapshot.recent_sessions[1].branch, "Historical unknown");
    assert.deepEqual(snapshot.top_providers.map((entry) => entry.provider), ["codex", "claude"]);
    assert.equal(snapshot.recent_projects[0].repo_root, "/work/vibedeck");
    assert.equal(snapshot.recent_projects[1].branch, "Historical unknown");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("GET /functions/vibedeck-startup-snapshot returns the persisted snapshot", async () => {
  const { root, trackerDir, queuePath, dbPath } = await createTracker();
  try {
    insertSession(dbPath, {
      provider: "codex",
      session_id: "api-1",
      started_at: "2026-05-29T11:00:00.000Z",
      ended_at: null,
      cwd: "/work/api",
      repo_root: "/work/api",
      branch: "api-route",
      model: "gpt-5.5",
      total_tokens: 12,
      total_cost_usd: 0.12,
    });
    await writeStartupSnapshot({ trackerDir, dbPath, now: SNAPSHOT_NOW });

    const payload = await callStartupSnapshot(queuePath);

    assert.equal(payload.ok, true);
    assert.equal(payload.source, "snapshot");
    assert.equal(payload.fresh, false);
    assert.equal(payload.active_sessions[0].session_id, "api-1");
    assert.equal(payload.totals.today_tokens, 12);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("cmdSync --auto writes a startup snapshot after a successful sync", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedeck-startup-sync-"));
  const previousEnv = {
    HOME: process.env.HOME,
    VIBEDECK_HOME: process.env.VIBEDECK_HOME,
    CODEX_HOME: process.env.CODEX_HOME,
    CODE_HOME: process.env.CODE_HOME,
    GEMINI_HOME: process.env.GEMINI_HOME,
    OPENCODE_HOME: process.env.OPENCODE_HOME,
  };

  try {
    process.env.HOME = root;
    process.env.VIBEDECK_HOME = root;
    process.env.CODEX_HOME = path.join(root, ".codex");
    process.env.CODE_HOME = path.join(root, ".code");
    process.env.GEMINI_HOME = path.join(root, ".gemini");
    process.env.OPENCODE_HOME = path.join(root, ".opencode");

    await cmdSync(["--auto"]);

    const trackerDir = path.join(root, ".vibedeck", "tracker");
    const payload = readStartupSnapshot({ trackerDir });
    assert.equal(payload.ok, true);
    assert.equal(payload.source, "snapshot");
    assert.equal(payload.fresh, false);
    assert.notEqual(payload.reason, "missing");
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});
