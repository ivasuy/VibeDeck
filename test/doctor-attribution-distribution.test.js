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

function insertCheckpointMatch({
  repoRoot = "/repo",
  groupId = "e2/abdc1ec6",
  checkpointId = "e2abdc1ec6",
  metadataPath = "e2/abdc1ec6/metadata.json",
  status = "linked",
  confidence = "exact",
  reason = null,
  candidateCount = 1,
}) {
  const db = new DatabaseSync(dbPath);
  try {
    const now = "2026-05-09T00:00:00.000Z";
    db.prepare(
      `INSERT INTO vibedeck_entire_checkpoint_matches (
        repo_root, checkpoint_group_id, checkpoint_id, metadata_path, checkpoint_tip,
        entire_session_id, agent, provider, model, branch, started_at, ended_at,
        session_provider, session_id, match_status, match_confidence, reason, candidate_count,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?);`,
    ).run(
      repoRoot,
      groupId,
      checkpointId,
      metadataPath,
      status,
      confidence,
      reason,
      candidateCount,
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
  assert.equal(getCheck(checks, "db.entire_checkpoint_coverage").status, "info");
  assert.equal(getCheck(checks, "db.entire_checkpoint_unmatched").status, "info");
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

test("entire checkpoint coverage is info with no match rows", async () => {
  ensureSchema(dbPath);
  const checks = await runDoctorChecks({
    runtime: { baseUrl: null },
    paths: {},
    fetch: () => Promise.resolve({}),
    dbPath,
  });
  assert.equal(getCheck(checks, "db.entire_checkpoint_coverage").status, "info");
});

test("entire checkpoint coverage warns below 80% and unmatched warns on ambiguous/unmatched rows", async () => {
  ensureSchema(dbPath);
  insertCheckpointMatch({
    groupId: "e2/linked",
    metadataPath: "e2/linked/metadata.json",
    status: "linked",
    confidence: "exact",
    reason: null,
    candidateCount: 1,
  });
  insertCheckpointMatch({
    groupId: "e2/ambiguous",
    metadataPath: "e2/ambiguous/metadata.json",
    status: "ambiguous",
    confidence: "ambiguous",
    reason: "multiple_matching_sessions",
    candidateCount: 2,
  });
  insertCheckpointMatch({
    groupId: "e2/unmatched",
    metadataPath: "e2/unmatched/metadata.json",
    status: "unmatched",
    confidence: "unmatched",
    reason: "no_matching_session",
    candidateCount: 0,
  });

  const checks = await runDoctorChecks({
    runtime: { baseUrl: null },
    paths: {},
    fetch: () => Promise.resolve({}),
    dbPath,
  });
  assert.equal(getCheck(checks, "db.entire_checkpoint_coverage").status, "warn");
  assert.equal(getCheck(checks, "db.entire_checkpoint_unmatched").status, "warn");
});
