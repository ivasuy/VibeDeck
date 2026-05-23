'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { DatabaseSync } = require('node:sqlite');

const { ensureSchema } = require('../src/lib/db');
const { runOptimizeScan, readOptimizeFindings, computeHealthGrade } = require('../src/lib/optimize-scanner');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibedeck-opt-scan-'));
  const dbPath = path.join(dir, 'vibedeck.sqlite3');
  ensureSchema(dbPath);
  return { dir, dbPath, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function insertSession(db, row) {
  db.prepare(`
    INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, ended_at, end_reason, cwd, repo_root,
      branch, branch_resolution_tier, confidence, model, total_tokens,
      input_tokens, cached_input_tokens, output_tokens, tools_json, activity_json,
      last_observed_at, created_at, updated_at
    ) VALUES (
      @provider, @session_id, @started_at, @ended_at, @end_reason, @cwd, @repo_root,
      @branch, @branch_resolution_tier, @confidence, @model, @total_tokens,
      @input_tokens, @cached_input_tokens, @output_tokens, @tools_json, @activity_json,
      @last_observed_at, @created_at, @updated_at
    )
  `).run(row);
}

function insertEvent(db, row) {
  db.prepare(`
    INSERT INTO vibedeck_session_events (
      provider, session_id, event_key, kind, observed_at, cwd, repo_root,
      branch, branch_resolution_tier, confidence, model, delta_tokens,
      input_tokens, cached_input_tokens, output_tokens, tools_json, activity_json, created_at
    ) VALUES (
      @provider, @session_id, @event_key, @kind, @observed_at, @cwd, @repo_root,
      @branch, @branch_resolution_tier, @confidence, @model, @delta_tokens,
      @input_tokens, @cached_input_tokens, @output_tokens, @tools_json, @activity_json, @created_at
    )
  `).run(row);
}

test('scanner records three optimize finding kinds and keeps repeated health stable', () => {
  const f = makeDb();
  try {
    const now = '2026-05-23T00:00:00.000Z';
    const db = new DatabaseSync(f.dbPath);
    try {
      insertSession(db, {
        provider: 'claude',
        session_id: 's1',
        started_at: now,
        ended_at: null,
        end_reason: null,
        cwd: f.dir,
        repo_root: f.dir,
        branch: 'main',
        branch_resolution_tier: 'A',
        confidence: 'high',
        model: 'claude-sonnet-4',
        total_tokens: 5000,
        input_tokens: 4000,
        cached_input_tokens: 0,
        output_tokens: 1000,
        tools_json: JSON.stringify({ Read: 5 }),
        activity_json: JSON.stringify({ reading: 5 }),
        last_observed_at: now,
        created_at: now,
        updated_at: now,
      });
      insertSession(db, {
        provider: 'claude',
        session_id: 's2',
        started_at: now,
        ended_at: null,
        end_reason: null,
        cwd: f.dir,
        repo_root: f.dir,
        branch: 'main',
        branch_resolution_tier: 'A',
        confidence: 'high',
        model: 'claude-sonnet-4',
        total_tokens: 12000,
        input_tokens: 10000,
        cached_input_tokens: 0,
        output_tokens: 2000,
        tools_json: JSON.stringify({ Read: 10, Edit: 1 }),
        activity_json: JSON.stringify({ reading: 10, editing: 1 }),
        last_observed_at: now,
        created_at: now,
        updated_at: now,
      });
      for (let i = 0; i < 5; i += 1) {
        insertEvent(db, {
          provider: 'claude',
          session_id: 's1',
          event_key: `read-${i}`,
          kind: 'update',
          observed_at: now,
          cwd: f.dir,
          repo_root: f.dir,
          branch: 'main',
          branch_resolution_tier: 'A',
          confidence: 'high',
          model: 'claude-sonnet-4',
          delta_tokens: 1000,
          input_tokens: 900,
          cached_input_tokens: 0,
          output_tokens: 100,
          tools_json: JSON.stringify({ Read: 1 }),
          activity_json: JSON.stringify({ reading: 1 }),
          created_at: now,
        });
      }
    } finally {
      db.close();
    }
    fs.writeFileSync(path.join(f.dir, 'CLAUDE.md'), 'x'.repeat(81 * 1024), 'utf8');

    const first = runOptimizeScan({ dbPath: f.dbPath, now: new Date(now), cwd: f.dir });
    const second = runOptimizeScan({ dbPath: f.dbPath, now: new Date('2026-05-23T01:00:00.000Z'), cwd: f.dir });
    const { findings } = readOptimizeFindings({ dbPath: f.dbPath });

    assert.equal(first.inserted, 3);
    assert.equal(second.health_grade, first.health_grade);
    assert.deepEqual(second.counts_by_kind, first.counts_by_kind);
    assert.ok(findings.find((finding) => finding.finding_kind === 'file_reread'));
    assert.ok(findings.find((finding) => finding.finding_kind === 'low_read_edit_ratio'));
    assert.ok(findings.find((finding) => finding.finding_kind === 'bloated_claude_md'));
    assert.deepEqual(computeHealthGrade({ high: 0, medium: 2, low: 1 }), { score: 81, health_grade: 'B' });
  } finally {
    f.cleanup();
  }
});
