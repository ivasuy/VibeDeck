const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { ensureSchema } = require('../src/lib/db');
const { processSessionEvent } = require('../src/lib/sessions/pipeline');
const { queryBranchUsage } = require('../src/lib/branch-usage');

test('processSessionEvent persists deduplicated session events', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-event-ledger-'));
  const dbPath = path.join(dir, 'test.db');
  try {
    ensureSchema(dbPath);

    const event = {
      kind: 'update',
      provider: 'codex',
      session_id: 's1',
      observed_at: '2026-05-11T09:00:00.000Z',
      delta_tokens: 10,
      input_tokens: 8,
      output_tokens: 2,
      conversation_count: 1,
      cwd: dir,
      model: 'gpt-5.4',
    };

    await processSessionEvent(dbPath, {
      kind: 'start',
      provider: 'codex',
      session_id: 's1',
      started_at: '2026-05-11T08:59:00.000Z',
      cwd: dir,
      model: 'gpt-5.4',
    });
    await processSessionEvent(dbPath, event);
    await processSessionEvent(dbPath, event);

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const count = db
      .prepare("SELECT COUNT(*) AS n FROM vibedeck_session_events WHERE provider = 'codex' AND session_id = 's1'")
      .get().n;
    const facts = db
      .prepare("SELECT branch, total_tokens FROM vibedeck_branch_usage_facts WHERE provider = 'codex' AND session_id = 's1'")
      .all()
      .map((row) => ({
        branch: row.branch,
        total_tokens: row.total_tokens,
      }));
    db.close();

    assert.equal(count, 2);
    assert.deepEqual(facts, [{ branch: 'No branch', total_tokens: 10 }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('reprocessing an existing event repairs billable totals through bucket and branch facts', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-event-billable-repair-'));
  const dbPath = path.join(dir, 'test.db');
  try {
    ensureSchema(dbPath);

    const event = {
      kind: 'update',
      provider: 'cursor',
      session_id: 's1',
      observed_at: '2026-05-11T09:00:00.000Z',
      delta_tokens: 120,
      input_tokens: 100,
      output_tokens: 20,
      conversation_count: 1,
      cwd: dir,
      model: 'cursor-small',
    };

    await processSessionEvent(dbPath, {
      kind: 'start',
      provider: 'cursor',
      session_id: 's1',
      started_at: '2026-05-11T08:59:00.000Z',
      cwd: dir,
      model: 'cursor-small',
    });
    await processSessionEvent(dbPath, event);

    let db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const bucket = db
        .prepare("SELECT total_tokens, billable_total_tokens FROM vibedeck_session_buckets WHERE provider = 'cursor' AND session_id = 's1'")
        .get();
      assert.equal(bucket.total_tokens, 120);
      assert.equal(bucket.billable_total_tokens, 120);
    } finally {
      db.close();
    }

    await processSessionEvent(dbPath, { ...event, billable_total_tokens: 0 });

    db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const eventRow = db
        .prepare("SELECT total_tokens, billable_total_tokens FROM vibedeck_session_events WHERE provider = 'cursor' AND session_id = 's1' AND kind = 'update'")
        .get();
      const bucket = db
        .prepare("SELECT total_tokens, billable_total_tokens FROM vibedeck_session_buckets WHERE provider = 'cursor' AND session_id = 's1'")
        .get();
      const fact = db
        .prepare("SELECT total_tokens, billable_total_tokens FROM vibedeck_branch_usage_facts WHERE provider = 'cursor' AND session_id = 's1'")
        .get();
      assert.equal(eventRow.total_tokens, null);
      assert.equal(eventRow.billable_total_tokens, 0);
      assert.equal(bucket.total_tokens, 120);
      assert.equal(bucket.billable_total_tokens, 0);
      assert.equal(fact.total_tokens, 120);
      assert.equal(fact.billable_total_tokens, 0);
    } finally {
      db.close();
    }

    const branchUsage = queryBranchUsage(dbPath, { includeSessions: true });
    const branch = branchUsage.repos[0].branches[0];
    assert.equal(branchUsage.totals.total_tokens, 120);
    assert.equal(branchUsage.totals.billable_total_tokens, 0);
    assert.equal(branch.total_tokens, 120);
    assert.equal(branch.billable_total_tokens, 0);
    assert.equal(branch.sessions[0].billable_total_tokens, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
