'use strict';

const { DatabaseSync } = require('node:sqlite');

const { resolveRepo } = require('./repo-resolver');
const { upsertSessionFromEvents } = require('./writer');
const { resolveBranchForSession } = require('./resolve-branch');
const { splitSessionByBranchTransitions } = require('./branch-windows');
const { getLiveBus } = require('./live-bus');

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

function loadSession(db, { provider, session_id } = {}) {
  return (
    db
      .prepare('SELECT * FROM vibedeck_sessions WHERE provider = ? AND session_id = ?')
      .get(provider, session_id) || null
  );
}

function updateRepoMeta(db, { provider, session_id, repo } = {}) {
  if (!repo || typeof repo !== 'object') return;
  if (!isNonEmptyString(repo.repo_root)) return;
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE vibedeck_sessions
    SET repo_root = ?, repo_common_dir = ?, parent_repo = ?, updated_at = ?
    WHERE provider = ? AND session_id = ?
    `,
  ).run(repo.repo_root, repo.repo_common_dir, repo.parent_repo, now, provider, session_id);
}

function updateBranchResolution(db, { provider, session_id, branch, tier, confidence } = {}) {
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE vibedeck_sessions
    SET branch = ?, branch_resolution_tier = ?, confidence = ?, updated_at = ?
    WHERE provider = ? AND session_id = ?
    `,
  ).run(branch, tier, confidence, now, provider, session_id);
}

function listTransitions(db, { worktree_root, started_at, ended_at } = {}) {
  if (!isNonEmptyString(worktree_root) || !isNonEmptyString(started_at) || !isNonEmptyString(ended_at)) return [];
  return db
    .prepare(
      `
      SELECT transitioned_at, ref_name
      FROM vibedeck_head_history
      WHERE worktree_root = ? AND transitioned_at > ? AND transitioned_at < ?
      ORDER BY transitioned_at ASC
      `,
    )
    .all(worktree_root, started_at, ended_at);
}

function persistBranchWindows(db, { provider, session_id, windows } = {}) {
  db.prepare('DELETE FROM vibedeck_session_branch_windows WHERE provider = ? AND session_id = ?').run(
    provider,
    session_id,
  );
  const insert = db.prepare(
    `
    INSERT INTO vibedeck_session_branch_windows (
      provider, session_id, branch, window_start, window_end, prorated_tokens, prorated_cost_usd
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  );
  for (const w of windows) {
    insert.run(
      provider,
      session_id,
      w.branch == null ? '' : String(w.branch),
      w.window_start,
      w.window_end,
      w.prorated_tokens == null ? null : w.prorated_tokens,
      w.prorated_cost_usd == null ? null : w.prorated_cost_usd,
    );
  }
}

async function processSessionEvent(dbPath, event) {
  if (!isNonEmptyString(dbPath)) throw new TypeError('processSessionEvent: dbPath must be a non-empty string');
  if (!event || typeof event !== 'object') return;
  if (!isNonEmptyString(event.provider) || !isNonEmptyString(event.session_id)) return;

  let repo = null;
  if (isNonEmptyString(event.cwd)) {
    try {
      repo = resolveRepo(event.cwd);
    } catch {
      repo = null;
    }
  }

  upsertSessionFromEvents(dbPath, [event]);

  // 1) Repo attribution (best-effort).
  {
    const db = new DatabaseSync(dbPath);
    try {
      db.exec('BEGIN');
      try {
        updateRepoMeta(db, { provider: event.provider, session_id: event.session_id, repo });
        db.exec('COMMIT');
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {}
        throw err;
      }
    } finally {
      db.close();
    }
  }

  // 2) Branch resolution.
  let session;
  {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      session = loadSession(db, { provider: event.provider, session_id: event.session_id });
    } finally {
      db.close();
    }
  }
  if (!session) return;

  const branchRes = await resolveBranchForSession({
    provider: session.provider,
    session_id: session.session_id,
    repo_root: session.repo_root,
    started_at: session.started_at,
    ended_at: session.ended_at,
    dbPath,
  });

  {
    const db = new DatabaseSync(dbPath);
    try {
      db.exec('BEGIN');
      try {
        updateBranchResolution(db, {
          provider: session.provider,
          session_id: session.session_id,
          branch: branchRes.branch,
          tier: branchRes.tier,
          confidence: branchRes.confidence,
        });

        const latest = loadSession(db, { provider: session.provider, session_id: session.session_id });
        if (latest && latest.ended_at) {
          const transitions = listTransitions(db, {
            worktree_root: latest.repo_root,
            started_at: latest.started_at,
            ended_at: latest.ended_at,
          });
          const windows = splitSessionByBranchTransitions({
            session: {
              started_at: latest.started_at,
              ended_at: latest.ended_at,
              total_tokens: latest.total_tokens,
              total_cost_usd: latest.total_cost_usd,
              branch: branchRes.branch,
            },
            transitions,
          });
          persistBranchWindows(db, { provider: latest.provider, session_id: latest.session_id, windows });
        }

        db.exec('COMMIT');
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {}
        throw err;
      }

      const latest = loadSession(db, { provider: session.provider, session_id: session.session_id });
      const bus = getLiveBus();
      const payload = {
        ...event,
        repo_root: latest ? latest.repo_root : null,
        branch: latest ? latest.branch : null,
        tier: latest ? latest.branch_resolution_tier : null,
        confidence: latest ? latest.confidence : null,
        total_tokens: latest ? latest.total_tokens : event.total_tokens,
      };
      bus.emit(`session:${event.kind}`, payload);
    } finally {
      db.close();
    }
  }
}

module.exports = { processSessionEvent };
