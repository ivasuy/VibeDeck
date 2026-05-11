const test = require('node:test');
const assert = require('node:assert/strict');

function makeBridgeStub({ present = true, listResult, checkpointsByPath, detectThrows, readThrows, readPaths }) {
  return {
    async detectEntire() {
      if (detectThrows) throw new Error(detectThrows);
      return { present, version: present ? '1.2.3' : null };
    },
    async listCheckpointsCached() {
      return listResult;
    },
    async readCheckpoint(_repoRoot, filePath) {
      if (readPaths) readPaths.push(filePath);
      if (readThrows) throw new Error(readThrows);
      if (!checkpointsByPath || !Object.prototype.hasOwnProperty.call(checkpointsByPath, filePath)) {
        throw new Error(`missing checkpoint for ${filePath}`);
      }
      return checkpointsByPath[filePath];
    },
  };
}

test('tier A: exact one match returns high confidence and correct branch + entire_session_id', async () => {
  const bridge = makeBridgeStub({
    listResult: { available: true, files: ['sessions/a.json'] },
    checkpointsByPath: {
      'sessions/a.json': {
        entire_session_id: '2026-05-09-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        agent: 'claude-code',
        branch: 'feature/x',
        started_at: '2026-05-09T10:00:00.000Z',
        ended_at: '2026-05-09T10:10:00.000Z',
        checkpoint_id: 'aaaaaaaaaaaa',
      },
    },
  });

  const { resolveBranchTierA } = require('../src/lib/sessions/tier-a-entire');
  const r = await resolveBranchTierA({
    repoRoot: '/repo',
    provider: 'claude',
    started_at: '2026-05-09T10:01:00.000Z',
    ended_at: '2026-05-09T10:02:00.000Z',
    bridge,
  });
  assert.deepEqual(r, {
    branch: 'feature/x',
    entire_session_id: '2026-05-09-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    checkpoint_ids: ['aaaaaaaaaaaa'],
    confidence: 'high',
  });
});

test('tier A: multiple overlapping candidates returns medium confidence, includes all ids, and picks closest start', async () => {
  const bridge = makeBridgeStub({
    listResult: { available: true, files: ['sessions/a.json', 'sessions/b.json'] },
    checkpointsByPath: {
      'sessions/a.json': {
        entire_session_id: 'sA',
        agent: 'codex',
        branch: 'branchA',
        started_at: '2026-05-09T10:00:00.000Z',
        ended_at: '2026-05-09T10:20:00.000Z',
        checkpoint_id: 'aaaaaaaaaaaa',
      },
      'sessions/b.json': {
        entire_session_id: 'sB',
        agent: 'codex',
        branch: 'branchB',
        started_at: '2026-05-09T10:09:00.000Z',
        ended_at: '2026-05-09T10:30:00.000Z',
        checkpoint_id: 'bbbbbbbbbbbb',
      },
    },
  });

  const { resolveBranchTierA } = require('../src/lib/sessions/tier-a-entire');
  const r = await resolveBranchTierA({
    repoRoot: '/repo',
    provider: 'codex',
    started_at: '2026-05-09T10:10:00.000Z',
    ended_at: '2026-05-09T10:11:00.000Z',
    bridge,
  });

  assert.equal(r.confidence, 'medium');
  assert.equal(r.branch, 'branchB', 'expected closest-start candidate to win');
  assert.equal(r.entire_session_id, 'sB');
  assert.deepEqual(r.checkpoint_ids.sort(), ['aaaaaaaaaaaa', 'bbbbbbbbbbbb'].sort());
});

test('tier A: checkpoints branch not fetched returns null silently', async () => {
  const bridge = makeBridgeStub({
    listResult: { available: false, reason: 'branch_not_fetched' },
  });
  const { resolveBranchTierA } = require('../src/lib/sessions/tier-a-entire');
  const r = await resolveBranchTierA({
    repoRoot: '/repo',
    provider: 'codex',
    started_at: '2026-05-09T10:00:00.000Z',
    ended_at: '2026-05-09T10:01:00.000Z',
    bridge,
  });
  assert.equal(r, null);
});

test('tier A: skips non-metadata checkpoint payload files without warnings', async () => {
  const logs = [];
  const readPaths = [];
  const prev = console.warn;
  console.warn = (...args) => logs.push(args.join(' '));
  try {
    const bridge = makeBridgeStub({
      readPaths,
      listResult: {
        available: true,
        files: [
          '9c/caea628c7a/1/content_hash.txt',
          '9c/caea628c7a/1/full.jsonl',
          '9c/caea628c7a/1/prompt.txt',
          'sessions/a.json',
        ],
      },
      checkpointsByPath: {
        'sessions/a.json': {
          entire_session_id: 's1',
          agent: 'codex',
          branch: 'main',
          started_at: '2026-05-09T10:00:00.000Z',
          ended_at: '2026-05-09T10:10:00.000Z',
          checkpoint_id: 'aaaaaaaaaaaa',
        },
      },
    });
    const { resolveBranchTierA } = require('../src/lib/sessions/tier-a-entire');
    const r = await resolveBranchTierA({
      repoRoot: '/repo',
      provider: 'codex',
      started_at: '2026-05-09T10:01:00.000Z',
      ended_at: '2026-05-09T10:02:00.000Z',
      bridge,
    });

    assert.equal(r.branch, 'main');
    assert.deepEqual(readPaths, ['sessions/a.json']);
    assert.equal(logs.some((l) => l.includes('tierA_entire_read_error')), false);
  } finally {
    console.warn = prev;
  }
});

test('tier A: detectEntire errors return null and logs a structured warning', async () => {
  const logs = [];
  const prev = console.warn;
  console.warn = (...args) => logs.push(args.join(' '));
  try {
    const bridge = makeBridgeStub({
      detectThrows: 'entire crashed',
      listResult: { available: true, files: [] },
    });
    const { resolveBranchTierA } = require('../src/lib/sessions/tier-a-entire');
    const r = await resolveBranchTierA({
      repoRoot: '/repo',
      provider: 'codex',
      started_at: '2026-05-09T10:00:00.000Z',
      ended_at: '2026-05-09T10:01:00.000Z',
      bridge,
    });
    assert.equal(r, null);
    assert.ok(logs.some((l) => l.includes('tierA_entire_detect_error')), 'expected structured warn tag');
  } finally {
    console.warn = prev;
  }
});

test('tier A: resolves even when provider has no cwd (repoRoot + time match is enough)', async () => {
  const bridge = makeBridgeStub({
    listResult: { available: true, files: ['sessions/a.json'] },
    checkpointsByPath: {
      'sessions/a.json': {
        entire_session_id: 's1',
        agent: 'cursor',
        branch: 'main',
        started_at: '2026-05-09T10:00:00.000Z',
        ended_at: '2026-05-09T10:10:00.000Z',
        checkpoint_id: 'aaaaaaaaaaaa',
      },
    },
  });

  const { resolveBranchTierA } = require('../src/lib/sessions/tier-a-entire');
  const r = await resolveBranchTierA({
    repoRoot: '/repo',
    provider: 'cursor',
    started_at: '2026-05-09T10:01:00.000Z',
    ended_at: '2026-05-09T10:02:00.000Z',
    bridge,
  });
  assert.equal(r.branch, 'main');
});

test('tier A: agent mismatch returns null', async () => {
  const bridge = makeBridgeStub({
    listResult: { available: true, files: ['sessions/a.json'] },
    checkpointsByPath: {
      'sessions/a.json': {
        entire_session_id: 's1',
        agent: 'claude-code',
        branch: 'main',
        started_at: '2026-05-09T10:00:00.000Z',
        ended_at: '2026-05-09T10:10:00.000Z',
        checkpoint_id: 'aaaaaaaaaaaa',
      },
    },
  });

  const { resolveBranchTierA } = require('../src/lib/sessions/tier-a-entire');
  const r = await resolveBranchTierA({
    repoRoot: '/repo',
    provider: 'codex',
    started_at: '2026-05-09T10:01:00.000Z',
    ended_at: '2026-05-09T10:02:00.000Z',
    bridge,
  });
  assert.equal(r, null);
});
