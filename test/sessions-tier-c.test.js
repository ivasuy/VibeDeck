const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sync: execaSync } = require('execa');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(cwd, args, opts = {}) {
  const env = opts.env ? { ...process.env, ...opts.env } : process.env;
  return execaSync('git', ['-C', cwd, ...args], { stdio: 'pipe', env });
}

function initRepo(dir) {
  git(dir, ['init']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'x');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'init']);
}

function sha(dir, rev) {
  return git(dir, ['rev-parse', rev]).stdout.trim();
}

function setHeadReflog(dir, lines) {
  const logPath = path.join(dir, '.git', 'logs', 'HEAD');
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
}

function reflogLine({ oldSha, newSha, isoWithOffset, tzNoColon, message }) {
  const ms = new Date(isoWithOffset).getTime();
  const secs = Math.floor(ms / 1000);
  return `${oldSha} ${newSha} Test User <test@example.com> ${secs} ${tzNoColon}\t${message}`;
}

test('tier C: reflog parsed and matches branch at session time', async () => {
  const dir = tmpDir('vd-tier-c-basic-');
  try {
    initRepo(dir);
    git(dir, ['checkout', '-b', 'feature/x']);
    fs.writeFileSync(path.join(dir, 'x.txt'), 'x');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-m', 'x']);
    const shaMain = sha(dir, 'main');
    const shaFeature = sha(dir, 'feature/x');

    setHeadReflog(dir, [
      reflogLine({
        oldSha: shaMain,
        newSha: shaFeature,
        isoWithOffset: '2026-05-09T10:00:00-04:00',
        tzNoColon: '-0400',
        message: 'checkout: moving from main to feature/x',
      }),
    ]);

    const { resolveBranchTierC } = require('../src/lib/sessions/tier-c-reflog');
    const r = await resolveBranchTierC({ repoRoot: dir, when: '2026-05-09T14:00:00.000Z' });
    assert.deepEqual(r, { branch: 'feature/x', confidence: 'low' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tier C: DST transition offsets convert to exact UTC', async () => {
  const dir = tmpDir('vd-tier-c-dst-');
  try {
    initRepo(dir);
    git(dir, ['checkout', '-b', 'dst/a']);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-m', 'a']);

    git(dir, ['checkout', '-b', 'dst/b']);
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-m', 'b']);

    const shaA = sha(dir, 'dst/a');
    const shaB = sha(dir, 'dst/b');

    // America/New_York DST in 2026: offset jumps -05:00 -> -04:00.
    setHeadReflog(dir, [
      reflogLine({
        oldSha: shaA,
        newSha: shaA,
        isoWithOffset: '2026-03-08T01:59:00-05:00',
        tzNoColon: '-0500',
        message: 'checkout: moving from main to dst/a',
      }),
      reflogLine({
        oldSha: shaA,
        newSha: shaB,
        isoWithOffset: '2026-03-08T03:01:00-04:00',
        tzNoColon: '-0400',
        message: 'checkout: moving from dst/a to dst/b',
      }),
    ]);

    const { resolveBranchTierC } = require('../src/lib/sessions/tier-c-reflog');
    // 2026-03-08T01:59:00-05:00 == 2026-03-08T06:59:00Z
    const r1 = await resolveBranchTierC({ repoRoot: dir, when: '2026-03-08T06:59:00.000Z' });
    assert.deepEqual(r1, { branch: 'dst/a', confidence: 'low' });

    // 2026-03-08T03:01:00-04:00 == 2026-03-08T07:01:00Z
    const r2 = await resolveBranchTierC({ repoRoot: dir, when: '2026-03-08T07:01:00.000Z' });
    assert.deepEqual(r2, { branch: 'dst/b', confidence: 'low' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tier C: zero-commit repo reflog returns null', async () => {
  const dir = tmpDir('vd-tier-c-zero-');
  try {
    git(dir, ['init']);
    const { resolveBranchTierC } = require('../src/lib/sessions/tier-c-reflog');
    const r = await resolveBranchTierC({ repoRoot: dir, when: '2026-05-09T10:00:00.000Z' });
    assert.equal(r, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tier C: multiple checkouts pick latest entry <= when', async () => {
  const dir = tmpDir('vd-tier-c-multi-');
  try {
    initRepo(dir);
    git(dir, ['checkout', '-b', 'a']);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-m', 'a']);
    git(dir, ['checkout', '-b', 'b']);
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-m', 'b']);
    const shaMain = sha(dir, 'main');
    const shaA = sha(dir, 'a');
    const shaB = sha(dir, 'b');

    setHeadReflog(dir, [
      reflogLine({
        oldSha: shaMain,
        newSha: shaA,
        isoWithOffset: '2026-05-09T10:00:00+00:00',
        tzNoColon: '+0000',
        message: 'checkout: moving from main to a',
      }),
      reflogLine({
        oldSha: shaA,
        newSha: shaB,
        isoWithOffset: '2026-05-09T10:05:00+00:00',
        tzNoColon: '+0000',
        message: 'checkout: moving from a to b',
      }),
    ]);

    const { resolveBranchTierC } = require('../src/lib/sessions/tier-c-reflog');
    const r = await resolveBranchTierC({ repoRoot: dir, when: '2026-05-09T10:04:59.000Z' });
    assert.deepEqual(r, { branch: 'a', confidence: 'low' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tier C: detached HEAD sha not in any branch returns detached@<short-sha>', async () => {
  const dir = tmpDir('vd-tier-c-detached-');
  try {
    initRepo(dir);
    git(dir, ['checkout', '-b', 'temp']);
    fs.writeFileSync(path.join(dir, 't.txt'), 't');
    git(dir, ['add', '.']);
    git(dir, ['commit', '-m', 't']);
    const shaTemp = sha(dir, 'HEAD');
    git(dir, ['checkout', shaTemp]);
    git(dir, ['branch', '-D', 'temp']);

    const shaMain = sha(dir, 'main');
    setHeadReflog(dir, [
      reflogLine({
        oldSha: shaMain,
        newSha: shaTemp,
        isoWithOffset: '2026-05-09T10:00:00+00:00',
        tzNoColon: '+0000',
        message: `checkout: moving from main to ${shaTemp}`,
      }),
    ]);

    const { resolveBranchTierC } = require('../src/lib/sessions/tier-c-reflog');
    const r = await resolveBranchTierC({ repoRoot: dir, when: '2026-05-09T10:00:00.000Z' });
    assert.deepEqual(r, { branch: `detached@${shaTemp.slice(0, 7)}`, confidence: 'low' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

