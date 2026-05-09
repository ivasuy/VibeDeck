'use strict';

const { DatabaseSync } = require('node:sqlite');
const { validateEvent } = require('./event');

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

function minIso(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  return a <= b ? a : b;
}

function maxIso(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  return a >= b ? a : b;
}

function firstNonNull(existing, events) {
  if (existing != null) return existing;
  for (const e of events) {
    if (e != null) return e;
  }
  return null;
}

function lastNonNull(existing, events) {
  let v = existing != null ? existing : null;
  for (const e of events) {
    if (e != null) v = e;
  }
  return v;
}

function sumInts(base, values) {
  let sum = base != null ? base : 0;
  for (const v of values) {
    if (v == null) continue;
    sum += v;
  }
  return sum;
}

function safeJsonParse(str) {
  if (typeof str !== 'string' || str.trim() === '') return null;
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function stableStringify(obj) {
  if (obj == null) return null;
  const keys = Object.keys(obj).sort();
  const out = {};
  for (const k of keys) out[k] = obj[k];
  return JSON.stringify(out);
}

function eventKey(e) {
  if (e.kind === 'start') return `start|${e.started_at}`;
  if (e.kind === 'update') return `update|${e.observed_at}|${e.delta_tokens == null ? '' : e.delta_tokens}`;
  return `end|${e.ended_at}|${e.total_tokens == null ? '' : e.total_tokens}|${e.end_reason == null ? '' : e.end_reason}`;
}

function normalizeCwd(v) {
  if (v == null) return null;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

function normalizeModel(v) {
  if (v == null) return null;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

function rowsEqual(existing, desired) {
  if (!existing) return false;
  const keys = Object.keys(desired);
  for (const k of keys) {
    if (existing[k] !== desired[k]) return false;
  }
  return true;
}

function upsertSessionFromEvents(dbPath, events) {
  if (!isNonEmptyString(dbPath)) throw new TypeError('upsertSessionFromEvents: dbPath must be a non-empty string');
  if (!Array.isArray(events) || events.length === 0) {
    throw new TypeError('upsertSessionFromEvents: events must be a non-empty array');
  }

  const validated = events.map((e) => validateEvent(e));
  const provider = validated[0].provider;
  const sessionId = validated[0].session_id;
  for (const e of validated) {
    if (e.provider !== provider || e.session_id !== sessionId) {
      throw new Error('upsertSessionFromEvents: events must all share the same (provider, session_id)');
    }
  }

  const db = new DatabaseSync(dbPath);
  try {
    const existing =
      db.prepare('SELECT * FROM vibedeck_sessions WHERE provider = ? AND session_id = ?').get(provider, sessionId) ||
      null;

    const existingSources = safeJsonParse(existing ? existing.override_user : null);
    const alreadySeen =
      existingSources && Array.isArray(existingSources.events) ? new Set(existingSources.events) : new Set();

    const startTimes = validated.filter((e) => e.kind === 'start').map((e) => e.started_at);
    let startedAtFromEvents = null;
    for (const t of startTimes) startedAtFromEvents = minIso(startedAtFromEvents, t);

    const started_at = existing ? minIso(existing.started_at, startedAtFromEvents) : startedAtFromEvents;
    if (!started_at) {
      throw new Error('upsertSessionFromEvents: no started_at available (need a start event or existing row)');
    }

    const endTimes = validated.filter((e) => e.kind === 'end').map((e) => e.ended_at);
    let endedAtFromEvents = null;
    for (const t of endTimes) endedAtFromEvents = maxIso(endedAtFromEvents, t);

    let ended_at = null;
    if (existing && existing.ended_at != null) ended_at = existing.ended_at;
    if (endedAtFromEvents != null) ended_at = maxIso(ended_at, endedAtFromEvents);

    const endReasons = validated.filter((e) => e.kind === 'end').map((e) => (e.end_reason == null ? null : e.end_reason));
    const end_reason = lastNonNull(existing ? existing.end_reason : null, endReasons);

    const cwdCandidates = validated.map((e) => normalizeCwd(e.cwd));
    const cwd = firstNonNull(existing ? existing.cwd : null, cwdCandidates);

    const modelCandidates = validated.map((e) => normalizeModel(e.model));
    const model = lastNonNull(existing ? existing.model : null, modelCandidates);

    // total_tokens rules:
    // - If an end.total_tokens exists, it's authoritative (prefer the last such value)
    // - Else, sum update.delta_tokens (and keep existing total if no new deltas)
    const endTotals = validated.filter((e) => e.kind === 'end').map((e) => e.total_tokens);
    const authoritativeTotal = lastNonNull(null, endTotals);

    const newUpdates = validated
      .filter((e) => e.kind === 'update')
      .filter((e) => !alreadySeen.has(eventKey(e)));
    const updateDeltas = newUpdates.map((e) => e.delta_tokens);

    let total_tokens = null;
    if (authoritativeTotal != null) {
      total_tokens = authoritativeTotal;
    } else if (updateDeltas.some((v) => v != null)) {
      const base = existing && existing.total_tokens != null ? existing.total_tokens : 0;
      total_tokens = sumInts(base, updateDeltas);
    } else {
      total_tokens = existing ? existing.total_tokens : null;
    }

    const mergedEventKeys = existingSources && Array.isArray(existingSources.events) ? [...existingSources.events] : [];
    for (const e of validated) {
      const k = eventKey(e);
      if (!alreadySeen.has(k)) {
        alreadySeen.add(k);
        mergedEventKeys.push(k);
      }
    }

    const override_user = stableStringify({ events: mergedEventKeys });

    const desired = {
      provider,
      session_id: sessionId,
      started_at,
      ended_at,
      end_reason,
      cwd,
      model,
      total_tokens,
      branch_resolution_tier: existing ? existing.branch_resolution_tier : 'D',
      confidence: existing ? existing.confidence : 'unattributed',
      override_user,
      // repo_root/repo_common_dir/parent_repo/branch/total_cost_usd are left untouched here.
    };

    // Preserve created_at; only bump updated_at when something actually changes.
    if (rowsEqual(existing, desired)) {
      return;
    }

    const now = new Date().toISOString();

    db.prepare(
      `
      INSERT INTO vibedeck_sessions (
        provider, session_id,
        started_at, ended_at, end_reason,
        cwd, repo_root, repo_common_dir, parent_repo,
        branch, branch_resolution_tier, confidence, override_user,
        model, total_tokens, total_cost_usd,
        created_at, updated_at
      ) VALUES (
        @provider, @session_id,
        @started_at, @ended_at, @end_reason,
        @cwd, @repo_root, @repo_common_dir, @parent_repo,
        @branch, @branch_resolution_tier, @confidence, @override_user,
        @model, @total_tokens, @total_cost_usd,
        @created_at, @updated_at
      )
      ON CONFLICT(provider, session_id) DO UPDATE SET
        started_at = excluded.started_at,
        ended_at = excluded.ended_at,
        end_reason = excluded.end_reason,
        cwd = excluded.cwd,
        model = excluded.model,
        total_tokens = excluded.total_tokens,
        branch_resolution_tier = excluded.branch_resolution_tier,
        confidence = excluded.confidence,
        updated_at = excluded.updated_at
      `,
    ).run({
      provider,
      session_id: sessionId,
      started_at,
      ended_at,
      end_reason,
      cwd,
      repo_root: existing ? existing.repo_root : null,
      repo_common_dir: existing ? existing.repo_common_dir : null,
      parent_repo: existing ? existing.parent_repo : null,
      branch: existing ? existing.branch : null,
      branch_resolution_tier: desired.branch_resolution_tier,
      confidence: desired.confidence,
      override_user,
      model,
      total_tokens,
      total_cost_usd: existing ? existing.total_cost_usd : null,
      created_at: existing ? existing.created_at : now,
      updated_at: now,
    });
  } finally {
    db.close();
  }
}

module.exports = { upsertSessionFromEvents };
