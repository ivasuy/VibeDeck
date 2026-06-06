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

function insertSession({
  confidence,
  startedAt,
  endedAt,
  totalTokens = 1,
  totalCostUsd = 0,
  costQuality = "stored",
}) {
  const db = new DatabaseSync(dbPath);
  try {
    const now = "2026-05-09T00:00:00.000Z";
    db.prepare(
      `INSERT INTO vibedeck_sessions (
        provider, session_id, started_at, ended_at, end_reason,
        cwd, repo_root, repo_common_dir, parent_repo,
        branch, branch_resolution_tier, confidence, override_user,
        model, total_tokens, total_cost_usd, cost_quality,
        created_at, updated_at
      ) VALUES (
        'codex', ?, ?, ?, NULL,
        '/tmp', NULL, NULL, NULL,
        NULL, 'D', ?, NULL,
        NULL, ?, ?, ?,
        ?, ?
      );`,
    ).run(
      `s-${Math.random().toString(16).slice(2)}`,
      startedAt,
      endedAt,
      confidence,
      totalTokens,
      totalCostUsd,
      costQuality,
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

test("db checks include stable release IDs as info when DB is missing", async () => {
  const checks = await runDoctorChecks({
    runtime: { baseUrl: null },
    paths: {},
    fetch: () => Promise.resolve({}),
    dbPath: path.join(trackerDir, "missing.sqlite3"),
  });
  assert.equal(getCheck(checks, "db.canonical_completeness").status, "info");
  assert.equal(getCheck(checks, "db.session_cost_quality").status, "info");
});

test("canonical completeness is ok when positive-token sessions have bucket facts", async () => {
  ensureSchema(dbPath);
  insertSession({
    confidence: "high",
    startedAt: "2026-05-09T00:00:00.000Z",
    endedAt: "2026-05-09T00:05:00.000Z",
    totalTokens: 200,
    totalCostUsd: 1.25,
    costQuality: "stored",
  });
  const db = new DatabaseSync(dbPath);
  db.exec(
    `INSERT INTO vibedeck_session_buckets (
      provider, session_id, bucket_provider, bucket_model, bucket_hour_start, proportion
    ) VALUES (
      'codex', (SELECT session_id FROM vibedeck_sessions LIMIT 1),
      'codex', 'gpt-5.4', '2026-05-09T00:00:00.000Z', 1.0
    );`,
  );
  db.close();

  const checks = await runDoctorChecks({
    runtime: { baseUrl: null },
    paths: {},
    fetch: () => Promise.resolve({}),
    dbPath,
  });
  assert.equal(getCheck(checks, "db.canonical_completeness").status, "ok");
});

test("session cost quality warns when positive-token sessions are missing canonical cost", async () => {
  ensureSchema(dbPath);
  insertSession({
    confidence: "high",
    startedAt: "2026-05-09T00:00:00.000Z",
    endedAt: "2026-05-09T00:05:00.000Z",
    totalTokens: 300,
    totalCostUsd: null,
    costQuality: "pricing_missing",
  });
  const checks = await runDoctorChecks({
    runtime: { baseUrl: null },
    paths: {},
    fetch: () => Promise.resolve({}),
    dbPath,
  });
  assert.equal(getCheck(checks, "db.session_cost_quality").status, "warn");
});
