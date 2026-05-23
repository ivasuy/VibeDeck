'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');

const { ensureSchema } = require('../src/lib/db');
const { runOptimizeScan } = require('../src/lib/optimize-scanner');
const { startOptimizeSchedule } = require('../src/lib/optimize-schedule');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibedeck-opt-isolation-'));
  const dbPath = path.join(dir, 'vibedeck.sqlite3');
  ensureSchema(dbPath);
  return { dir, dbPath, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('optimizer never mutates branch usage fact totals', () => {
  const f = makeDb();
  try {
    const now = '2026-05-23T00:00:00.000Z';
    const db = new DatabaseSync(f.dbPath);
    try {
      db.prepare(`INSERT INTO vibedeck_branch_usage_facts (
        provider, session_id, scope_key, project_state, project_key, cwd, repo_root,
        branch, branch_kind, confidence, model, first_observed_at, last_observed_at,
        event_count, total_tokens, input_tokens, cached_input_tokens, cache_creation_input_tokens,
        output_tokens, reasoning_output_tokens, conversation_count, total_cost_usd, cost_estimated,
        cost_quality, token_reconciled, cost_reconciled, created_at, updated_at
      ) VALUES (
        'claude', 's1', 'repo:/tmp/repo', 'git_existing', '/tmp/repo', '/tmp/repo', '/tmp/repo',
        'main', 'known', 'high', 'claude-sonnet-4', @now, @now,
        1, 1000, 800, 0, 0, 200, 0, 1, 12.3456, 0,
        'stored', 0, 0, @now, @now
      )`).run({ now });

      runOptimizeScan({ dbPath: f.dbPath, now: new Date(now), cwd: f.dir });

      const after = db.prepare('SELECT total_cost_usd FROM vibedeck_branch_usage_facts WHERE session_id = ?').get('s1');
      assert.equal(after.total_cost_usd, 12.3456);
    } finally {
      db.close();
    }

    const source = fs.readFileSync(path.join(__dirname, '../src/lib/optimize-scanner.js'), 'utf8');
    assert.doesNotMatch(source, /UPDATE\s+vibedeck_branch_usage_facts/i);
    assert.doesNotMatch(source, /INSERT\s+INTO\s+vibedeck_branch_usage_facts/i);
    assert.doesNotMatch(source, /DELETE\s+FROM\s+vibedeck_branch_usage_facts/i);
  } finally {
    f.cleanup();
  }
});

test('optimize schedule is disabled unless explicitly enabled', async () => {
  const f = makeDb();
  const prevFlag = process.env.VIBEDECK_OPTIMIZE_SCHEDULE_V1;
  try {
    delete process.env.VIBEDECK_OPTIMIZE_SCHEDULE_V1;
    const schedule = startOptimizeSchedule({ dbPath: f.dbPath, intervalMs: 1 });
    const result = await schedule.trigger();
    assert.deepEqual(result, { ok: true, skipped: true });
    schedule.stop();
  } finally {
    if (prevFlag === undefined) delete process.env.VIBEDECK_OPTIMIZE_SCHEDULE_V1;
    else process.env.VIBEDECK_OPTIMIZE_SCHEDULE_V1 = prevFlag;
    f.cleanup();
  }
});
