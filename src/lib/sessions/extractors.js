'use strict';

const { makeStart, makeUpdate, makeEnd } = require('./event');

function coalesceString(v) {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed ? trimmed : null;
}

function normalizeUpdates(updates) {
  if (!Array.isArray(updates)) return [];
  return updates
    .map((u) => {
      if (!u || typeof u !== 'object') return null;
      const observed_at = coalesceString(u.observed_at);
      const delta_tokens = u.delta_tokens;
      if (!observed_at) return null;
      if (delta_tokens != null && (!Number.isInteger(delta_tokens) || delta_tokens < 0)) return null;
      return { observed_at, delta_tokens: delta_tokens == null ? null : delta_tokens };
    })
    .filter(Boolean);
}

function extractSessionEvents({
  provider,
  session_id,
  started_at,
  ended_at,
  end_reason,
  cwd,
  model,
  updates,
  total_tokens,
}) {
  const sid = coalesceString(session_id);
  if (!sid) return [];

  const startTs = coalesceString(started_at);
  const endTs = coalesceString(ended_at);

  const out = [];
  if (startTs) out.push(makeStart({ provider, session_id: sid, started_at: startTs, cwd: cwd ?? null, model: model ?? null }));

  for (const u of normalizeUpdates(updates)) {
    out.push(
      makeUpdate({
        provider,
        session_id: sid,
        observed_at: u.observed_at,
        delta_tokens: u.delta_tokens,
        cwd: cwd ?? null,
        model: model ?? null,
      }),
    );
  }

  if (endTs) {
    out.push(
      makeEnd({
        provider,
        session_id: sid,
        ended_at: endTs,
        total_tokens: total_tokens == null ? null : total_tokens,
        end_reason: end_reason == null ? null : end_reason,
        cwd: cwd ?? null,
        model: model ?? null,
      }),
    );
  }

  return out;
}

function extractClaudeCodeSessionEvents(batch) {
  return extractSessionEvents({
    provider: 'claude',
    session_id: batch.session_id,
    started_at: batch.started_at,
    ended_at: batch.ended_at,
    end_reason: batch.end_reason,
    cwd: batch.cwd ?? null,
    model: batch.model ?? null,
    updates: batch.updates,
    total_tokens: batch.total_tokens,
  });
}

function extractCodexSessionEvents(batch) {
  return extractSessionEvents({
    provider: 'codex',
    session_id: batch.session_id,
    started_at: batch.started_at,
    ended_at: batch.ended_at,
    end_reason: batch.end_reason,
    cwd: batch.cwd ?? null,
    model: batch.model ?? null,
    updates: batch.updates,
    total_tokens: batch.total_tokens,
  });
}

function extractGeminiSessionEvents(batch) {
  return extractSessionEvents({
    provider: 'gemini',
    session_id: batch.session_id,
    started_at: batch.started_at,
    ended_at: batch.ended_at,
    end_reason: batch.end_reason,
    cwd: batch.cwd ?? null,
    model: batch.model ?? null,
    updates: batch.updates,
    total_tokens: batch.total_tokens,
  });
}

function extractCursorSessionEvents(batch) {
  return extractSessionEvents({
    provider: 'cursor',
    session_id: batch.session_id,
    started_at: batch.started_at,
    ended_at: batch.ended_at,
    end_reason: batch.end_reason,
    cwd: null,
    model: batch.model ?? null,
    updates: batch.updates,
    total_tokens: batch.total_tokens,
  });
}

function extractOpenCodeSessionEvents(batch) {
  return extractSessionEvents({
    provider: 'opencode',
    session_id: batch.session_id,
    started_at: batch.started_at,
    ended_at: batch.ended_at,
    end_reason: batch.end_reason,
    cwd: batch.cwd ?? null,
    model: batch.model ?? null,
    updates: batch.updates,
    total_tokens: batch.total_tokens,
  });
}

function extractOpenClawSessionEvents(batch) {
  return extractSessionEvents({
    provider: 'openclaw',
    session_id: batch.session_id,
    started_at: batch.started_at,
    ended_at: batch.ended_at,
    end_reason: batch.end_reason,
    cwd: batch.cwd ?? null,
    model: batch.model ?? null,
    updates: batch.updates,
    total_tokens: batch.total_tokens,
  });
}

function extractEveryCodeSessionEvents(batch) {
  return extractSessionEvents({
    provider: 'every-code',
    session_id: batch.session_id,
    started_at: batch.started_at,
    ended_at: batch.ended_at,
    end_reason: batch.end_reason,
    cwd: batch.cwd ?? null,
    model: batch.model ?? null,
    updates: batch.updates,
    total_tokens: batch.total_tokens,
  });
}

function extractKiroSessionEvents(batch) {
  return extractSessionEvents({
    provider: 'kiro',
    session_id: batch.session_id,
    started_at: batch.started_at,
    ended_at: batch.ended_at,
    end_reason: batch.end_reason,
    cwd: batch.cwd ?? null,
    model: batch.model ?? null,
    updates: batch.updates,
    total_tokens: batch.total_tokens,
  });
}

function extractHermesSessionEvents(batch) {
  return extractSessionEvents({
    provider: 'hermes',
    session_id: batch.session_id,
    started_at: batch.started_at,
    ended_at: batch.ended_at,
    end_reason: batch.end_reason,
    cwd: batch.cwd ?? null,
    model: batch.model ?? null,
    updates: batch.updates,
    total_tokens: batch.total_tokens,
  });
}

function extractCopilotSessionEvents(batch) {
  return extractSessionEvents({
    provider: 'copilot',
    session_id: batch.session_id,
    started_at: batch.started_at,
    ended_at: batch.ended_at,
    end_reason: batch.end_reason,
    cwd: null,
    model: batch.model ?? null,
    updates: batch.updates,
    total_tokens: batch.total_tokens,
  });
}

function extractKimiSessionEvents(batch) {
  return extractSessionEvents({
    provider: 'kimi',
    session_id: batch.session_id,
    started_at: batch.started_at,
    ended_at: batch.ended_at,
    end_reason: batch.end_reason,
    cwd: null,
    model: batch.model ?? null,
    updates: batch.updates,
    total_tokens: batch.total_tokens,
  });
}

function extractOmpSessionEvents(batch) {
  return extractSessionEvents({
    provider: 'omp',
    session_id: batch.session_id,
    started_at: batch.started_at,
    ended_at: batch.ended_at,
    end_reason: batch.end_reason,
    cwd: null,
    model: batch.model ?? null,
    updates: batch.updates,
    total_tokens: batch.total_tokens,
  });
}

function extractCodebuddySessionEvents(batch) {
  return extractSessionEvents({
    provider: 'codebuddy',
    session_id: batch.session_id,
    started_at: batch.started_at,
    ended_at: batch.ended_at,
    end_reason: batch.end_reason,
    cwd: batch.cwd ?? null,
    model: batch.model ?? null,
    updates: batch.updates,
    total_tokens: batch.total_tokens,
  });
}

module.exports = {
  extractClaudeCodeSessionEvents,
  extractCodexSessionEvents,
  extractGeminiSessionEvents,
  extractCursorSessionEvents,
  extractOpenCodeSessionEvents,
  extractOpenClawSessionEvents,
  extractEveryCodeSessionEvents,
  extractKiroSessionEvents,
  extractHermesSessionEvents,
  extractCopilotSessionEvents,
  extractKimiSessionEvents,
  extractOmpSessionEvents,
  extractCodebuddySessionEvents,
};
