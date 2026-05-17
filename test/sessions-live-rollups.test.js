const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const { ensureSchema } = require("../src/lib/db");
const { readLiveAuditRollups, buildLiveAuditRollups } = require("../src/lib/sessions/live-rollups");

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vd-live-rollups-"));
  const dbPath = path.join(dir, "vibedeck.sqlite3");
  ensureSchema(dbPath);
  return { dir, dbPath, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function insertSession(db, row) {
  db.prepare(`
    INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence, override_user,
      model, total_tokens, total_cost_usd, last_observed_at,
      input_tokens, cached_input_tokens, cache_creation_input_tokens, output_tokens, reasoning_output_tokens,
      cost_estimated, cost_quality, created_at, updated_at
    ) VALUES (
      @provider, @session_id, @started_at, @ended_at, @end_reason,
      @cwd, @repo_root, @repo_common_dir, @parent_repo,
      @branch, @branch_resolution_tier, @confidence, NULL,
      @model, @total_tokens, @total_cost_usd, @last_observed_at,
      @input_tokens, @cached_input_tokens, @cache_creation_input_tokens, @output_tokens, @reasoning_output_tokens,
      @cost_estimated, @cost_quality, @created_at, @updated_at
    )
  `).run({
    end_reason: null,
    cwd: null,
    repo_common_dir: null,
    parent_repo: null,
    branch_resolution_tier: "A",
    confidence: "high",
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    cost_estimated: 0,
    cost_quality: "stored",
    created_at: row.started_at,
    updated_at: row.last_observed_at || row.ended_at || row.started_at,
    ...row,
  });
}

test("rollups include historical plus active cost for projects with active sessions", () => {
  const tmp = makeDb();
  try {
    const db = new DatabaseSync(tmp.dbPath);
    insertSession(db, {
      provider: "codex",
      session_id: "past-main",
      started_at: "2026-05-12T00:00:00.000Z",
      ended_at: "2026-05-12T00:20:00.000Z",
      repo_root: "/repo/VibeDeck",
      parent_repo: "/repo/VibeDeck",
      branch: "main",
      model: "gpt-5.5",
      total_tokens: 1000,
      total_cost_usd: 1.25,
      last_observed_at: "2026-05-12T00:20:00.000Z",
    });
    insertSession(db, {
      provider: "claude",
      session_id: "active-feature",
      started_at: "2026-05-12T01:00:00.000Z",
      ended_at: null,
      repo_root: "/repo/VibeDeck",
      parent_repo: "/repo/VibeDeck",
      branch: "feature/live",
      model: "claude-sonnet-4",
      total_tokens: 2000,
      total_cost_usd: 2.75,
      last_observed_at: "2026-05-12T01:10:00.000Z",
    });
    db.close();

    const payload = readLiveAuditRollups(tmp.dbPath, {
      now: "2026-05-12T01:15:00.000Z",
      idleTimeoutMin: 60,
      recentEndedMs: 60 * 60 * 1000,
    });

    assert.equal(payload.sessions.length, 2);
    assert.equal(payload.active_sessions.length, 1);
    assert.equal(payload.workstreams.length, 1);
    assert.equal(payload.workstreams[0].project_ref, "/repo/VibeDeck");
    assert.equal(payload.workstreams[0].active_total_tokens, 2000);
    assert.equal(payload.workstreams[0].active_total_cost_usd, 2.75);
    assert.equal(payload.workstreams[0].audit_total_tokens, 3000);
    assert.equal(payload.workstreams[0].audit_total_cost_usd, 4.0);
    assert.deepEqual(payload.workstreams[0].providers.map((row) => row.provider).sort(), ["claude", "codex"]);
    assert.deepEqual(payload.workstreams[0].providers.map((row) => ({
      provider: row.provider,
      session_count: row.session_count,
      active_total_tokens: row.active_total_tokens,
      audit_total_tokens: row.audit_total_tokens,
      active_total_cost_usd: row.active_total_cost_usd,
      audit_total_cost_usd: row.audit_total_cost_usd,
      active_known_cost_usd: row.active_known_cost_usd,
      audit_known_cost_usd: row.audit_known_cost_usd,
      active_cost_unknown_count: row.active_cost_unknown_count,
      audit_cost_unknown_count: row.audit_cost_unknown_count,
    })).sort((a, b) => a.provider.localeCompare(b.provider)), [
      {
        provider: "claude",
        session_count: 1,
        active_total_tokens: 2000,
        audit_total_tokens: 2000,
        active_total_cost_usd: 2.75,
        audit_total_cost_usd: 2.75,
        active_known_cost_usd: 2.75,
        audit_known_cost_usd: 2.75,
        active_cost_unknown_count: 0,
        audit_cost_unknown_count: 0,
      },
      {
        provider: "codex",
        session_count: 1,
        active_total_tokens: 0,
        audit_total_tokens: 1000,
        active_total_cost_usd: 0,
        audit_total_cost_usd: 1.25,
        active_known_cost_usd: 0,
        audit_known_cost_usd: 1.25,
        active_cost_unknown_count: 0,
        audit_cost_unknown_count: 0,
      },
    ]);
    assert.deepEqual(payload.workstreams[0].models.map((row) => ({
      model: row.model,
      session_count: row.session_count,
      active_total_tokens: row.active_total_tokens,
      audit_total_tokens: row.audit_total_tokens,
      active_total_cost_usd: row.active_total_cost_usd,
      audit_total_cost_usd: row.audit_total_cost_usd,
      active_known_cost_usd: row.active_known_cost_usd,
      audit_known_cost_usd: row.audit_known_cost_usd,
      active_cost_unknown_count: row.active_cost_unknown_count,
      audit_cost_unknown_count: row.audit_cost_unknown_count,
    })).sort((a, b) => a.model.localeCompare(b.model)), [
      {
        model: "claude-sonnet-4",
        session_count: 1,
        active_total_tokens: 2000,
        audit_total_tokens: 2000,
        active_total_cost_usd: 2.75,
        audit_total_cost_usd: 2.75,
        active_known_cost_usd: 2.75,
        audit_known_cost_usd: 2.75,
        active_cost_unknown_count: 0,
        audit_cost_unknown_count: 0,
      },
      {
        model: "gpt-5.5",
        session_count: 1,
        active_total_tokens: 0,
        audit_total_tokens: 1000,
        active_total_cost_usd: 0,
        audit_total_cost_usd: 1.25,
        active_known_cost_usd: 0,
        audit_known_cost_usd: 1.25,
        active_cost_unknown_count: 0,
        audit_cost_unknown_count: 0,
      },
    ]);
    assert.deepEqual(payload.workstreams[0].branch_groups.map((row) => row.branch).sort(), ["feature/live", "main"]);
    assert.equal(payload.totals.active_tokens, 2000);
    assert.equal(payload.totals.audit_tokens, 3000);
  } finally {
    tmp.cleanup();
  }
});

test("workstream payload keeps audit totals but only embeds active and recent sessions", () => {
  const rows = [
    {
      provider: "codex",
      session_id: "active",
      started_at: "2026-05-12T01:00:00.000Z",
      ended_at: null,
      repo_root: "/repo/VibeDeck",
      parent_repo: "/repo/VibeDeck",
      branch: "main",
      model: "gpt-5.5",
      total_tokens: 100,
      total_cost_usd: 0.1,
      last_observed_at: "2026-05-12T01:10:00.000Z",
    },
    ...Array.from({ length: 5 }, (_, index) => ({
      provider: "codex",
      session_id: `old-${index}`,
      started_at: `2026-05-11T0${index}:00:00.000Z`,
      ended_at: `2026-05-11T0${index}:20:00.000Z`,
      repo_root: "/repo/VibeDeck",
      parent_repo: "/repo/VibeDeck",
      branch: index % 2 === 0 ? "main" : "release",
      model: "gpt-5.5",
      total_tokens: 1000,
      total_cost_usd: 1,
      last_observed_at: `2026-05-11T0${index}:20:00.000Z`,
    })),
  ];

  const payload = buildLiveAuditRollups(rows, {
    now: new Date("2026-05-12T01:15:00.000Z"),
    idleTimeoutMin: 60,
    recentEndedMs: 60 * 60 * 1000,
  });

  assert.equal(payload.sessions.length, 1);
  assert.equal(payload.workstreams.length, 1);
  assert.equal(payload.workstreams[0].active_session_count, 1);
  assert.equal(payload.workstreams[0].audit_session_count, 6);
  assert.equal(payload.workstreams[0].audit_total_tokens, 5100);
  assert.deepEqual(payload.workstreams[0].sessions.map((row) => row.session_id), ["active"]);
  assert.ok(payload.workstreams[0].branch_groups.every((group) =>
    group.sessions.every((session) => session.session_id === "active"),
  ));
});

test("stored canonical zero cost remains authoritative and is not re-estimated", () => {
  const tmp = makeDb();
  try {
    const db = new DatabaseSync(tmp.dbPath);
    insertSession(db, {
      provider: "codex",
      session_id: "active-zero-stored",
      started_at: "2026-05-12T01:00:00.000Z",
      ended_at: null,
      repo_root: "/repo/VibeDeck",
      parent_repo: "/repo/VibeDeck",
      branch: "main",
      model: "gpt-5.5",
      total_tokens: 2000,
      total_cost_usd: 0,
      cost_estimated: 0,
      cost_quality: "stored",
      last_observed_at: "2026-05-12T01:10:00.000Z",
    });
    db.close();

    const payload = readLiveAuditRollups(tmp.dbPath, {
      now: "2026-05-12T01:15:00.000Z",
      idleTimeoutMin: 60,
      recentEndedMs: 60 * 60 * 1000,
    });

    assert.equal(payload.workstreams.length, 1);
    assert.equal(payload.workstreams[0].active_total_cost_usd, 0);
    assert.equal(payload.workstreams[0].audit_total_cost_usd, 0);
    assert.equal(payload.workstreams[0].active_known_cost_usd, 0);
    assert.equal(payload.workstreams[0].audit_known_cost_usd, 0);
    assert.equal(payload.workstreams[0].active_cost_unknown_count, 0);
    assert.equal(payload.workstreams[0].audit_cost_unknown_count, 0);
    assert.equal(payload.totals.active_cost_usd, 0);
    assert.equal(payload.totals.audit_cost_usd, 0);
    assert.equal(payload.sessions[0].estimated_total_cost_usd, 0);
    assert.equal(payload.sessions[0].cost_estimated, false);
    assert.equal(payload.sessions[0].cost_quality, "stored");
  } finally {
    tmp.cleanup();
  }
});

test("rollups do not attach unrelated historical projects without active sessions", () => {
  const tmp = makeDb();
  try {
    const db = new DatabaseSync(tmp.dbPath);
    insertSession(db, {
      provider: "codex",
      session_id: "old-other",
      started_at: "2026-05-12T00:00:00.000Z",
      ended_at: "2026-05-12T00:10:00.000Z",
      repo_root: "/repo/Other",
      parent_repo: "/repo/Other",
      branch: "main",
      model: "gpt-5.5",
      total_tokens: 999,
      total_cost_usd: 9.99,
      last_observed_at: "2026-05-12T00:10:00.000Z",
    });
    db.close();

    const payload = readLiveAuditRollups(tmp.dbPath, {
      now: "2026-05-12T01:15:00.000Z",
      idleTimeoutMin: 60,
      recentEndedMs: 60 * 60 * 1000,
    });

    assert.equal(payload.active_sessions.length, 0);
    assert.equal(payload.workstreams.length, 0);
    assert.equal(payload.totals.audit_tokens, 0);
  } finally {
    tmp.cleanup();
  }
});

test("provider and model groups expose unknown cost via null totals", () => {
  const payload = buildLiveAuditRollups([
    {
      provider: "codex",
      session_id: "active-known-cost",
      started_at: "2026-05-12T01:00:00.000Z",
      ended_at: null,
      repo_root: "/repo/VibeDeck",
      parent_repo: "/repo/VibeDeck",
      branch: "main",
      model: "gpt-5.5",
      total_tokens: 1000,
      total_cost_usd: 1.25,
      cost_estimated: 0,
      cost_quality: "stored",
      input_tokens: 0,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      last_observed_at: "2026-05-12T01:10:00.000Z",
      created_at: "2026-05-12T01:00:00.000Z",
      updated_at: "2026-05-12T01:10:00.000Z",
    },
    {
      provider: "codex",
      session_id: "active-unknown-cost",
      started_at: "2026-05-12T01:05:00.000Z",
      ended_at: null,
      repo_root: "/repo/VibeDeck",
      parent_repo: "/repo/VibeDeck",
      branch: "main",
      model: "unpriced-model-x",
      total_tokens: "not-a-number",
      total_cost_usd: null,
      cost_estimated: 1,
      cost_quality: "pricing_missing",
      input_tokens: null,
      cached_input_tokens: null,
      cache_creation_input_tokens: null,
      output_tokens: null,
      reasoning_output_tokens: null,
      last_observed_at: "2026-05-12T01:11:00.000Z",
      created_at: "2026-05-12T01:05:00.000Z",
      updated_at: "2026-05-12T01:11:00.000Z",
    },
  ], {
    now: "2026-05-12T01:15:00.000Z",
    idleTimeoutMin: 60,
    recentEndedMs: 60 * 60 * 1000,
  });
  const ws = payload.workstreams[0];
  assert.ok(ws);
  assert.equal(ws.providers.length, 1);
  assert.equal(ws.models.length, 2);

  const provider = ws.providers[0];
  assert.equal(provider.provider, "codex");
  assert.equal(provider.audit_total_cost_usd, null);
  assert.equal(provider.active_total_cost_usd, null);
  assert.equal(provider.audit_known_cost_usd, 1.25);
  assert.equal(provider.active_known_cost_usd, 1.25);
  assert.equal(provider.audit_cost_unknown_count, 1);
  assert.equal(provider.active_cost_unknown_count, 1);

  const unknownModel = ws.models.find((row) => row.model === "unpriced-model-x");
  assert.ok(unknownModel);
  assert.equal(unknownModel.audit_total_cost_usd, null);
  assert.equal(unknownModel.active_total_cost_usd, null);
  assert.equal(unknownModel.audit_known_cost_usd, 0);
  assert.equal(unknownModel.active_known_cost_usd, 0);
  assert.equal(unknownModel.audit_cost_unknown_count, 1);
  assert.equal(unknownModel.active_cost_unknown_count, 1);
});

test("branch groups include separate active and audit totals with breakdowns", () => {
  const payload = buildLiveAuditRollups([
    {
      provider: "codex",
      session_id: "ended-main",
      started_at: "2026-05-12T00:00:00.000Z",
      ended_at: "2026-05-12T00:30:00.000Z",
      repo_root: "/repo/VibeDeck",
      parent_repo: "/repo/VibeDeck",
      branch: "main",
      model: "gpt-5.5",
      total_tokens: 1000,
      total_cost_usd: 1.25,
      cost_estimated: 0,
      cost_quality: "stored",
      input_tokens: 0,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      last_observed_at: "2026-05-12T00:30:00.000Z",
      created_at: "2026-05-12T00:00:00.000Z",
      updated_at: "2026-05-12T00:30:00.000Z",
    },
    {
      provider: "claude",
      session_id: "active-feature",
      started_at: "2026-05-12T01:00:00.000Z",
      ended_at: null,
      repo_root: "/repo/VibeDeck",
      parent_repo: "/repo/VibeDeck",
      branch: "feature/live",
      model: "claude-sonnet-4",
      total_tokens: 2000,
      total_cost_usd: 2.75,
      cost_estimated: 0,
      cost_quality: "stored",
      input_tokens: 0,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      last_observed_at: "2026-05-12T01:10:00.000Z",
      created_at: "2026-05-12T01:00:00.000Z",
      updated_at: "2026-05-12T01:10:00.000Z",
    },
  ], {
    now: "2026-05-12T01:15:00.000Z",
    idleTimeoutMin: 60,
    recentEndedMs: 60 * 60 * 1000,
  });

  const ws = payload.workstreams[0];
  assert.ok(ws);
  assert.equal(ws.branch_groups.length, 2);

  const featureBranch = ws.branch_groups.find((row) => row.branch === "feature/live");
  const mainBranch = ws.branch_groups.find((row) => row.branch === "main");
  assert.ok(featureBranch);
  assert.ok(mainBranch);

  assert.equal(featureBranch.active_session_count, 1);
  assert.equal(featureBranch.audit_session_count, 1);
  assert.equal(featureBranch.active_total_tokens, 2000);
  assert.equal(featureBranch.audit_total_tokens, 2000);
  assert.equal(featureBranch.active_total_cost_usd, 2.75);
  assert.equal(featureBranch.audit_total_cost_usd, 2.75);

  assert.equal(mainBranch.active_session_count, 0);
  assert.equal(mainBranch.recently_completed_count, 1);
  assert.equal(mainBranch.audit_session_count, 1);
  assert.equal(mainBranch.active_total_tokens, 0);
  assert.equal(mainBranch.audit_total_tokens, 1000);
  assert.equal(mainBranch.active_total_cost_usd, 0);
  assert.equal(mainBranch.audit_total_cost_usd, 1.25);

  assert.deepEqual(featureBranch.providers, [
    {
      provider: "claude",
      session_count: 1,
      active_total_tokens: 2000,
      audit_total_tokens: 2000,
      active_total_cost_usd: 2.75,
      audit_total_cost_usd: 2.75,
      active_known_cost_usd: 2.75,
      audit_known_cost_usd: 2.75,
      active_cost_unknown_count: 0,
      audit_cost_unknown_count: 0,
    },
  ]);
  assert.deepEqual(mainBranch.models, [
    {
      model: "gpt-5.5",
      session_count: 1,
      active_total_tokens: 0,
      audit_total_tokens: 1000,
      active_total_cost_usd: 0,
      audit_total_cost_usd: 1.25,
      active_known_cost_usd: 0,
      audit_known_cost_usd: 1.25,
      active_cost_unknown_count: 0,
      audit_cost_unknown_count: 0,
    },
  ]);

  for (const row of ws.branch_groups) {
    assert.equal(typeof row.active_cost_unknown_count, "number");
    assert.equal(typeof row.audit_cost_unknown_count, "number");
    assert.ok(Array.isArray(row.providers));
    assert.ok(Array.isArray(row.models));
    assert.ok(Array.isArray(row.sessions));
  }
});

test("branch groups split one active session by canonical branch facts", () => {
  const payload = buildLiveAuditRollups([
    {
      provider: "codex",
      session_id: "active-split",
      started_at: "2026-05-12T01:00:00.000Z",
      ended_at: null,
      repo_root: "/repo/VibeDeck",
      parent_repo: "/repo/VibeDeck",
      branch: "feature/live",
      model: "gpt-5.5",
      total_tokens: 100,
      total_cost_usd: 1,
      cost_estimated: 0,
      cost_quality: "stored",
      input_tokens: 0,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      last_observed_at: "2026-05-12T01:10:00.000Z",
      created_at: "2026-05-12T01:00:00.000Z",
      updated_at: "2026-05-12T01:10:00.000Z",
    },
  ], {
    now: "2026-05-12T01:15:00.000Z",
    idleTimeoutMin: 60,
    recentEndedMs: 60 * 60 * 1000,
    branchFacts: [
      {
        provider: "codex",
        session_id: "active-split",
        scope_key: "git:/repo/VibeDeck",
        project_state: "git_existing",
        project_key: "VibeDeck",
        project_ref: "/repo/VibeDeck",
        repo_root: "/repo/VibeDeck",
        cwd: null,
        parent_repo: "/repo/VibeDeck",
        branch: "main",
        attribution_branch: "main",
        branch_kind: "known",
        branch_resolution_tier: "A",
        confidence: "high",
        model: "gpt-5.5",
        first_observed_at: "2026-05-12T01:00:00.000Z",
        last_observed_at: "2026-05-12T01:05:00.000Z",
        total_tokens: 90,
        total_cost_usd: 0.9,
        cost_estimated: 0,
        cost_quality: "stored",
      },
      {
        provider: "codex",
        session_id: "active-split",
        scope_key: "git:/repo/VibeDeck",
        project_state: "git_existing",
        project_key: "VibeDeck",
        project_ref: "/repo/VibeDeck",
        repo_root: "/repo/VibeDeck",
        cwd: null,
        parent_repo: "/repo/VibeDeck",
        branch: "feature/live",
        attribution_branch: "feature/live",
        branch_kind: "known",
        branch_resolution_tier: "A",
        confidence: "high",
        model: "gpt-5.5",
        first_observed_at: "2026-05-12T01:05:00.000Z",
        last_observed_at: "2026-05-12T01:10:00.000Z",
        total_tokens: 10,
        total_cost_usd: 0.1,
        cost_estimated: 0,
        cost_quality: "stored",
      },
    ],
  });

  const ws = payload.workstreams[0];
  assert.ok(ws);
  assert.equal(ws.audit_total_tokens, 100);

  const mainBranch = ws.branch_groups.find((row) => row.branch === "main");
  const featureBranch = ws.branch_groups.find((row) => row.branch === "feature/live");
  assert.ok(mainBranch);
  assert.ok(featureBranch);
  assert.equal(mainBranch.audit_total_tokens, 90);
  assert.equal(featureBranch.audit_total_tokens, 10);
  assert.deepEqual(ws.branches, ["feature/live", "main"]);
});

test("branch groups include session fallback rows when only some sessions have branch facts", () => {
  const payload = buildLiveAuditRollups([
    {
      provider: "codex",
      session_id: "active-fact-backed",
      started_at: "2026-05-12T01:00:00.000Z",
      ended_at: null,
      repo_root: "/repo/VibeDeck",
      parent_repo: "/repo/VibeDeck",
      branch: "feature/live",
      model: "gpt-5.5",
      total_tokens: 100,
      total_cost_usd: 1,
      cost_estimated: 0,
      cost_quality: "stored",
      input_tokens: 0,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      last_observed_at: "2026-05-12T01:10:00.000Z",
      created_at: "2026-05-12T01:00:00.000Z",
      updated_at: "2026-05-12T01:10:00.000Z",
    },
    {
      provider: "codex",
      session_id: "ended-no-facts",
      started_at: "2026-05-12T00:00:00.000Z",
      ended_at: "2026-05-12T00:30:00.000Z",
      repo_root: "/repo/VibeDeck",
      parent_repo: "/repo/VibeDeck",
      branch: "release",
      model: "gpt-5.5",
      total_tokens: 50,
      total_cost_usd: 0.5,
      cost_estimated: 0,
      cost_quality: "stored",
      input_tokens: 0,
      cached_input_tokens: 0,
      cache_creation_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      last_observed_at: "2026-05-12T00:30:00.000Z",
      created_at: "2026-05-12T00:00:00.000Z",
      updated_at: "2026-05-12T00:30:00.000Z",
    },
  ], {
    now: "2026-05-12T01:15:00.000Z",
    idleTimeoutMin: 60,
    recentEndedMs: 60 * 60 * 1000,
    branchFacts: [
      {
        provider: "codex",
        session_id: "active-fact-backed",
        scope_key: "git:/repo/VibeDeck",
        project_state: "git_existing",
        project_key: "VibeDeck",
        project_ref: "/repo/VibeDeck",
        repo_root: "/repo/VibeDeck",
        cwd: null,
        parent_repo: "/repo/VibeDeck",
        branch: "main",
        attribution_branch: "main",
        branch_kind: "known",
        branch_resolution_tier: "A",
        confidence: "high",
        model: "gpt-5.5",
        first_observed_at: "2026-05-12T01:00:00.000Z",
        last_observed_at: "2026-05-12T01:10:00.000Z",
        total_tokens: 100,
        total_cost_usd: 1,
        cost_estimated: 0,
        cost_quality: "stored",
      },
    ],
  });

  const ws = payload.workstreams[0];
  assert.ok(ws);
  assert.equal(ws.audit_total_tokens, 150);

  const mainBranch = ws.branch_groups.find((row) => row.branch === "main");
  const releaseBranch = ws.branch_groups.find((row) => row.branch === "release");
  assert.ok(mainBranch);
  assert.ok(releaseBranch);
  assert.equal(mainBranch.audit_total_tokens, 100);
  assert.equal(releaseBranch.audit_total_tokens, 50);
  assert.equal(
    ws.branch_groups.reduce((sum, row) => sum + row.audit_total_tokens, 0),
    150,
  );
  assert.deepEqual(ws.branches, ["main", "release"]);
});

test("branch groups and sessions are sorted with active-first ordering", () => {
  const payload = buildLiveAuditRollups([
    {
      provider: "codex",
      session_id: "ended-z",
      started_at: "2026-05-12T00:00:00.000Z",
      ended_at: "2026-05-12T01:00:00.000Z",
      repo_root: "/repo/VibeDeck",
      parent_repo: "/repo/VibeDeck",
      branch: "zzz-ended",
      model: "gpt-5.5",
      total_tokens: 100,
      total_cost_usd: 0.1,
      cost_estimated: 0,
      cost_quality: "stored",
      last_observed_at: "2026-05-12T01:00:00.000Z",
      created_at: "2026-05-12T00:00:00.000Z",
      updated_at: "2026-05-12T01:00:00.000Z",
    },
    {
      provider: "codex",
      session_id: "active-older",
      started_at: "2026-05-12T00:10:00.000Z",
      ended_at: null,
      repo_root: "/repo/VibeDeck",
      parent_repo: "/repo/VibeDeck",
      branch: "aaa-active",
      model: "gpt-5.5",
      total_tokens: 200,
      total_cost_usd: 0.2,
      cost_estimated: 0,
      cost_quality: "stored",
      last_observed_at: "2026-05-12T00:20:00.000Z",
      created_at: "2026-05-12T00:10:00.000Z",
      updated_at: "2026-05-12T00:20:00.000Z",
    },
    {
      provider: "codex",
      session_id: "active-newer",
      started_at: "2026-05-12T00:15:00.000Z",
      ended_at: null,
      repo_root: "/repo/VibeDeck",
      parent_repo: "/repo/VibeDeck",
      branch: "aaa-active",
      model: "gpt-5.5",
      total_tokens: 300,
      total_cost_usd: 0.3,
      cost_estimated: 0,
      cost_quality: "stored",
      last_observed_at: "2026-05-12T00:30:00.000Z",
      created_at: "2026-05-12T00:15:00.000Z",
      updated_at: "2026-05-12T00:30:00.000Z",
    },
    {
      provider: "codex",
      session_id: "ended-newest-in-active-branch",
      started_at: "2026-05-12T00:20:00.000Z",
      ended_at: "2026-05-12T01:10:00.000Z",
      repo_root: "/repo/VibeDeck",
      parent_repo: "/repo/VibeDeck",
      branch: "aaa-active",
      model: "gpt-5.5",
      total_tokens: 400,
      total_cost_usd: 0.4,
      cost_estimated: 0,
      cost_quality: "stored",
      last_observed_at: "2026-05-12T01:10:00.000Z",
      created_at: "2026-05-12T00:20:00.000Z",
      updated_at: "2026-05-12T01:10:00.000Z",
    },
  ], {
    now: "2026-05-12T01:15:00.000Z",
    idleTimeoutMin: 60,
    recentEndedMs: 60 * 60 * 1000,
  });

  const ws = payload.workstreams[0];
  assert.ok(ws);
  assert.deepEqual(ws.branch_groups.map((row) => row.branch), ["aaa-active", "zzz-ended"]);
  assert.deepEqual(ws.branch_groups[0].sessions.map((row) => row.session_id), [
    "active-newer",
    "active-older",
    "ended-newest-in-active-branch",
  ]);
});
