const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');
const {
  readSessionGroupingMode,
  deriveClaudeGroupEvidence,
  deriveCodexGroupEvidence,
  rebuildSessionGroupProjection,
  readSessionGroupDiagnostics,
} = require('../src/lib/sessions/session-groups');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-session-groups-helper-'));
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
    cwd: null,
    repo_root: null,
    branch: null,
    model: 'gpt-5.5',
    started_at: '2026-05-23T10:00:00.000Z',
    ended_at: '2026-05-23T10:10:00.000Z',
    branch_resolution_tier: 'unknown',
    confidence: 'low',
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

function writeJsonl(filePath, rows) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

test('readSessionGroupingMode accepts off shadow preview and on', () => {
  assert.equal(readSessionGroupingMode({ VIBEDECK_SESSION_GROUPING_V1: 'off' }), 'off');
  assert.equal(readSessionGroupingMode({ VIBEDECK_SESSION_GROUPING_V1: 'shadow' }), 'shadow');
  assert.equal(readSessionGroupingMode({ VIBEDECK_SESSION_GROUPING_V1: 'preview' }), 'preview');
  assert.equal(readSessionGroupingMode({ VIBEDECK_SESSION_GROUPING_V1: 'on' }), 'on');
  assert.equal(readSessionGroupingMode({ VIBEDECK_SESSION_GROUPING_V1: '' }), 'shadow');
  assert.equal(readSessionGroupingMode({}), 'shadow');
});

test('deriveClaudeGroupEvidence links subagent transcript to sibling root transcript', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-claude-group-'));
  try {
    const projectDir = path.join(root, '-repo');
    const rootId = 'root-session';
    const rootPath = path.join(projectDir, `${rootId}.jsonl`);
    const childPath = path.join(projectDir, rootId, 'subagents', 'agent-a1.jsonl');
    fs.mkdirSync(projectDir, { recursive: true });
    writeJsonl(rootPath, [{ type: 'assistant', timestamp: '2026-05-23T10:00:00.000Z' }]);
    writeJsonl(childPath, [{
      type: 'assistant',
      timestamp: '2026-05-23T10:01:00.000Z',
      agentId: 'a1',
      sessionId: rootId,
    }]);
    fs.writeFileSync(childPath.replace(/\.jsonl$/, '.meta.json'), JSON.stringify({
      agentType: 'reviewer',
      description: 'Reviews the implementation',
    }));

    const edge = deriveClaudeGroupEvidence({ provider: 'claude', session_id: childPath });
    assert.equal(edge.kind, 'edge');
    assert.equal(edge.edge.provider, 'claude');
    assert.equal(edge.edge.root_session_id, rootPath);
    assert.equal(edge.edge.child_session_id, childPath);
    assert.equal(edge.edge.relation_proof, 'claude_subagent_path');
    assert.equal(edge.edge.depth, 1);
    assert.equal(edge.edge.agent_id, 'a1');
    assert.equal(edge.edge.agent_role, 'reviewer');
    assert.equal(edge.edge.agent_label, 'Reviews the implementation');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deriveCodexGroupEvidence resolves parent thread id to one canonical root session', () => {
  const tmp = makeDb();
  try {
    const db = new DatabaseSync(tmp.dbPath);
    const rootFile = path.join(tmp.dir, 'rollout-2026-05-23T10-00-00-parent-thread.jsonl');
    const childFile = path.join(tmp.dir, 'rollout-2026-05-23T10-05-00-child-thread.jsonl');
    writeJsonl(rootFile, [{ type: 'session_meta', payload: { id: 'parent-thread' } }]);
    writeJsonl(childFile, [{
      type: 'session_meta',
      payload: {
        id: 'child-thread',
        thread_source: 'subagent',
        agent_nickname: 'Curie',
        agent_role: 'reviewer',
        source: { subagent: { thread_spawn: { parent_thread_id: 'parent-thread', depth: 1, agent_nickname: 'Curie', agent_role: 'reviewer' } } },
      },
    }]);
    insertSession(db, { provider: 'codex', session_id: rootFile });
    insertSession(db, { provider: 'codex', session_id: childFile });
    db.close();

    const edge = deriveCodexGroupEvidence(tmp.dbPath, { provider: 'codex', session_id: childFile });
    assert.equal(edge.kind, 'edge');
    assert.equal(edge.edge.provider, 'codex');
    assert.equal(edge.edge.root_session_id, rootFile);
    assert.equal(edge.edge.child_session_id, childFile);
    assert.equal(edge.edge.root_thread_id, 'parent-thread');
    assert.equal(edge.edge.child_thread_id, 'child-thread');
    assert.equal(edge.edge.agent_label, 'Curie');
    assert.equal(edge.edge.agent_role, 'reviewer');
    assert.equal(edge.edge.relation_proof, 'codex_thread_spawn');
  } finally {
    tmp.cleanup();
  }
});

test('deriveCodexGroupEvidence ignores subagent payloads outside session_meta proof rows', () => {
  const tmp = makeDb();
  try {
    const db = new DatabaseSync(tmp.dbPath);
    const rootFile = path.join(tmp.dir, 'rollout-parent-thread.jsonl');
    const childFile = path.join(tmp.dir, 'rollout-child-thread.jsonl');
    writeJsonl(rootFile, [{ type: 'session_meta', payload: { id: 'parent-thread' } }]);
    writeJsonl(childFile, [{
      type: 'not_session_meta',
      payload: {
        id: 'child-thread',
        thread_source: 'subagent',
        source: { subagent: { thread_spawn: { parent_thread_id: 'parent-thread', depth: 1 } } },
      },
    }]);
    insertSession(db, { provider: 'codex', session_id: rootFile });
    insertSession(db, { provider: 'codex', session_id: childFile });
    db.close();

    assert.equal(deriveCodexGroupEvidence(tmp.dbPath, { provider: 'codex', session_id: childFile }), null);

    const summary = rebuildSessionGroupProjection(tmp.dbPath, { mode: 'shadow' });
    assert.equal(summary.edges_written, 0);
    assert.equal(summary.skips_written, 0);

    const diagnostics = readSessionGroupDiagnostics(tmp.dbPath);
    assert.equal(diagnostics.grouped_child_sessions, 0);
    assert.equal(diagnostics.skipped_edges, 0);
  } finally {
    tmp.cleanup();
  }
});

test('rebuildSessionGroupProjection writes edges and skipped orphan diagnostics', () => {
  const tmp = makeDb();
  try {
    const db = new DatabaseSync(tmp.dbPath);
    const parentFile = path.join(tmp.dir, 'rollout-parent-thread.jsonl');
    const childFile = path.join(tmp.dir, 'rollout-child-thread.jsonl');
    const orphanFile = path.join(tmp.dir, 'rollout-orphan-thread.jsonl');
    writeJsonl(parentFile, [{ type: 'session_meta', payload: { id: 'parent-thread' } }]);
    writeJsonl(childFile, [{
      type: 'session_meta',
      payload: {
        id: 'child-thread',
        thread_source: 'subagent',
        source: { subagent: { thread_spawn: { parent_thread_id: 'parent-thread', depth: 1 } } },
      },
    }]);
    writeJsonl(orphanFile, [{
      type: 'session_meta',
      payload: { id: 'orphan-thread', thread_source: 'subagent', source: { subagent: { thread_spawn: { depth: 1 } } } },
    }]);
    insertSession(db, { provider: 'codex', session_id: parentFile });
    insertSession(db, { provider: 'codex', session_id: childFile });
    insertSession(db, { provider: 'codex', session_id: orphanFile });
    db.close();

    const summary = rebuildSessionGroupProjection(tmp.dbPath, { mode: 'shadow' });
    assert.equal(summary.edges_written, 1);
    assert.equal(summary.skips_written, 1);

    const diagnostics = readSessionGroupDiagnostics(tmp.dbPath);
    assert.equal(diagnostics.grouped_child_sessions, 1);
    assert.equal(diagnostics.skipped_edges, 1);
    assert.deepEqual(diagnostics.skips_by_reason, { missing_parent_thread_id: 1 });
  } finally {
    tmp.cleanup();
  }
});
