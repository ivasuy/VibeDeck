const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');
const pricing = require('../src/lib/pricing');
const {
  rebuildBranchUsageFactsForSession,
  readBranchUsageFactRows,
} = require('../src/lib/sessions/branch-usage-facts');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-branch-facts-enriched-'));
  const dbPath = path.join(dir, 'vibedeck.sqlite3');
  ensureSchema(dbPath);
  return {
    dir,
    dbPath,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

function initGitRepo(repoRoot) {
  fs.mkdirSync(repoRoot, { recursive: true });
  execFileSync('git', ['init', '-b', 'main'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'vibedeck@example.test'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'VibeDeck Test'], { cwd: repoRoot, stdio: 'ignore' });
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'test\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['branch', 'feature/enriched'], { cwd: repoRoot, stdio: 'ignore' });
}

function insertSession(db, row) {
  db.prepare(`
    INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence, override_user,
      model, total_tokens, total_cost_usd, last_observed_at,
      input_tokens, cached_input_tokens, cache_creation_input_tokens,
      cache_creation_5m_input_tokens, cache_creation_1h_input_tokens,
      output_tokens, reasoning_output_tokens,
      web_search_requests, tool_call_count, tools_json, activity_json,
      cost_estimated, cost_quality, created_at, updated_at
    ) VALUES (
      @provider, @session_id, @started_at, @ended_at, NULL,
      @cwd, @repo_root, NULL, NULL,
      @branch, @branch_resolution_tier, @confidence, NULL,
      @model, @total_tokens, @total_cost_usd, @last_observed_at,
      @input_tokens, @cached_input_tokens, @cache_creation_input_tokens,
      @cache_creation_5m_input_tokens, @cache_creation_1h_input_tokens,
      @output_tokens, @reasoning_output_tokens,
      @web_search_requests, @tool_call_count, @tools_json, @activity_json,
      @cost_estimated, @cost_quality, @started_at, @last_observed_at
    )
  `).run({
    branch: null,
    branch_resolution_tier: 'D',
    confidence: 'unattributed',
    total_cost_usd: null,
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_creation_5m_input_tokens: 0,
    cache_creation_1h_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    web_search_requests: 0,
    tool_call_count: 0,
    tools_json: null,
    activity_json: null,
    cost_estimated: 1,
    cost_quality: 'partial_unknown',
    ...row,
  });
}

function insertEvent(db, row) {
  db.prepare(`
    INSERT INTO vibedeck_session_events (
      provider, session_id, event_key, kind, observed_at,
      started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence,
      model, delta_tokens, input_tokens, cached_input_tokens,
      cache_creation_input_tokens, cache_creation_5m_input_tokens, cache_creation_1h_input_tokens,
      output_tokens, reasoning_output_tokens,
      web_search_requests, tool_call_count, tools_json, activity_json,
      conversation_count, total_tokens, created_at
    ) VALUES (
      @provider, @session_id, @event_key, 'update', @observed_at,
      NULL, NULL, NULL,
      @cwd, @repo_root, NULL, NULL,
      @branch, @branch_resolution_tier, @confidence,
      @model, @delta_tokens, @input_tokens, @cached_input_tokens,
      @cache_creation_input_tokens, @cache_creation_5m_input_tokens, @cache_creation_1h_input_tokens,
      @output_tokens, @reasoning_output_tokens,
      @web_search_requests, @tool_call_count, @tools_json, @activity_json,
      @conversation_count, @total_tokens, @observed_at
    )
  `).run({
    branch: null,
    branch_resolution_tier: null,
    confidence: null,
    delta_tokens: null,
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_creation_5m_input_tokens: 0,
    cache_creation_1h_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    web_search_requests: 0,
    tool_call_count: 0,
    tools_json: null,
    activity_json: null,
    conversation_count: 0,
    total_tokens: null,
    ...row,
  });
}

test('branch usage event groups preserve known branches while carrying enrichment into exact cost', async () => {
  const tmp = makeDb();
  try {
    const repoRoot = path.join(tmp.dir, 'repo');
    initGitRepo(repoRoot);

    const db = new DatabaseSync(tmp.dbPath);
    try {
      insertSession(db, {
        provider: 'claude',
        session_id: 'event-enriched',
        started_at: '2026-05-18T10:00:00.000Z',
        ended_at: '2026-05-18T10:05:00.000Z',
        cwd: repoRoot,
        repo_root: repoRoot,
        model: 'claude-opus-4-7',
        total_tokens: 170,
        last_observed_at: '2026-05-18T10:05:00.000Z',
      });
      insertEvent(db, {
        provider: 'claude',
        session_id: 'event-enriched',
        event_key: 'e1',
        observed_at: '2026-05-18T10:01:00.000Z',
        cwd: repoRoot,
        repo_root: repoRoot,
        branch: 'feature/enriched',
        model: 'claude-opus-4-7',
        delta_tokens: 100,
        input_tokens: 40,
        cached_input_tokens: 10,
        cache_creation_input_tokens: 30,
        cache_creation_5m_input_tokens: 10,
        cache_creation_1h_input_tokens: 20,
        output_tokens: 20,
        web_search_requests: 1,
        tool_call_count: 2,
        tools_json: JSON.stringify({ Read: 1, WebSearch: 1 }),
        activity_json: JSON.stringify({ reading: 1, research: 1 }),
        conversation_count: 1,
      });
      insertEvent(db, {
        provider: 'claude',
        session_id: 'event-enriched',
        event_key: 'e2',
        observed_at: '2026-05-18T10:03:00.000Z',
        cwd: repoRoot,
        repo_root: repoRoot,
        branch: 'feature/enriched',
        model: 'claude-opus-4-7',
        delta_tokens: 70,
        input_tokens: 20,
        cached_input_tokens: 5,
        cache_creation_input_tokens: 25,
        cache_creation_5m_input_tokens: 5,
        cache_creation_1h_input_tokens: 20,
        output_tokens: 20,
        web_search_requests: 2,
        tool_call_count: 1,
        tools_json: JSON.stringify({ WebSearch: 2 }),
        activity_json: JSON.stringify({ research: 2 }),
        conversation_count: 1,
      });

      await rebuildBranchUsageFactsForSession(db, {
        dbPath: tmp.dbPath,
        provider: 'claude',
        session_id: 'event-enriched',
      });
    } finally {
      db.close();
    }

    const rows = readBranchUsageFactRows(tmp.dbPath, { includeArchived: true });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].branch, 'feature/enriched');
    assert.equal(rows[0].attribution_branch, 'feature/enriched');
    assert.equal(rows[0].branch_kind, 'known');
    assert.equal(rows[0].total_tokens, 170);
    assert.equal(rows[0].cache_creation_input_tokens, 55);
    assert.equal(rows[0].cache_creation_5m_input_tokens, 15);
    assert.equal(rows[0].cache_creation_1h_input_tokens, 40);
    assert.equal(rows[0].web_search_requests, 3);
    assert.equal(rows[0].tool_call_count, 3);
    assert.deepEqual(JSON.parse(rows[0].tools_json), { Read: 1, WebSearch: 3 });
    assert.deepEqual(JSON.parse(rows[0].activity_json), { reading: 1, research: 3 });
    assert.equal(rows[0].cost_quality, 'token_buckets');
    assert.equal(rows[0].cost_estimated, 0);
    assert.equal(rows[0].total_cost_usd, pricing.computeEnhancedRowCost({
      source: 'claude',
      model: 'claude-opus-4-7',
      total_tokens: 170,
      input_tokens: 60,
      cached_input_tokens: 15,
      cache_creation_input_tokens: 55,
      cache_creation_5m_input_tokens: 15,
      cache_creation_1h_input_tokens: 40,
      output_tokens: 40,
      reasoning_output_tokens: 0,
      web_search_requests: 3,
    }));
  } finally {
    tmp.cleanup();
  }
});

test('branch usage event groups bill web-search-only numeric requests without tools_json inference', async () => {
  const tmp = makeDb();
  try {
    const repoRoot = path.join(tmp.dir, 'repo');
    initGitRepo(repoRoot);

    const db = new DatabaseSync(tmp.dbPath);
    try {
      insertSession(db, {
        provider: 'claude',
        session_id: 'web-only-event',
        started_at: '2026-05-18T10:00:00.000Z',
        ended_at: '2026-05-18T10:05:00.000Z',
        cwd: repoRoot,
        repo_root: repoRoot,
        model: 'claude-opus-4-7',
        total_tokens: 0,
        last_observed_at: '2026-05-18T10:05:00.000Z',
      });
      insertEvent(db, {
        provider: 'claude',
        session_id: 'web-only-event',
        event_key: 'e1',
        observed_at: '2026-05-18T10:01:00.000Z',
        cwd: repoRoot,
        repo_root: repoRoot,
        branch: 'feature/enriched',
        model: 'claude-opus-4-7',
        delta_tokens: 0,
        web_search_requests: 2,
        tool_call_count: 5,
        tools_json: JSON.stringify({ WebSearch: 99 }),
        activity_json: JSON.stringify({ research: 99 }),
      });

      await rebuildBranchUsageFactsForSession(db, {
        dbPath: tmp.dbPath,
        provider: 'claude',
        session_id: 'web-only-event',
      });
    } finally {
      db.close();
    }

    const rows = readBranchUsageFactRows(tmp.dbPath, { includeArchived: true });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].branch, 'feature/enriched');
    assert.equal(rows[0].branch_kind, 'known');
    assert.equal(rows[0].total_tokens, 0);
    assert.equal(rows[0].web_search_requests, 2);
    assert.equal(rows[0].tool_call_count, 5);
    assert.deepEqual(JSON.parse(rows[0].tools_json), { WebSearch: 99 });
    assert.equal(rows[0].cost_quality, 'token_buckets');
    assert.equal(rows[0].cost_estimated, 0);
    assert.equal(rows[0].total_cost_usd, pricing.computeEnhancedRowCost({
      source: 'claude',
      model: 'claude-opus-4-7',
      web_search_requests: 2,
    }));
  } finally {
    tmp.cleanup();
  }
});

test('synthetic branch usage facts preserve Historical unknown while carrying session enrichment', async () => {
  const tmp = makeDb();
  try {
    const repoRoot = path.join(tmp.dir, 'repo');
    initGitRepo(repoRoot);

    const db = new DatabaseSync(tmp.dbPath);
    try {
      insertSession(db, {
        provider: 'claude',
        session_id: 'historical-enriched',
        started_at: '2000-01-01T00:00:00.000Z',
        ended_at: '2000-01-01T00:05:00.000Z',
        cwd: repoRoot,
        repo_root: repoRoot,
        branch: 'Historical unknown',
        branch_resolution_tier: 'D',
        confidence: 'unattributed',
        model: 'claude-opus-4-7',
        total_tokens: 150,
        last_observed_at: '2000-01-01T00:05:00.000Z',
        input_tokens: 50,
        cached_input_tokens: 10,
        cache_creation_input_tokens: 50,
        cache_creation_5m_input_tokens: 20,
        cache_creation_1h_input_tokens: 30,
        output_tokens: 40,
        web_search_requests: 1,
        tool_call_count: 2,
        tools_json: JSON.stringify({ Read: 1, WebSearch: 1 }),
        activity_json: JSON.stringify({ reading: 1, research: 1 }),
      });

      await rebuildBranchUsageFactsForSession(db, {
        dbPath: tmp.dbPath,
        provider: 'claude',
        session_id: 'historical-enriched',
      });
    } finally {
      db.close();
    }

    const rows = readBranchUsageFactRows(tmp.dbPath, { includeArchived: true });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].branch, 'Historical unknown');
    assert.equal(rows[0].attribution_branch, null);
    assert.equal(rows[0].branch_kind, 'historical_unknown');
    assert.equal(rows[0].confidence, 'low');
    assert.equal(rows[0].branch_resolution_tier, 'HISTORICAL_GUARD');
    assert.equal(rows[0].cache_creation_5m_input_tokens, 20);
    assert.equal(rows[0].cache_creation_1h_input_tokens, 30);
    assert.equal(rows[0].web_search_requests, 1);
    assert.equal(rows[0].tool_call_count, 2);
    assert.deepEqual(JSON.parse(rows[0].tools_json), { Read: 1, WebSearch: 1 });
    assert.deepEqual(JSON.parse(rows[0].activity_json), { reading: 1, research: 1 });
    assert.equal(rows[0].total_cost_usd, pricing.computeEnhancedRowCost({
      source: 'claude',
      model: 'claude-opus-4-7',
      total_tokens: 150,
      input_tokens: 50,
      cached_input_tokens: 10,
      cache_creation_input_tokens: 50,
      cache_creation_5m_input_tokens: 20,
      cache_creation_1h_input_tokens: 30,
      output_tokens: 40,
      reasoning_output_tokens: 0,
      web_search_requests: 1,
    }));
  } finally {
    tmp.cleanup();
  }
});
