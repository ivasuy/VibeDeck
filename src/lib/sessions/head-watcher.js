'use strict';

const chokidar = require('chokidar');
const fs = require('node:fs');
const path = require('node:path');

const { recordTransition, getActiveRepos } = require('./head-history');

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

function normalizeRepoEntry(e) {
  if (e == null) return null;
  if (typeof e === 'string') return { repo_root: e, worktree_root: e };
  if (typeof e === 'object' && isNonEmptyString(e.repo_root)) {
    return { repo_root: e.repo_root, worktree_root: isNonEmptyString(e.worktree_root) ? e.worktree_root : e.repo_root };
  }
  return null;
}

function parseHeadContent(raw) {
  const s = String(raw || '').trim();
  if (s.startsWith('ref:')) return s.replace(/^ref:\s*/, '').trim();
  if (/^[0-9a-f]{40}$/i.test(s)) return `detached@${s.slice(0, 7).toLowerCase()}`;
  return null;
}

function resolveWorktreeRootFromGitdir(repoRoot, worktreeName) {
  try {
    const gitdirPath = path.join(repoRoot, '.git', 'worktrees', worktreeName, 'gitdir');
    const raw = fs.readFileSync(gitdirPath, 'utf8').trim();
    if (!raw) return null;
    // gitdir file points at the worktree's ".git" path; worktree root is its parent.
    return path.resolve(path.dirname(raw));
  } catch {
    return null;
  }
}

function classifyHeadPath(filePath) {
  const norm = path.normalize(filePath);
  const headSuffix = `${path.sep}.git${path.sep}HEAD`;
  if (norm.endsWith(headSuffix)) {
    const repoRoot = norm.slice(0, -headSuffix.length);
    return { repo_root: repoRoot, worktree_root: repoRoot };
  }

  const m = norm.match(new RegExp(`^(.*)\\${path.sep}\\.git\\${path.sep}worktrees\\${path.sep}([^\\${path.sep}]+)\\${path.sep}HEAD$`));
  if (!m) return null;
  const repoRoot = m[1];
  const worktreeName = m[2];
  const worktreeRoot = resolveWorktreeRootFromGitdir(repoRoot, worktreeName) || path.join(repoRoot, '.git', 'worktrees', worktreeName);
  return { repo_root: repoRoot, worktree_root: worktreeRoot };
}

function addRepoWatches(watcher, repoRoot) {
  watcher.add(path.join(repoRoot, '.git', 'HEAD'));
  watcher.add(path.join(repoRoot, '.git', 'worktrees', '*', 'HEAD'));
}

function startHeadWatcher({ dbPath, repos, polling } = {}) {
  if (!isNonEmptyString(dbPath)) throw new TypeError('startHeadWatcher: dbPath must be a non-empty string');

  // Polling is the safe default for .git/HEAD: git uses atomic-replace (open
  // temp, fsync, rename) which native fsevents/inotify often miss because the
  // inode changes. Polling catches the new content reliably. HEAD changes
  // happen at checkout granularity (rare), so polling overhead is negligible.
  // env VIBEDECK_WATCHER_POLLING=1 force-on; explicit polling:false opts out.
  const envOn = process.env.VIBEDECK_WATCHER_POLLING === '1';
  const usePolling = envOn ? true : polling !== false;
  const pollInterval = Number(process.env.VIBEDECK_WATCHER_POLL_MS) || 250;

  const watcher = chokidar.watch([], {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: false,
    usePolling,
    interval: pollInterval,
    binaryInterval: pollInterval,
  });

  const handle = {
    dbPath,
    watcher,
    usePolling,
    _repos: new Set(),
    ready: null,
  };

  let readyResolved = false;
  handle.ready = new Promise((resolve) => {
    watcher.once('ready', () => {
      readyResolved = true;
      resolve();
    });
  });

  function onChange(filePath) {
    const meta = classifyHeadPath(filePath);
    if (!meta) return;

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch {
      return;
    }
    const ref = parseHeadContent(content);
    if (!ref) return;

    recordTransition(dbPath, {
      repo_root: meta.repo_root,
      worktree_root: meta.worktree_root,
      ref_name: ref,
      transitioned_at: new Date().toISOString(),
    });
  }

  watcher.on('change', onChange);
  watcher.on('add', onChange);

  let seed = [];
  if (repos === 'active') {
    seed = getActiveRepos(dbPath, { sinceDays: 7 });
  } else if (Array.isArray(repos)) {
    seed = repos.map(normalizeRepoEntry).filter(Boolean);
  } else if (repos != null) {
    const one = normalizeRepoEntry(repos);
    if (one) seed = [one];
  }

  for (const r of seed) {
    const repoRoot = r.repo_root;
    if (!isNonEmptyString(repoRoot)) continue;
    const key = repoRoot;
    if (handle._repos.has(key)) continue;
    handle._repos.add(key);
    addRepoWatches(watcher, repoRoot);
  }

  // Chokidar does not reliably emit "ready" for an empty initial watch list.
  if (seed.length === 0 && !readyResolved) {
    readyResolved = true;
    handle.ready = Promise.resolve();
  }

  return handle;
}

function registerActiveRepo(handle, { repo_root, worktree_root } = {}) {
  if (!handle || !handle.watcher || !isNonEmptyString(handle.dbPath)) {
    throw new TypeError('registerActiveRepo: invalid watcher handle');
  }
  if (!isNonEmptyString(repo_root)) throw new TypeError('registerActiveRepo: repo_root must be a non-empty string');
  const repoRoot = repo_root;
  if (handle._repos.has(repoRoot)) return;
  handle._repos.add(repoRoot);
  addRepoWatches(handle.watcher, repoRoot);

  if (isNonEmptyString(worktree_root) && worktree_root !== repo_root) {
    // Placeholder: worktree_root is persisted via file-derived paths on change events.
  }
}

async function stopHeadWatcher(handle) {
  if (!handle || !handle.watcher) return;
  try {
    await handle.watcher.close();
  } catch {
    // ignore
  }
}

module.exports = { startHeadWatcher, stopHeadWatcher, registerActiveRepo };
