const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { test } = require('node:test');

const { ensureSchema } = require('../src/lib/db');
const { makeStart, makeUpdate, makeEnd } = require('../src/lib/sessions/event');
const { upsertSessionFromEvents } = require('../src/lib/sessions/writer');
const { upsertBucketFact } = require('../src/lib/sessions/bucket-facts');
const { rebuildBranchUsageFactsForSession } = require('../src/lib/sessions/branch-usage-facts');
const { processSessionEvent } = require('../src/lib/sessions/pipeline');
const { queryBranchUsage } = require('../src/lib/branch-usage');

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-codeburn-event-'));
  const dbPath = path.join(dir, 'vibedeck.sqlite3');
  ensureSchema(dbPath);
  return { dbPath, dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('SessionEvent update accepts task category, ordered tools, skills, and fast mode', () => {
  const update = makeUpdate({
    provider: 'claude',
    session_id: 's1',
    observed_at: '2026-05-23T10:00:00.000Z',
    input_tokens: 100,
    output_tokens: 25,
    task_category: JSON.stringify({ Coding: 1 }),
    tools_sequence_json: JSON.stringify(['Read', 'Edit', 'Bash']),
    skills_json: JSON.stringify({ planner: 1 }),
    fast_mode: 1,
  });
  assert.equal(update.task_category, JSON.stringify({ Coding: 1 }));
  assert.equal(update.tools_sequence_json, JSON.stringify(['Read', 'Edit', 'Bash']));
  assert.equal(update.skills_json, JSON.stringify({ planner: 1 }));
  assert.equal(update.fast_mode, 1);
});

test('SessionEvent update rejects malformed Codeburn parity fields', () => {
  assert.throws(
    () => makeUpdate({ provider: 'claude', session_id: 's1', observed_at: '2026-05-23T10:00:00.000Z', task_category: '{bad' }),
    /task_category/,
  );
  assert.throws(
    () => makeUpdate({ provider: 'claude', session_id: 's1', observed_at: '2026-05-23T10:00:00.000Z', tools_sequence_json: '{bad' }),
    /tools_sequence_json/,
  );
  assert.throws(
    () => makeUpdate({ provider: 'claude', session_id: 's1', observed_at: '2026-05-23T10:00:00.000Z', skills_json: '{bad' }),
    /skills_json/,
  );
  assert.throws(
    () => makeUpdate({ provider: 'claude', session_id: 's1', observed_at: '2026-05-23T10:00:00.000Z', fast_mode: -1 }),
    /fast_mode/,
  );
});

test('writer and bucket/branch facts carry additive Codeburn fields without changing totals', async () => {
  const tmp = tmpDb();
  try {
    const events = [
      makeStart({
        provider: 'claude',
        session_id: 's1',
        started_at: '2026-05-23T10:00:00.000Z',
        cwd: tmp.dir,
        model: 'claude-sonnet-4',
      }),
      makeUpdate({
        provider: 'claude',
        session_id: 's1',
        observed_at: '2026-05-23T10:05:00.000Z',
        input_tokens: 100,
        output_tokens: 25,
        delta_tokens: 125,
        model: 'claude-sonnet-4',
        task_category: JSON.stringify({ Coding: 1 }),
        tools_sequence_json: JSON.stringify(['Read', 'Edit']),
        skills_json: JSON.stringify({ planner: 1 }),
        fast_mode: 1,
      }),
      makeEnd({ provider: 'claude', session_id: 's1', ended_at: '2026-05-23T10:10:00.000Z', total_tokens: 125 }),
    ];
    upsertSessionFromEvents(tmp.dbPath, events);
    const db = new DatabaseSync(tmp.dbPath);
    try {
      const session = db.prepare('SELECT * FROM vibedeck_sessions WHERE provider = ? AND session_id = ?').get('claude', 's1');
      assert.equal(session.total_tokens, 125);
      assert.equal(session.task_category, JSON.stringify({ Coding: 1 }));
      assert.equal(session.skills_json, JSON.stringify({ planner: 1 }));
      assert.equal(session.fast_mode, 1);
      assert.equal(session.tools_sequence_json, JSON.stringify(['Read', 'Edit']));

      assert.equal(upsertBucketFact(db, session, events[1]), true);
      const bucket = db.prepare('SELECT * FROM vibedeck_session_buckets WHERE provider = ? AND session_id = ?').get('claude', 's1');
      assert.equal(bucket.total_tokens, 125);
      assert.equal(bucket.task_category, JSON.stringify({ Coding: 1 }));
      assert.equal(bucket.skills_json, JSON.stringify({ planner: 1 }));
      assert.equal(bucket.fast_mode, 1);

      await rebuildBranchUsageFactsForSession(db, { dbPath: tmp.dbPath, provider: 'claude', session_id: 's1' });
      const fact = db.prepare('SELECT * FROM vibedeck_branch_usage_facts WHERE provider = ? AND session_id = ?').get('claude', 's1');
      assert.ok(fact);
      assert.equal(fact.total_tokens, 125);
      assert.equal(fact.task_category, JSON.stringify({ Coding: 1 }));
      assert.equal(fact.skills_json, JSON.stringify({ planner: 1 }));
      assert.equal(fact.fast_mode, 1);

      const usage = queryBranchUsage(tmp.dbPath, {
        includeSessions: true,
        includeDateBuckets: true,
        includeArchived: true,
      });
      const branch = usage.repos.flatMap((repo) => repo.branches)[0];
      assert.equal(branch.task_category, JSON.stringify({ Coding: 1 }));
      assert.equal(branch.skills_json, JSON.stringify({ planner: 1 }));
      assert.equal(branch.fast_mode, 1);
      assert.equal(branch.models[0].task_category, JSON.stringify({ Coding: 1 }));
      assert.equal(branch.models[0].skills_json, JSON.stringify({ planner: 1 }));
      assert.equal(branch.models[0].fast_mode, 1);
      assert.equal(branch.date_buckets[0].task_category, JSON.stringify({ Coding: 1 }));
      assert.equal(branch.date_buckets[0].skills_json, JSON.stringify({ planner: 1 }));
      assert.equal(branch.date_buckets[0].fast_mode, 1);
      assert.equal(branch.sessions[0].task_category, JSON.stringify({ Coding: 1 }));
      assert.equal(branch.sessions[0].skills_json, JSON.stringify({ planner: 1 }));
      assert.equal(branch.sessions[0].fast_mode, 1);
    } finally {
      db.close();
    }
  } finally {
    tmp.cleanup();
  }
});

test('processSessionEvent persists Codeburn fields into ledger events and rebuilt branch facts', async () => {
  const tmp = tmpDb();
  try {
    await processSessionEvent(tmp.dbPath, {
      kind: 'start',
      provider: 'claude',
      session_id: 'pipeline-s1',
      started_at: '2026-05-23T11:00:00.000Z',
      cwd: tmp.dir,
      model: 'claude-sonnet-4',
    });
    await processSessionEvent(tmp.dbPath, {
      kind: 'update',
      provider: 'claude',
      session_id: 'pipeline-s1',
      observed_at: '2026-05-23T11:05:00.000Z',
      input_tokens: 80,
      output_tokens: 20,
      delta_tokens: 100,
      model: 'claude-sonnet-4',
      task_category: JSON.stringify({ Coding: 1 }),
      tools_sequence_json: JSON.stringify(['Read', 'Edit']),
      skills_json: JSON.stringify({ planner: 1 }),
      fast_mode: 1,
    });

    const db = new DatabaseSync(tmp.dbPath, { readOnly: true });
    try {
      const event = db
        .prepare(
          "SELECT * FROM vibedeck_session_events WHERE provider = ? AND session_id = ? AND kind = 'update'",
        )
        .get('claude', 'pipeline-s1');
      assert.ok(event);
      assert.equal(event.task_category, JSON.stringify({ Coding: 1 }));
      assert.equal(event.tools_sequence_json, JSON.stringify(['Read', 'Edit']));
      assert.equal(event.skills_json, JSON.stringify({ planner: 1 }));
      assert.equal(event.fast_mode, 1);

      const fact = db
        .prepare('SELECT * FROM vibedeck_branch_usage_facts WHERE provider = ? AND session_id = ?')
        .get('claude', 'pipeline-s1');
      assert.ok(fact);
      assert.equal(fact.total_tokens, 100);
      assert.equal(fact.task_category, JSON.stringify({ Coding: 1 }));
      assert.equal(fact.skills_json, JSON.stringify({ planner: 1 }));
      assert.equal(fact.fast_mode, 1);
    } finally {
      db.close();
    }
  } finally {
    tmp.cleanup();
  }
});
