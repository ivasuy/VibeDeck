const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { test, beforeEach, afterEach } = require("node:test");

const { DatabaseSync } = require("node:sqlite");
const { ensureSchema } = require("../src/lib/db");
const { runDoctorChecks } = require("../src/lib/doctor");

let tmpRoot;
let trackerDir;
let dbPath;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vd-doctor-db-"));
  trackerDir = path.join(tmpRoot, ".vibedeck", "tracker");
  await fs.mkdir(trackerDir, { recursive: true });
  dbPath = path.join(trackerDir, "vibedeck.sqlite3");
});

afterEach(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
});

function getCheck(checks, id) {
  const c = checks.find((x) => x && x.id === id);
  assert.ok(c, `expected check ${id}`);
  return c;
}

function insertSession({ confidence, startedAt, endedAt }) {
  const db = new DatabaseSync(dbPath);
  try {
    const now = "2026-05-09T00:00:00.000Z";
    db.prepare(
      `INSERT INTO vibedeck_sessions (
        provider, session_id, started_at, ended_at, end_reason,
        cwd, repo_root, repo_common_dir, parent_repo,
        branch, branch_resolution_tier, confidence, override_user,
        model, total_tokens, total_cost_usd,
        created_at, updated_at
      ) VALUES (
        'codex', ?, ?, ?, NULL,
        '/tmp', NULL, NULL, NULL,
        NULL, 'D', ?, NULL,
        NULL, 1, 0.0,
        ?, ?
      );`,
    ).run(
      `s-${Math.random().toString(16).slice(2)}`,
      startedAt,
      endedAt,
      confidence,
      now,
      now,
    );
  } finally {
    db.close();
  }
}

test("attribution_distribution check reports percentages and ok status when < 25% unattributed", async () => {
  ensureSchema(dbPath);
  insertSession({ confidence: "high", startedAt: "2026-05-09T00:00:00.000Z", endedAt: null });
  insertSession({ confidence: "high", startedAt: "2026-05-09T00:10:00.000Z", endedAt: null });
  insertSession({ confidence: "medium", startedAt: "2026-05-09T00:20:00.000Z", endedAt: null });
  insertSession({ confidence: "low", startedAt: "2026-05-09T00:30:00.000Z", endedAt: null });

  const checks = await runDoctorChecks({
    runtime: { baseUrl: null },
    paths: {},
    fetch: () => Promise.resolve({}),
    dbPath,
  });
  const c = getCheck(checks, "db.attribution_distribution");
  assert.equal(c.status, "ok");
  assert.match(c.detail, /unattributed/i);
});

test("attribution_distribution check warns when > 25% unattributed", async () => {
  ensureSchema(dbPath);
  insertSession({ confidence: "unattributed", startedAt: "2026-05-09T00:00:00.000Z", endedAt: null });
  insertSession({ confidence: "high", startedAt: "2026-05-09T00:10:00.000Z", endedAt: null });
  insertSession({ confidence: "high", startedAt: "2026-05-09T00:20:00.000Z", endedAt: null });

  const checks = await runDoctorChecks({
    runtime: { baseUrl: null },
    paths: {},
    fetch: () => Promise.resolve({}),
    dbPath,
  });
  const c = getCheck(checks, "db.attribution_distribution");
  assert.equal(c.status, "warn");
});

test("db_integrity check returns ok on a healthy DB", async () => {
  ensureSchema(dbPath);
  const checks = await runDoctorChecks({
    runtime: { baseUrl: null },
    paths: {},
    fetch: () => Promise.resolve({}),
    dbPath,
  });
  const c = getCheck(checks, "db.integrity");
  assert.equal(c.status, "ok");
});

test("live_sessions_anomaly returns ok when no stale live sessions", async () => {
  ensureSchema(dbPath);
  insertSession({ confidence: "high", startedAt: "2026-05-09T00:00:00.000Z", endedAt: "2026-05-09T00:05:00.000Z" });
  const checks = await runDoctorChecks({
    runtime: { baseUrl: null },
    paths: {},
    fetch: () => Promise.resolve({}),
    dbPath,
  });
  const c = getCheck(checks, "db.live_sessions_anomaly");
  assert.equal(c.status, "ok");
});

test("live_sessions_anomaly warns when stale live sessions exist (older than 24h)", async () => {
  ensureSchema(dbPath);
  insertSession({ confidence: "high", startedAt: "2000-01-01T00:00:00.000Z", endedAt: null });
  const checks = await runDoctorChecks({
    runtime: { baseUrl: null },
    paths: {},
    fetch: () => Promise.resolve({}),
    dbPath,
  });
  const c = getCheck(checks, "db.live_sessions_anomaly");
  assert.equal(c.status, "warn");
});
