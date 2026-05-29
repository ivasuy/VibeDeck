'use strict';

const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');

const { resolveRepo } = require('./repo-resolver');
const { upsertSessionFromEvents } = require('./writer');
const { resolveBranchForSession } = require('./resolve-branch');
const { rebuildBranchUsageFactsForSession } = require('./branch-usage-facts');
const { getLiveBus } = require('./live-bus');
const { getIdleTimeoutMin } = require('./idle-timeout');
const { insertSessionEvent } = require('./event-ledger');
const { upsertBucketFact, recomputeSessionLedger } = require('./bucket-facts');
// const { upsertEntireLink } = require('./entire-links');
const providerBranch = require('./provider-branch');
const { cleanProviderBranch } = providerBranch;

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
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

function shouldPreserveExistingTerminalEnd(existing, event) {
  return isRecentLogCompleteCheckpoint(event) && !!existing && existing.ended_at != null && existing.end_reason !== 'log_complete';
}

function eventActivityDate(event) {
  if (!event || typeof event !== 'object') return null;
  if (event.kind === 'update') return toValidDate(event.observed_at);
  if (event.kind === 'end') return toValidDate(event.ended_at);
  if (event.kind === 'start') return toValidDate(event.started_at);
  return null;
}

function shouldReopenOrphanedSession(existing, event) {
  if (!existing || existing.end_reason !== 'orphan_reaped') return false;
  const endedAt = toValidDate(existing.ended_at);
  const activityAt = eventActivityDate(event);
  if (!endedAt || !activityAt) return false;
  return activityAt.getTime() > endedAt.getTime();
}

function recoverCodexSessionMetadata(event) {
  if (!event || typeof event !== 'object') return {};
  const provider = String(event.provider || '').trim().toLowerCase();
  if (provider !== 'codex' && provider !== 'every-code') return {};
  if (!isNonEmptyString(event.session_id)) return {};
  if (!event.session_id.endsWith('.jsonl')) return {};

  let fd;
  try {
    fd = fs.openSync(event.session_id, 'r');
    const stat = fs.fstatSync(fd);
    const buffer = Buffer.alloc(Math.min(stat.size, 64 * 1024));
    fs.readSync(fd, buffer, 0, buffer.length, 0);
    const lines = buffer.toString('utf8').split(/\r?\n/);
    for (const line of lines) {
      if (!line.includes('"session_meta"') && !line.includes('"turn_context"')) continue;
      if (!line.includes('"cwd"') && !line.includes('"model"')) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const payload = parsed?.payload && typeof parsed.payload === 'object' ? parsed.payload : null;
      if (!payload) continue;
      const cwd = isNonEmptyString(payload.cwd) ? payload.cwd.trim() : null;
      const model = isNonEmptyString(payload.model) ? payload.model.trim() : null;
      if (cwd || model) return { cwd, model };
    }
  } catch {
    return {};
  } finally {
    if (fd != null) {
      try {
        fs.closeSync(fd);
      } catch {}
    }
  }
  return {};
}

function canReadProviderBranch({ provider, session_id } = {}) {
  const normalizedProvider = String(provider || '').trim().toLowerCase();
  if (!(normalizedProvider === 'codex' || normalizedProvider === 'every-code' || normalizedProvider === 'claude')) {
    return false;
  }
  return isNonEmptyString(session_id) && session_id.endsWith('.jsonl');
}

function recoverProviderBranchFromSessionMetadata(event, { cache = null } = {}) {
  if (!event || typeof event !== 'object') return null;
  if (!canReadProviderBranch({ provider: event.provider, session_id: event.session_id })) return null;
  const recovered = providerBranch.readProviderBranchFromSessionFile({
    provider: event.provider,
    session_id: event.session_id,
    cache,
  });
  return cleanProviderBranch(recovered && recovered.branch);
}

function enrichEventFromSessionMetadata(event, { cache = null } = {}) {
  if (!event || typeof event !== 'object') return event;
  if (isNonEmptyString(event.cwd) && isNonEmptyString(event.model) && isNonEmptyString(event.branch)) return event;
  const recovered = recoverCodexSessionMetadata(event);
  const resolvedProviderBranch = isNonEmptyString(event.branch)
    ? null
    : recoverProviderBranchFromSessionMetadata(event, { cache });
  if (!recovered.cwd && !recovered.model && !resolvedProviderBranch) return event;
  return {
    ...event,
    cwd: isNonEmptyString(event.cwd) ? event.cwd : recovered.cwd ?? event.cwd,
    model: isNonEmptyString(event.model) ? event.model : recovered.model ?? event.model,
    branch: isNonEmptyString(event.branch) ? event.branch : resolvedProviderBranch ?? event.branch,
  };
}

function isRecoverableProvider(provider) {
  const normalized = String(provider || '').trim().toLowerCase();
  return normalized === 'codex' || normalized === 'every-code';
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

function shouldResolveBranch({ existing, session, repo, event, keepOpenForCheckpoint, reopenOrphanedSession, preserveExistingTerminalEnd }) {
  if (!session) return false;
  if (keepOpenForCheckpoint || reopenOrphanedSession || preserveExistingTerminalEnd) return true;
  if (event?.kind === 'start' || event?.kind === 'end') return true;
  const repoRoot = isNonEmptyString(repo?.repo_root) ? repo.repo_root : null;
  if (repoRoot && repoRoot !== existing?.repo_root) return true;
  if (!isNonEmptyString(session.repo_root)) return !isNonEmptyString(session.branch_resolution_tier);
  if (!isNonEmptyString(session.branch_resolution_tier) || !isNonEmptyString(session.confidence)) return true;
  return false;
}

function emitSessionEvent({ event, latest, keepOpenForCheckpoint, reopenOrphanedSession }) {
  const bus = getLiveBus();
  const busEventKind = keepOpenForCheckpoint || reopenOrphanedSession ? 'update' : event.kind;
  const payload = {
    ...event,
    kind: busEventKind,
    ended_at: latest ? latest.ended_at : event.ended_at,
    end_reason: latest ? latest.end_reason : event.end_reason,
    cwd: latest ? latest.cwd : event.cwd,
    repo_root: latest ? latest.repo_root : null,
    repo_common_dir: latest ? latest.repo_common_dir : null,
    parent_repo: latest ? latest.parent_repo : null,
    branch: latest ? latest.branch : null,
    branch_resolution_tier: latest ? latest.branch_resolution_tier : null,
    tier: latest ? latest.branch_resolution_tier : null,
    confidence: latest ? latest.confidence : null,
    model: latest ? latest.model : event.model,
    total_tokens: latest ? latest.total_tokens : event.total_tokens,
    total_cost_usd: latest ? latest.total_cost_usd : event.total_cost_usd,
    input_tokens: latest ? latest.input_tokens : event.input_tokens,
    cached_input_tokens: latest ? latest.cached_input_tokens : event.cached_input_tokens,
    cache_creation_input_tokens: latest ? latest.cache_creation_input_tokens : event.cache_creation_input_tokens,
    output_tokens: latest ? latest.output_tokens : event.output_tokens,
    reasoning_output_tokens: latest ? latest.reasoning_output_tokens : event.reasoning_output_tokens,
    last_observed_at: latest ? latest.last_observed_at : event.observed_at,
    started_at: latest ? latest.started_at : event.started_at,
    updated_at: latest ? latest.updated_at : null,
  };
  bus.emit(`session:${busEventKind}`, payload);
}

function restoreSessionUpdatedAt(dbPath, { provider, session_id, updated_at } = {}) {
  if (!isNonEmptyString(updated_at)) return;
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare(
      `
      UPDATE vibedeck_sessions
      SET updated_at = ?
      WHERE provider = ? AND session_id = ? AND ended_at IS NULL
      `,
    ).run(updated_at, provider, session_id);
  } finally {
    db.close();
  }
}

async function processSessionEvent(dbPath, event, { deferBranchFactRebuild = false } = {}) {
  if (!isNonEmptyString(dbPath)) throw new TypeError('processSessionEvent: dbPath must be a non-empty string');
  if (!event || typeof event !== 'object') return;
  if (!isNonEmptyString(event.provider) || !isNonEmptyString(event.session_id)) return;
  event = enrichEventFromSessionMetadata(event);

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
  const reopenOrphanedSession = shouldReopenOrphanedSession(existingBeforeUpsert, event);
  const preserveExistingTerminalEnd = shouldPreserveExistingTerminalEnd(existingBeforeUpsert, event);

  let repo = null;
  const existingRepoStillApplies =
    event.kind === 'update' &&
    isNonEmptyString(existingBeforeUpsert?.repo_root) &&
    isNonEmptyString(existingBeforeUpsert?.cwd) &&
    isNonEmptyString(event.cwd) &&
    existingBeforeUpsert.cwd === event.cwd;
  if (!existingRepoStillApplies && isNonEmptyString(event.cwd)) {
    try {
      repo = resolveRepo(event.cwd);
    } catch {
      repo = null;
    }
  }

  // 1) Repo attribution (best-effort).
  {
    const db = new DatabaseSync(dbPath);
    try {
      db.exec('BEGIN');
      try {
        upsertSessionFromEvents(dbPath, [event], { db });
        if (keepOpenForCheckpoint || reopenOrphanedSession) {
          updateSessionEndedState(db, {
            provider: event.provider,
            session_id: event.session_id,
            ended_at: null,
            end_reason: null,
          });
        } else if (preserveExistingTerminalEnd) {
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

  const needsBranchResolution = shouldResolveBranch({
    existing: existingBeforeUpsert,
    session,
    repo,
    event,
    keepOpenForCheckpoint,
    reopenOrphanedSession,
    preserveExistingTerminalEnd,
  });
  const providerBranchFromEvent = cleanProviderBranch(event.branch);
  const providerBranchFromLog = providerBranchFromEvent
    ? null
    : canReadProviderBranch({ provider: session.provider, session_id: session.session_id })
      ? cleanProviderBranch(
          (providerBranch.readProviderBranchFromSessionFile({
            provider: session.provider,
            session_id: session.session_id,
            cache: null,
          }) || {}).branch,
        )
      : null;
  const resolvedProviderBranch = providerBranchFromEvent || providerBranchFromLog || null;
  const branchRes = needsBranchResolution
    ? await resolveBranchForSession({
        provider: session.provider,
        session_id: session.session_id,
        repo_root: session.repo_root,
        started_at: session.started_at,
        ended_at: session.ended_at,
        dbPath,
        provider_branch: resolvedProviderBranch,
      })
    : null;

  {
    const db = new DatabaseSync(dbPath);
    try {
      db.exec('BEGIN');
      try {
        if (branchRes) {
          updateBranchResolution(db, {
            provider: session.provider,
            session_id: session.session_id,
            branch: branchRes.branch,
            tier: branchRes.tier,
            confidence: branchRes.confidence,
          });
          /*
          if (isNonEmptyString(branchRes.entire_link)) {
            upsertEntireLink(db, {
              provider: session.provider,
              session_id: session.session_id,
              entire_session_id: branchRes.entire_link,
              checkpoint_ids: branchRes.checkpoint_ids,
              match_confidence: branchRes.confidence,
            });
          }
          */
        }

        let latest = loadSession(db, { provider: session.provider, session_id: session.session_id });
        if (latest) {
          const inserted = insertSessionEvent(db, event, {
            repo_root: latest.repo_root,
            repo_common_dir: latest.repo_common_dir,
            parent_repo: latest.parent_repo,
            branch: latest.branch,
            branch_resolution_tier: latest.branch_resolution_tier,
            confidence: latest.confidence,
          });
          if (inserted) {
            upsertBucketFact(db, latest, event);
          }
          recomputeSessionLedger(db, latest);
          latest = loadSession(db, { provider: session.provider, session_id: session.session_id });
        }
        if (latest && !deferBranchFactRebuild) {
          await rebuildBranchUsageFactsForSession(db, {
            dbPath,
            provider: latest.provider,
            session_id: latest.session_id,
          });
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
      if (preserveExistingTerminalEnd) return;
      emitSessionEvent({ event, latest, keepOpenForCheckpoint, reopenOrphanedSession });
    } finally {
      db.close();
    }
  }
}

function assertBatchEvents(batch) {
  if (!Array.isArray(batch) || batch.length === 0) {
    throw new TypeError('processSessionEventBatch: events must be a non-empty array');
  }
  const provider = batch[0]?.provider;
  const sessionId = batch[0]?.session_id;
  if (!isNonEmptyString(provider) || !isNonEmptyString(sessionId)) {
    throw new TypeError('processSessionEventBatch: each event must include provider and session_id');
  }
  for (const event of batch) {
    if (!event || typeof event !== 'object') {
      throw new TypeError('processSessionEventBatch: each event must be an object');
    }
    if (event.provider !== provider || event.session_id !== sessionId) {
      throw new Error('processSessionEventBatch: events must all share provider/session');
    }
  }
}

async function processSessionEventBatch(dbPath, events, { cache = null, deferBranchFactRebuild = false } = {}) {
  if (!isNonEmptyString(dbPath)) throw new TypeError('processSessionEventBatch: dbPath must be a non-empty string');
  assertBatchEvents(events);
  const enrichedEvents = events.map((event) => enrichEventFromSessionMetadata(event, { cache }));
  assertBatchEvents(enrichedEvents);

  // Preserve compatibility with test harnesses that monkeypatch the single-event processor.
  if (module.exports.processSessionEvent !== processSessionEvent) {
    for (const event of enrichedEvents) {
      await module.exports.processSessionEvent(dbPath, event, { deferBranchFactRebuild });
    }
    return {
      events_processed: enrichedEvents.length,
      groups_processed: 1,
      branch_resolution_count: 0,
      existing_repo_reused_count: 0,
    };
  }

  const first = enrichedEvents[0];
  const last = enrichedEvents[enrichedEvents.length - 1];

  let existingBeforeUpsert = null;
  {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      existingBeforeUpsert = loadSession(db, { provider: first.provider, session_id: first.session_id });
    } finally {
      db.close();
    }
  }

  const keepOpenForCheckpoint = shouldKeepSessionOpenForCheckpoint(existingBeforeUpsert, last);
  const reopenOrphanedSession = shouldReopenOrphanedSession(existingBeforeUpsert, last);
  const preserveExistingTerminalEnd = shouldPreserveExistingTerminalEnd(existingBeforeUpsert, last);

  let repo = null;
  const existingRepoStillApplies =
    last.kind === 'update' &&
    isNonEmptyString(existingBeforeUpsert?.repo_root) &&
    isNonEmptyString(existingBeforeUpsert?.cwd) &&
    isNonEmptyString(last.cwd) &&
    existingBeforeUpsert.cwd === last.cwd;
  if (!existingRepoStillApplies) {
    const repoEvent = [...enrichedEvents].reverse().find((event) => isNonEmptyString(event.cwd));
    if (repoEvent && isNonEmptyString(repoEvent.cwd)) {
      try {
        repo = resolveRepo(repoEvent.cwd);
      } catch {
        repo = null;
      }
    }
  }

  const summary = {
    events_processed: enrichedEvents.length,
    groups_processed: 1,
    branch_resolution_count: 0,
    existing_repo_reused_count: existingRepoStillApplies ? 1 : 0,
  };

  const db = new DatabaseSync(dbPath);
  let latestForEmit = null;
  try {
    db.exec('BEGIN');
    try {
      upsertSessionFromEvents(dbPath, enrichedEvents, { db });
      if (keepOpenForCheckpoint || reopenOrphanedSession) {
        updateSessionEndedState(db, {
          provider: first.provider,
          session_id: first.session_id,
          ended_at: null,
          end_reason: null,
        });
      } else if (preserveExistingTerminalEnd) {
        updateSessionEndedState(db, {
          provider: first.provider,
          session_id: first.session_id,
          ended_at: existingBeforeUpsert.ended_at,
          end_reason: existingBeforeUpsert.end_reason,
        });
      }
      updateRepoMeta(db, { provider: first.provider, session_id: first.session_id, repo });

      let session = loadSession(db, { provider: first.provider, session_id: first.session_id });
      if (!session) {
        throw new Error('processSessionEventBatch: upsert did not create a session row');
      }

      const needsBranchResolution = shouldResolveBranch({
        existing: existingBeforeUpsert,
        session,
        repo,
        event: last,
        keepOpenForCheckpoint,
        reopenOrphanedSession,
        preserveExistingTerminalEnd,
      });
      const providerBranchFromEvents = [...enrichedEvents]
        .reverse()
        .map((event) => cleanProviderBranch(event.branch))
        .find((branch) => isNonEmptyString(branch)) || null;
      const providerBranchFromLog = providerBranchFromEvents
        ? null
        : canReadProviderBranch({ provider: session.provider, session_id: session.session_id })
          ? cleanProviderBranch(
              (providerBranch.readProviderBranchFromSessionFile({
                provider: session.provider,
                session_id: session.session_id,
                cache,
              }) || {}).branch,
            )
          : null;
      const resolvedProviderBranch = providerBranchFromEvents || providerBranchFromLog || null;

      const branchRes = needsBranchResolution
        ? await resolveBranchForSession({
            provider: session.provider,
            session_id: session.session_id,
            repo_root: session.repo_root,
            started_at: session.started_at,
            ended_at: session.ended_at,
            dbPath,
            provider_branch: resolvedProviderBranch,
          })
        : null;
      summary.branch_resolution_count = branchRes ? 1 : 0;

      if (branchRes) {
        updateBranchResolution(db, {
          provider: session.provider,
          session_id: session.session_id,
          branch: branchRes.branch,
          tier: branchRes.tier,
          confidence: branchRes.confidence,
        });
        /*
        if (isNonEmptyString(branchRes.entire_link)) {
          upsertEntireLink(db, {
            provider: session.provider,
            session_id: session.session_id,
            entire_session_id: branchRes.entire_link,
            checkpoint_ids: branchRes.checkpoint_ids,
            match_confidence: branchRes.confidence,
          });
        }
        */
        session = loadSession(db, { provider: session.provider, session_id: session.session_id });
      }

      for (const event of enrichedEvents) {
        const inserted = insertSessionEvent(db, event, {
          repo_root: session.repo_root,
          repo_common_dir: session.repo_common_dir,
          parent_repo: session.parent_repo,
          branch: session.branch,
          branch_resolution_tier: session.branch_resolution_tier,
          confidence: session.confidence,
        });
        if (inserted) upsertBucketFact(db, session, event);
      }

      recomputeSessionLedger(db, session);
      latestForEmit = loadSession(db, { provider: session.provider, session_id: session.session_id });
      if (latestForEmit && !deferBranchFactRebuild) {
        await rebuildBranchUsageFactsForSession(db, {
          dbPath,
          provider: latestForEmit.provider,
          session_id: latestForEmit.session_id,
        });
        persistBranchWindows(db, { provider: latestForEmit.provider, session_id: latestForEmit.session_id, windows: [] });
      }

      db.exec('COMMIT');
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {}
      throw err;
    }

    for (const event of enrichedEvents) {
      const shouldSkipEmit = preserveExistingTerminalEnd && event === last;
      if (shouldSkipEmit) continue;
      emitSessionEvent({ event, latest: latestForEmit, keepOpenForCheckpoint, reopenOrphanedSession });
    }
    return summary;
  } finally {
    db.close();
  }
}

async function recoverActiveSessionMetadata(dbPath) {
  if (!isNonEmptyString(dbPath)) throw new TypeError('recoverActiveSessionMetadata: dbPath must be a non-empty string');
  let candidates = [];
  {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      candidates = db
        .prepare(
          `
          SELECT provider, session_id, model
               , COALESCE(updated_at, started_at) AS activity_at
          FROM vibedeck_sessions
          WHERE ended_at IS NULL
            AND (cwd IS NULL OR cwd = '' OR repo_root IS NULL OR repo_root = '')
          `,
        )
        .all()
        .filter((row) => isRecoverableProvider(row.provider))
        .filter((row) => isNonEmptyString(row.session_id) && row.session_id.endsWith('.jsonl'))
        .filter((row) => fs.existsSync(row.session_id));
    } finally {
      db.close();
    }
  }

  let recovered = 0;
  for (const row of candidates) {
    const metadata = recoverCodexSessionMetadata(row);
    if (!isNonEmptyString(metadata.cwd)) continue;
    await processSessionEvent(dbPath, {
      kind: 'update',
      provider: row.provider,
      session_id: row.session_id,
      observed_at: isNonEmptyString(row.activity_at) ? row.activity_at : new Date().toISOString(),
      delta_tokens: null,
      cwd: metadata.cwd,
      model: isNonEmptyString(row.model) ? row.model : metadata.model ?? null,
    });
    restoreSessionUpdatedAt(dbPath, {
      provider: row.provider,
      session_id: row.session_id,
      updated_at: row.activity_at,
    });
    recovered += 1;
  }

  return { scanned: candidates.length, recovered };
}

module.exports = { processSessionEvent, processSessionEventBatch, recoverActiveSessionMetadata };
