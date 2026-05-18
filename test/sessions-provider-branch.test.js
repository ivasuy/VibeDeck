const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { makeUpdate } = require('../src/lib/sessions/event');
const { extractClaudeCodeSessionEvents, extractCodexSessionEvents } = require('../src/lib/sessions/extractors');
const {
  cleanProviderBranch,
  collectProviderBranchFromObject,
  createProviderBranchState,
  readProviderBranchFromSessionFile,
} = require('../src/lib/sessions/provider-branch');

function tempJsonl(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-provider-branch-'));
  const file = path.join(dir, 'session.jsonl');
  fs.writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8');
  return {
    file,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

test('cleanProviderBranch accepts local-looking branches', () => {
  assert.equal(cleanProviderBranch('main'), 'main');
  assert.equal(cleanProviderBranch('feature/provider-branch'), 'feature/provider-branch');
});

test('cleanProviderBranch rejects unsafe refs and sentinels', () => {
  for (const value of [
    '',
    'HEAD',
    'Unknown branch',
    'Historical unknown',
    'tags/v1.2.3',
    'refs/tags/v1.2.3',
    'origin/main',
    'remotes/origin/main',
    'refs/remotes/origin/main',
    'detached@abc1234',
  ]) {
    assert.equal(cleanProviderBranch(value), null, `${value} should be rejected`);
  }
});

test('collectProviderBranchFromObject records Codex payload.git.branch', () => {
  const state = createProviderBranchState();
  collectProviderBranchFromObject('codex', { payload: { git: { branch: 'main' } } }, state);
  assert.deepEqual([...state.branches], ['main']);
  assert.equal(state.unsafe, false);
});

test('collectProviderBranchFromObject records Claude gitBranch', () => {
  const state = createProviderBranchState();
  collectProviderBranchFromObject('claude', { gitBranch: 'feature/claude' }, state);
  assert.deepEqual([...state.branches], ['feature/claude']);
  assert.equal(state.unsafe, false);
});

test('readProviderBranchFromSessionFile returns one clean Codex branch', () => {
  const tmp = tempJsonl([{ payload: { git: { branch: 'main' } } }, { type: 'event_msg' }]);
  try {
    assert.deepEqual(readProviderBranchFromSessionFile({ provider: 'codex', session_id: tmp.file }), {
      branch: 'main',
      branch_kind: 'known',
      confidence: 'medium',
      branch_resolution_tier: 'PROVIDER_LOG',
    });
  } finally {
    tmp.cleanup();
  }
});

test('readProviderBranchFromSessionFile returns one clean Claude branch', () => {
  const tmp = tempJsonl([{ gitBranch: 'main' }, { gitBranch: 'main', type: 'assistant' }]);
  try {
    assert.deepEqual(readProviderBranchFromSessionFile({ provider: 'claude', session_id: tmp.file }), {
      branch: 'main',
      branch_kind: 'known',
      confidence: 'medium',
      branch_resolution_tier: 'PROVIDER_LOG',
    });
  } finally {
    tmp.cleanup();
  }
});

test('readProviderBranchFromSessionFile returns null for mixed branches', () => {
  const tmp = tempJsonl([{ payload: { git: { branch: 'main' } } }, { payload: { git: { branch: 'feature/changed' } } }]);
  try {
    assert.equal(readProviderBranchFromSessionFile({ provider: 'codex', session_id: tmp.file }), null);
  } finally {
    tmp.cleanup();
  }
});

test('readProviderBranchFromSessionFile returns null for unsafe refs', () => {
  const tmp = tempJsonl([{ gitBranch: 'tags/v1.2.3' }]);
  try {
    assert.equal(readProviderBranchFromSessionFile({ provider: 'claude', session_id: tmp.file }), null);
  } finally {
    tmp.cleanup();
  }
});

test('SessionEvent accepts optional provider branch', () => {
  const event = makeUpdate({
    provider: 'codex',
    session_id: 's1',
    observed_at: '2026-05-18T00:00:00.000Z',
    delta_tokens: 10,
    cwd: '/tmp/repo',
    model: 'gpt-5.4',
    branch: 'main',
  });

  assert.equal(event.branch, 'main');
});

test('Codex and Claude extractors pass batch branch to update events', () => {
  const codexEvents = extractCodexSessionEvents({
    session_id: 'codex-s1',
    started_at: '2026-05-18T00:00:00.000Z',
    branch: 'main',
    updates: [{ observed_at: '2026-05-18T00:01:00.000Z', delta_tokens: 12 }],
  });
  const codexUpdate = codexEvents.find((event) => event.kind === 'update');
  assert.equal(codexUpdate.branch, 'main');

  const claudeEvents = extractClaudeCodeSessionEvents({
    session_id: 'claude-s1',
    started_at: '2026-05-18T00:00:00.000Z',
    branch: 'feature/claude',
    updates: [{ observed_at: '2026-05-18T00:01:00.000Z', delta_tokens: 5 }],
  });
  const claudeUpdate = claudeEvents.find((event) => event.kind === 'update');
  assert.equal(claudeUpdate.branch, 'feature/claude');
});
