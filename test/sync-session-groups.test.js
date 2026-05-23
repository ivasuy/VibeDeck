const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');
const {
  rebuildSessionGroupProjection,
  readSessionGroupDiagnostics,
} = require('../src/lib/sessions/session-groups');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-sync-session-groups-'));
  const dbPath = path.join(dir, 'vibedeck.sqlite3');
  ensureSchema(dbPath);
  return {
    dir,
    dbPath,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function insertSession(db, row) {
  db.prepare(`
    INSERT INTO vibedeck_sessions (
      provider, session_id, cwd, repo_root, branch, model, started_at, ended_at,
      branch_resolution_tier, confidence,
      total_tokens, input_tokens, cached_input_tokens, cache_creation_input_tokens,
      output_tokens, reasoning_output_tokens,
      total_cost_usd, cost_estimated, cost_quality, last_observed_at, updated_at, created_at
    ) VALUES (
      @provider, @session_id, @cwd, @repo_root, @branch, @model, @started_at, @ended_at,
      @branch_resolution_tier, @confidence,
      @total_tokens, @input_tokens, @cached_input_tokens, @cache_creation_input_tokens,
      @output_tokens, @reasoning_output_tokens,
      @total_cost_usd, @cost_estimated, @cost_quality, @last_observed_at, @updated_at, @created_at
    )
  `).run({
    cwd: '/repo',
    repo_root: '/repo',
    branch: 'main',
    model: 'gpt-5.5',
    started_at: '2026-05-23T10:00:00.000Z',
    ended_at: '2026-05-23T10:10:00.000Z',
    branch_resolution_tier: 'provider',
    confidence: 'high',
    total_tokens: 100,
    input_tokens: 50,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 50,
    reasoning_output_tokens: 0,
    total_cost_usd: 0.01,
    cost_estimated: 0,
    cost_quality: 'stored',
    last_observed_at: '2026-05-23T10:10:00.000Z',
    updated_at: '2026-05-23T10:10:00.000Z',
    created_at: '2026-05-23T10:00:00.000Z',
    ...row,
  });
}

function insertStaleEdge(db, now) {
  db.prepare(`
    INSERT INTO vibedeck_session_group_edges (
      provider, session_group_id, root_session_id, child_session_id,
      root_thread_id, child_thread_id, relation_proof, depth,
      agent_id, agent_label, agent_role, source_path, created_at, updated_at
    ) VALUES (
      'codex', 'codex:stale-parent', 'stale-parent', 'stale-child',
      'stale-parent-thread', 'stale-child-thread', 'codex_thread_spawn', 1,
      'stale-child-thread', 'Stale child', 'reviewer', 'stale-child', @now, @now
    )
  `).run({ now });
}

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`);
}

test('rebuildSessionGroupProjection is idempotent and clears stale edges', () => {
  const tmp = makeDb();
  try {
    const db = new DatabaseSync(tmp.dbPath);
    const parent = path.join(tmp.dir, 'rollout-parent-thread.jsonl');
    const child = path.join(tmp.dir, 'rollout-child-thread.jsonl');
    writeJsonl(parent, [{ type: 'session_meta', payload: { id: 'parent-thread' } }]);
    writeJsonl(child, [{
      type: 'session_meta',
      payload: {
        id: 'child-thread',
        thread_source: 'subagent',
        source: { subagent: { thread_spawn: { parent_thread_id: 'parent-thread', depth: 1 } } },
      },
    }]);
    insertSession(db, { provider: 'codex', session_id: parent });
    insertSession(db, { provider: 'codex', session_id: child });
    insertStaleEdge(db, '2026-05-23T10:59:00.000Z');
    db.close();

    const first = rebuildSessionGroupProjection(tmp.dbPath, { mode: 'shadow', now: '2026-05-23T11:00:00.000Z' });
    const second = rebuildSessionGroupProjection(tmp.dbPath, { mode: 'shadow', now: '2026-05-23T11:01:00.000Z' });
    assert.equal(first.edges_written, 1);
    assert.equal(second.edges_written, 1);

    const verify = new DatabaseSync(tmp.dbPath, { readOnly: true });
    try {
      const childSessionIds = verify
        .prepare('SELECT child_session_id FROM vibedeck_session_group_edges')
        .all()
        .map((row) => row.child_session_id);
      assert.deepEqual(childSessionIds, [child]);
      const diagnostics = readSessionGroupDiagnostics(tmp.dbPath);
      assert.equal(diagnostics.grouped_child_sessions, 1);
      assert.equal(diagnostics.skipped_edges, 0);
    } finally {
      verify.close();
    }
  } finally {
    tmp.cleanup();
  }
});

test('sync module can load with session grouping helper wired', () => {
  const sync = require('../src/commands/sync');
  assert.equal(typeof sync.cmdSync, 'function');
});
