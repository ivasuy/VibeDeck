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

function getIdleTimeoutMin() {
  const parsed = parseInt(process.env.VIBEDECK_IDLE_TIMEOUT_MIN || '30', 10);
  return Number.isFinite(parsed) ? parsed : 30;
}

function toValidDate(value) {
  if (!isNonEmptyString(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function isRecentLogCompleteCheckpoint(event, now = new Date()) {
  if (!event || event.kind !== 'end' || event.end_reason !== 'log_complete') return false;
  const endedAt = toValidDate(event.ended_at);
  if (!endedAt) return false;
  const ageMs = now.getTime() - endedAt.getTime();
  return ageMs <= getIdleTimeoutMin() * 60 * 1000;
}

function shouldKeepSessionOpenForCheckpoint(existing, event) {
  if (!isRecentLogCompleteCheckpoint(event)) return false;
  if (!existing) return true;
  if (existing.ended_at == null) return true;
  return existing.end_reason === 'log_complete';
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

function updateSessionEndedState(db, { provider, session_id, ended_at, end_reason } = {}) {
  const now = new Date().toISOString();
  db.prepare(
    `
    UPDATE vibedeck_sessions
    SET ended_at = ?, end_reason = ?, updated_at = ?
    WHERE provider = ? AND session_id = ?
    `,
  ).run(ended_at, end_reason, now, provider, session_id);
}

async function processSessionEvent(dbPath, event) {
  if (!isNonEmptyString(dbPath)) throw new TypeError('processSessionEvent: dbPath must be a non-empty string');
  if (!event || typeof event !== 'object') return;
  if (!isNonEmptyString(event.provider) || !isNonEmptyString(event.session_id)) return;

  let existingBeforeUpsert = null;
  {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      existingBeforeUpsert = loadSession(db, { provider: event.provider, session_id: event.session_id });
    } finally {
      db.close();
    }
  }

  const keepOpenForCheckpoint = shouldKeepSessionOpenForCheckpoint(existingBeforeUpsert, event);

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
        if (keepOpenForCheckpoint) {
          updateSessionEndedState(db, {
            provider: event.provider,
            session_id: event.session_id,
            ended_at: null,
            end_reason: null,
          });
        } else if (
          isRecentLogCompleteCheckpoint(event) &&
          existingBeforeUpsert &&
          existingBeforeUpsert.ended_at != null &&
          existingBeforeUpsert.end_reason !== 'log_complete'
        ) {
          updateSessionEndedState(db, {
            provider: event.provider,
            session_id: event.session_id,
            ended_at: existingBeforeUpsert.ended_at,
            end_reason: existingBeforeUpsert.end_reason,
          });
        }
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
        } else if (latest) {
          persistBranchWindows(db, { provider: latest.provider, session_id: latest.session_id, windows: [] });
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
      const busEventKind = keepOpenForCheckpoint ? 'update' : event.kind;
      const payload = {
        ...event,
        kind: busEventKind,
        ended_at: latest ? latest.ended_at : event.ended_at,
        end_reason: latest ? latest.end_reason : event.end_reason,
        repo_root: latest ? latest.repo_root : null,
        branch: latest ? latest.branch : null,
        tier: latest ? latest.branch_resolution_tier : null,
        confidence: latest ? latest.confidence : null,
        total_tokens: latest ? latest.total_tokens : event.total_tokens,
      };
      bus.emit(`session:${busEventKind}`, payload);
    } finally {
      db.close();
    }
  }
}

module.exports = { processSessionEvent };
