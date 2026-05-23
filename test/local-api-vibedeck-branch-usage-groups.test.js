'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');
const { queryBranchUsage } = require('../src/lib/branch-usage');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-branch-groups-'));
  const dbPath = path.join(dir, 'vibedeck.sqlite3');
  ensureSchema(dbPath);
  return { dir, dbPath, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function insertFact(db, row) {
  db.prepare(`
    INSERT INTO vibedeck_branch_usage_facts (
      provider, session_id, scope_key, project_state, project_key, project_ref,
      cwd, repo_root, branch, attribution_branch, branch_kind,
      branch_resolution_tier, confidence, model, first_observed_at, last_observed_at,
      event_count, total_tokens, input_tokens, cached_input_tokens, cache_creation_input_tokens,
      output_tokens, reasoning_output_tokens, conversation_count, total_cost_usd,
      cost_estimated, cost_quality, token_reconciled, cost_reconciled, created_at, updated_at
    ) VALUES (
      @provider, @session_id, @scope_key, 'git_existing', 'repo', '/repo',
      '/repo', '/repo', @branch, @attribution_branch, @branch_kind,
      @branch_resolution_tier, @confidence, @model, @first_observed_at, @last_observed_at,
      1, @total_tokens, 0, 0, 0,
      @total_tokens, 0, 1, @total_cost_usd,
      0, 'stored', 0, 0, @first_observed_at, @last_observed_at
    )
  `).run({
    provider: 'codex',
    session_id: 'session',
    scope_key: 'session',
    branch: 'release/0.1.3',
    attribution_branch: row?.branch || 'release/0.1.3',
    branch_kind: 'known',
    branch_resolution_tier: 'PROVIDER_LOG',
    confidence: 'high',
    model: 'gpt-5.5',
    first_observed_at: '2026-05-23T10:00:00.000Z',
    last_observed_at: '2026-05-23T10:10:00.000Z',
    total_tokens: 100,
    total_cost_usd: 0.01,
    ...row,
  });
}

function insertEdge(db, row) {
  db.prepare(`
    INSERT INTO vibedeck_session_group_edges (
      provider, session_group_id, root_session_id, child_session_id,
      root_thread_id, child_thread_id, relation_proof, depth,
      agent_id, agent_label, agent_role, source_path, created_at, updated_at
    ) VALUES (
      @provider, @session_group_id, @root_session_id, @child_session_id,
      @root_thread_id, @child_thread_id, @relation_proof, @depth,
      @agent_id, @agent_label, @agent_role, @source_path, @created_at, @updated_at
    )
  `).run({
    root_thread_id: null,
    child_thread_id: null,
    relation_proof: 'codex_thread_spawn',
    depth: 1,
    agent_id: null,
    agent_label: 'Curie',
    agent_role: 'reviewer',
    source_path: null,
    created_at: '2026-05-23T10:00:00.000Z',
    updated_at: '2026-05-23T10:00:00.000Z',
    ...row,
  });
}

test('branch usage adds group cards in preview mode without changing totals', () => {
  const tmp = makeDb();
  try {
    const db = new DatabaseSync(tmp.dbPath);
    insertFact(db, { provider: 'codex', session_id: 'root', total_tokens: 100, total_cost_usd: 0.10 });
    insertFact(db, { provider: 'codex', session_id: 'child', total_tokens: 50, total_cost_usd: 0.05 });
    insertEdge(db, {
      provider: 'codex',
      session_group_id: 'codex:root',
      root_session_id: 'root',
      child_session_id: 'child',
    });
    db.close();

    const raw = queryBranchUsage(tmp.dbPath, { includeSessions: true, includeUnattributed: true }, { groupingMode: 'shadow' });
    const grouped = queryBranchUsage(tmp.dbPath, { includeSessions: true, includeUnattributed: true }, { groupingMode: 'preview' });
    assert.equal(raw.totals.total_tokens, grouped.totals.total_tokens);
    assert.equal(raw.repos[0].branches[0].total_tokens, grouped.repos[0].branches[0].total_tokens);
    assert.equal(raw.repos[0].branches[0].session_groups, undefined);

    const branch = grouped.repos[0].branches[0];
    assert.equal(branch.sessions.length, 2);
    assert.equal(branch.session_groups.length, 1);
    assert.equal(branch.session_groups[0].member_count, 2);
    assert.equal(branch.session_groups[0].total_tokens, 150);
    assert.equal(branch.session_groups[0].total_cost_usd, 0.15);
    assert.equal(branch.sessions.find((row) => row.session_id === 'root').group_role, 'root');
    assert.equal(branch.sessions.find((row) => row.session_id === 'child').group_role, 'child');
  } finally {
    tmp.cleanup();
  }
});

test('branch usage keeps unknown child branch separate and does not inherit root branch', () => {
  const tmp = makeDb();
  try {
    const db = new DatabaseSync(tmp.dbPath);
    insertFact(db, { provider: 'codex', session_id: 'root', branch: 'main', total_tokens: 100, total_cost_usd: 0.10 });
    insertFact(db, {
      provider: 'codex',
      session_id: 'child',
      branch: 'Historical unknown',
      attribution_branch: null,
      branch_kind: 'unknown',
      confidence: 'unattributed',
      total_tokens: 50,
      total_cost_usd: 0.05,
    });
    insertEdge(db, {
      provider: 'codex',
      session_group_id: 'codex:root',
      root_session_id: 'root',
      child_session_id: 'child',
    });
    db.close();

    const grouped = queryBranchUsage(tmp.dbPath, { includeSessions: true, includeUnattributed: true }, { groupingMode: 'preview' });
    const branches = grouped.repos.flatMap((repo) => repo.branches.map((branch) => branch.branch));
    assert.ok(branches.includes('main'));
    assert.ok(branches.includes('Historical unknown'));
    const unknownBranch = grouped.repos.flatMap((repo) => repo.branches).find((branch) => branch.branch === 'Historical unknown');
    assert.equal(unknownBranch.sessions[0].session_id, 'child');
    assert.equal(unknownBranch.sessions[0].branch, undefined);
  } finally {
    tmp.cleanup();
  }
});

test('branch usage can read grouping mode from context env', () => {
  const tmp = makeDb();
  const previous = process.env.VIBEDECK_SESSION_GROUPING_V1;
  try {
    process.env.VIBEDECK_SESSION_GROUPING_V1 = 'shadow';
    const db = new DatabaseSync(tmp.dbPath);
    insertFact(db, { provider: 'codex', session_id: 'root', total_tokens: 100, total_cost_usd: 0.10 });
    insertFact(db, { provider: 'codex', session_id: 'child', total_tokens: 50, total_cost_usd: 0.05 });
    insertEdge(db, {
      provider: 'codex',
      session_group_id: 'codex:root',
      root_session_id: 'root',
      child_session_id: 'child',
    });
    db.close();

    const grouped = queryBranchUsage(
      tmp.dbPath,
      { includeSessions: true, includeUnattributed: true },
      { env: { VIBEDECK_SESSION_GROUPING_V1: 'preview' } },
    );
    assert.equal(grouped.repos[0].branches[0].session_groups.length, 1);
  } finally {
    if (previous == null) delete process.env.VIBEDECK_SESSION_GROUPING_V1;
    else process.env.VIBEDECK_SESSION_GROUPING_V1 = previous;
    tmp.cleanup();
  }
});
