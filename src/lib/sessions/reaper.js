'use strict';

const { DatabaseSync } = require('node:sqlite');
const { getIdleTimeoutMin } = require('./idle-timeout');
const { sessionActivityIso, shouldReapIdleSession } = require('./activity-state');

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

function toDateOrThrow(now) {
  if (now == null) return new Date();
  if (now instanceof Date) return now;
  if (typeof now === 'string') {
    const d = new Date(now);
    if (!Number.isFinite(d.getTime())) throw new TypeError('reapOrphanedSessions: now must be a valid Date or ISO string');
    return d;
  }
  throw new TypeError('reapOrphanedSessions: now must be a Date or ISO string');
}

function reapOrphanedSessions(dbPath, { now, idleTimeoutMin, endReason = 'orphan_reaped' } = {}) {
  if (!isNonEmptyString(dbPath)) throw new TypeError('reapOrphanedSessions: dbPath must be a non-empty string');

  const timeoutMin = getIdleTimeoutMin(idleTimeoutMin);

  const nowDate = toDateOrThrow(now);
  const db = new DatabaseSync(dbPath);
  try {
    const live = db
      .prepare('SELECT provider, session_id, started_at, last_observed_at, updated_at, ended_at FROM vibedeck_sessions WHERE ended_at IS NULL')
      .all();

    const update = db.prepare(
      `
      UPDATE vibedeck_sessions
      SET ended_at = ?, end_reason = ?, updated_at = ?
      WHERE provider = ? AND session_id = ? AND ended_at IS NULL
      `,
    );

    let reaped = 0;
    db.exec('BEGIN');
    try {
      for (const row of live) {
        const lastActivityIso = sessionActivityIso(row);
        if (!lastActivityIso) continue;
        if (shouldReapIdleSession(row, { now: nowDate, idleTimeoutMin: timeoutMin })) {
          update.run(lastActivityIso, endReason, nowDate.toISOString(), row.provider, row.session_id);
          reaped += 1;
        }
      }
      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore
      }
      throw err;
    }

    return { reaped, scanned: live.length };
  } finally {
    db.close();
  }
}

module.exports = { reapOrphanedSessions };
