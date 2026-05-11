'use strict';

function eventKey(event) {
  if (event.kind === 'start') return `start|${event.started_at}`;
  if (event.kind === 'update') {
    return `update|${event.observed_at}|${event.delta_tokens == null ? '' : event.delta_tokens}|${
      event.conversation_count == null ? '' : event.conversation_count
    }`;
  }
  return `end|${event.ended_at}|${event.total_tokens == null ? '' : event.total_tokens}|${
    event.end_reason == null ? '' : event.end_reason
  }`;
}

function insertSessionEvent(db, event, attribution = {}) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `
      INSERT INTO vibedeck_session_events (
        provider, session_id, event_key, kind, observed_at,
        started_at, ended_at, end_reason,
        cwd, repo_root, repo_common_dir, parent_repo,
        branch, branch_resolution_tier, confidence,
        model, delta_tokens, input_tokens, cached_input_tokens,
        cache_creation_input_tokens, output_tokens, reasoning_output_tokens,
        conversation_count, total_tokens, created_at
      ) VALUES (
        @provider, @session_id, @event_key, @kind, @observed_at,
        @started_at, @ended_at, @end_reason,
        @cwd, @repo_root, @repo_common_dir, @parent_repo,
        @branch, @branch_resolution_tier, @confidence,
        @model, @delta_tokens, @input_tokens, @cached_input_tokens,
        @cache_creation_input_tokens, @output_tokens, @reasoning_output_tokens,
        @conversation_count, @total_tokens, @created_at
      )
      ON CONFLICT(provider, session_id, event_key) DO NOTHING
      `,
    )
    .run({
      provider: event.provider,
      session_id: event.session_id,
      event_key: eventKey(event),
      kind: event.kind,
      observed_at: event.observed_at || event.started_at || event.ended_at,
      started_at: event.started_at || null,
      ended_at: event.ended_at || null,
      end_reason: event.end_reason || null,
      cwd: event.cwd || null,
      repo_root: attribution.repo_root || null,
      repo_common_dir: attribution.repo_common_dir || null,
      parent_repo: attribution.parent_repo || null,
      branch: attribution.branch || null,
      branch_resolution_tier: attribution.branch_resolution_tier || null,
      confidence: attribution.confidence || null,
      model: event.model || null,
      delta_tokens: event.delta_tokens ?? null,
      input_tokens: event.input_tokens ?? null,
      cached_input_tokens: event.cached_input_tokens ?? null,
      cache_creation_input_tokens: event.cache_creation_input_tokens ?? null,
      output_tokens: event.output_tokens ?? null,
      reasoning_output_tokens: event.reasoning_output_tokens ?? null,
      conversation_count: event.conversation_count ?? null,
      total_tokens: event.total_tokens ?? null,
      created_at: now,
    });
  return Number(result.changes || 0) > 0;
}

module.exports = { eventKey, insertSessionEvent };
