const test = require('node:test');
const assert = require('node:assert/strict');

test('resolveBranchForSession: all tiers fall through returns D/unattributed', async () => {
  const { resolveBranchForSession } = require('../src/lib/sessions/resolve-branch');
  const r = await resolveBranchForSession(
    {
      provider: 'codex',
      repo_root: '/repo',
      started_at: '2026-05-09T10:00:00.000Z',
      ended_at: '2026-05-09T10:10:00.000Z',
      dbPath: '/db',
    },
    {
      resolveTierA: async () => null,
      findBranchAt: () => null,
      resolveTierC: async () => null,
    },
  );
  assert.deepEqual(r, { branch: null, tier: 'D', confidence: 'unattributed' });
});

test('resolveBranchForSession: tier A available returns A/high', async () => {
  const { resolveBranchForSession } = require('../src/lib/sessions/resolve-branch');
  const r = await resolveBranchForSession(
    {
      provider: 'codex',
      repo_root: '/repo',
      started_at: '2026-05-09T10:00:00.000Z',
      ended_at: '2026-05-09T10:10:00.000Z',
      dbPath: '/db',
    },
    {
      resolveTierA: async () => ({ branch: 'main', confidence: 'high', entire_session_id: 's1' }),
      findBranchAt: () => {
        throw new Error('should not call B');
      },
      resolveTierC: async () => {
        throw new Error('should not call C');
      },
    },
  );
  assert.equal(r.tier, 'A');
  assert.equal(r.confidence, 'high');
  assert.equal(r.branch, 'main');
});

test('resolveBranchForSession: A null and B hit returns B/medium', async () => {
  const { resolveBranchForSession } = require('../src/lib/sessions/resolve-branch');
  const r = await resolveBranchForSession(
    {
      provider: 'codex',
      repo_root: '/repo',
      started_at: '2026-05-09T10:00:00.000Z',
      ended_at: '2026-05-09T10:10:00.000Z',
      dbPath: '/db',
    },
    {
      resolveTierA: async () => null,
      findBranchAt: () => 'feature/x',
      resolveTierC: async () => {
        throw new Error('should not call C');
      },
    },
  );
  assert.deepEqual(r, { branch: 'feature/x', tier: 'B', confidence: 'medium' });
});

test('resolveBranchForSession: A/B null and C hit returns C/low', async () => {
  const { resolveBranchForSession } = require('../src/lib/sessions/resolve-branch');
  const r = await resolveBranchForSession(
    {
      provider: 'codex',
      repo_root: '/repo',
      started_at: '2026-05-09T10:00:00.000Z',
      ended_at: '2026-05-09T10:10:00.000Z',
      dbPath: '/db',
    },
    {
      resolveTierA: async () => null,
      findBranchAt: () => null,
      resolveTierC: async () => ({ branch: 'reflog-branch', confidence: 'low' }),
    },
  );
  assert.deepEqual(r, { branch: 'reflog-branch', tier: 'C', confidence: 'low' });
});

test('resolveBranchForSession: repo_root missing returns D directly and skips A/B/C', async () => {
  const calls = [];
  const { resolveBranchForSession } = require('../src/lib/sessions/resolve-branch');
  const r = await resolveBranchForSession(
    {
      provider: 'codex',
      repo_root: null,
      started_at: '2026-05-09T10:00:00.000Z',
      ended_at: '2026-05-09T10:10:00.000Z',
      dbPath: '/db',
    },
    {
      resolveTierA: async () => calls.push('A'),
      findBranchAt: () => calls.push('B'),
      resolveTierC: async () => calls.push('C'),
    },
  );
  assert.deepEqual(r, { branch: null, tier: 'D', confidence: 'unattributed' });
  assert.deepEqual(calls, []);
});

test('resolveBranchForSession: manual override returns OVERRIDE/high and ignores all tiers', async () => {
  const calls = [];
  const { resolveBranchForSession } = require('../src/lib/sessions/resolve-branch');
  const r = await resolveBranchForSession(
    {
      provider: 'codex',
      repo_root: '/repo',
      started_at: '2026-05-09T10:00:00.000Z',
      ended_at: '2026-05-09T10:10:00.000Z',
      dbPath: '/db',
      override: { branch: 'manual', entire_link: 'entire:abc' },
    },
    {
      resolveTierA: async () => calls.push('A'),
      findBranchAt: () => calls.push('B'),
      resolveTierC: async () => calls.push('C'),
    },
  );
  assert.deepEqual(r, { branch: 'manual', entire_link: 'entire:abc', tier: 'OVERRIDE', confidence: 'high' });
  assert.deepEqual(calls, []);
});

