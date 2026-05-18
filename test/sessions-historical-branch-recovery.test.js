const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sync: execaSync } = require('execa');

const { recoverHistoricalBranchForUnknownGit } = require('../src/lib/sessions/historical-branch-recovery');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(cwd, args, opts = {}) {
  const env = opts.env ? { ...process.env, ...opts.env } : process.env;
  return execaSync('git', ['-C', cwd, ...args], { stdio: 'pipe', env });
}

function initRepo(dir, firstCommitIso) {
  git(dir, ['init']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'init\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'init'], {
    env: {
      GIT_AUTHOR_DATE: firstCommitIso,
      GIT_COMMITTER_DATE: firstCommitIso,
    },
  });
}

function commitFile(dir, filename, contents, iso, message) {
  fs.writeFileSync(path.join(dir, filename), contents);
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', message], {
    env: {
      GIT_AUTHOR_DATE: iso,
      GIT_COMMITTER_DATE: iso,
    },
  });
}

test('recoverHistoricalBranchForUnknownGit returns a clean local branch when Git proves it', async () => {
  const dir = tmpDir('vd-historical-recover-');
  try {
    initRepo(dir, '2026-05-10T10:00:00.000Z');
    git(dir, ['checkout', '-b', 'feature/recover']);
    commitFile(dir, 'feature.txt', 'x\n', '2026-05-10T10:01:00.000Z', 'feature');

    const result = await recoverHistoricalBranchForUnknownGit({
      repoRoot: dir,
      observedAt: '2026-05-10T10:05:00.000Z',
    });

    assert.deepEqual(result, {
      branch: 'feature/recover',
      branch_kind: 'known',
      confidence: 'low',
      branch_resolution_tier: 'C',
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('recoverHistoricalBranchForUnknownGit returns Historical unknown before current repo history exists', async () => {
  const dir = tmpDir('vd-historical-guard-');
  try {
    initRepo(dir, '2026-05-10T10:00:00.000Z');

    const result = await recoverHistoricalBranchForUnknownGit({
      repoRoot: dir,
      observedAt: '2026-05-10T09:59:59.000Z',
    });

    assert.deepEqual(result, {
      branch: 'Historical unknown',
      branch_kind: 'historical_unknown',
      confidence: 'low',
      branch_resolution_tier: 'HISTORICAL_GUARD',
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('recoverHistoricalBranchForUnknownGit rejects tags/..., HEAD, and detached@... names as branch recovery', async () => {
  const values = ['tags/v1.2.3', 'HEAD', 'detached@1234abc'];

  for (const branch of values) {
    const result = await recoverHistoricalBranchForUnknownGit(
      {
        repoRoot: '/tmp/repo',
        observedAt: '2026-05-10T10:05:00.000Z',
      },
      {
        firstCommitIsoFromGit: () => '2026-05-10T10:00:00.000Z',
        listLocalBranchesFromGit: () => ['main', 'feature/recover'],
        resolveTierC: async () => ({ branch, confidence: 'low' }),
      },
    );

    assert.equal(result, null);
  }
});
