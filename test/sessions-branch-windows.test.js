const test = require('node:test');
const assert = require('node:assert/strict');

const { splitSessionByBranchTransitions } = require('../src/lib/sessions/branch-windows');

function sum(arr, key) {
  return arr.reduce((acc, x) => acc + (x[key] || 0), 0);
}

test('splitSessionByBranchTransitions: no transitions returns single window with full tokens/cost', () => {
  const session = {
    provider: 'codex',
    session_id: 's1',
    started_at: '2026-05-09T10:00:00.000Z',
    ended_at: '2026-05-09T10:10:00.000Z',
    total_tokens: 100,
    total_cost_usd: 1.25,
    branch: 'main',
  };
  const windows = splitSessionByBranchTransitions({ session, transitions: [] });
  assert.equal(windows.length, 1);
  assert.deepEqual(windows[0], {
    branch: 'main',
    window_start: session.started_at,
    window_end: session.ended_at,
    prorated_tokens: 100,
    prorated_cost_usd: 1.25,
  });
});

test('splitSessionByBranchTransitions: one checkout splits into two windows and prorates', () => {
  const session = {
    provider: 'codex',
    session_id: 's2',
    started_at: '2026-05-09T10:00:00.000Z',
    ended_at: '2026-05-09T10:10:00.000Z',
    total_tokens: 100,
    total_cost_usd: 2.0,
    branch: 'a',
  };
  const transitions = [{ transitioned_at: '2026-05-09T10:04:00.000Z', ref_name: 'b' }];
  const windows = splitSessionByBranchTransitions({ session, transitions });
  assert.equal(windows.length, 2);
  assert.equal(sum(windows, 'prorated_tokens'), 100);
  assert.ok(Math.abs(sum(windows, 'prorated_cost_usd') - 2.0) <= 0.0001);
  assert.deepEqual(windows.map((w) => w.branch), ['a', 'b']);
});

test('splitSessionByBranchTransitions: N checkouts yields N+1 windows and sums exactly', () => {
  const session = {
    provider: 'codex',
    session_id: 's3',
    started_at: '2026-05-09T10:00:00.000Z',
    ended_at: '2026-05-09T10:09:00.000Z',
    total_tokens: 101,
    total_cost_usd: 1.01,
    branch: 'main',
  };
  const transitions = [
    { transitioned_at: '2026-05-09T10:02:00.000Z', ref_name: 'a' },
    { transitioned_at: '2026-05-09T10:05:00.000Z', ref_name: 'b' },
    { transitioned_at: '2026-05-09T10:07:00.000Z', ref_name: 'c' },
  ];
  const windows = splitSessionByBranchTransitions({ session, transitions });
  assert.equal(windows.length, 4);
  assert.equal(sum(windows, 'prorated_tokens'), 101);
  assert.ok(Math.abs(sum(windows, 'prorated_cost_usd') - 1.01) <= 0.0001);
  assert.deepEqual(windows.map((w) => w.branch), ['main', 'a', 'b', 'c']);
});

test('splitSessionByBranchTransitions: long idle with no checkout does not fragment', () => {
  const session = {
    provider: 'codex',
    session_id: 's4',
    started_at: '2026-05-09T10:00:00.000Z',
    ended_at: '2026-05-09T10:50:00.000Z',
    total_tokens: 10,
    total_cost_usd: 0.2,
    branch: 'main',
  };
  const windows = splitSessionByBranchTransitions({ session, transitions: [] });
  assert.equal(windows.length, 1);
});

test('splitSessionByBranchTransitions: tokens sum invariant holds exactly (last absorbs rounding)', () => {
  const session = {
    provider: 'codex',
    session_id: 's5',
    started_at: '2026-05-09T10:00:00.000Z',
    ended_at: '2026-05-09T10:01:01.000Z',
    total_tokens: 7,
    total_cost_usd: 0.07,
    branch: 'a',
  };
  const transitions = [
    { transitioned_at: '2026-05-09T10:00:20.000Z', ref_name: 'b' },
    { transitioned_at: '2026-05-09T10:00:40.000Z', ref_name: 'c' },
  ];
  const windows = splitSessionByBranchTransitions({ session, transitions });
  assert.equal(sum(windows, 'prorated_tokens'), 7);
});

test('splitSessionByBranchTransitions: cost sum invariant holds within ±0.0001', () => {
  const session = {
    provider: 'codex',
    session_id: 's6',
    started_at: '2026-05-09T10:00:00.000Z',
    ended_at: '2026-05-09T10:00:10.000Z',
    total_tokens: 10,
    total_cost_usd: 0.3333,
    branch: 'a',
  };
  const transitions = [{ transitioned_at: '2026-05-09T10:00:03.000Z', ref_name: 'b' }];
  const windows = splitSessionByBranchTransitions({ session, transitions });
  assert.ok(Math.abs(sum(windows, 'prorated_cost_usd') - 0.3333) <= 0.0001);
});

test('splitSessionByBranchTransitions: idempotent output', () => {
  const session = {
    provider: 'codex',
    session_id: 's7',
    started_at: '2026-05-09T10:00:00.000Z',
    ended_at: '2026-05-09T10:10:00.000Z',
    total_tokens: 100,
    total_cost_usd: 1.0,
    branch: 'a',
  };
  const transitions = [
    { transitioned_at: '2026-05-09T10:04:00.000Z', ref_name: 'b' },
    { transitioned_at: '2026-05-09T10:07:00.000Z', ref_name: 'c' },
  ];
  const w1 = splitSessionByBranchTransitions({ session, transitions });
  const w2 = splitSessionByBranchTransitions({ session, transitions });
  assert.deepEqual(w1, w2);
});

