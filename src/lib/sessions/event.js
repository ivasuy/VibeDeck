'use strict';

const KINDS = new Set(['start', 'update', 'end']);

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

function isNullableString(v) {
  return v === null || v === undefined || typeof v === 'string';
}

function assertNullableNonNegativeInteger(name, v) {
  if (v != null && (!Number.isInteger(v) || v < 0)) {
    throw new TypeError(`SessionEvent.${name} must be a non-negative integer or null`);
  }
}

function assertIsoString(name, v) {
  if (!isNonEmptyString(v)) {
    throw new TypeError(`${name} must be a non-empty ISO string`);
  }
}

function validateEvent(e) {
  if (!e || typeof e !== 'object') throw new TypeError('SessionEvent must be an object');

  if (!KINDS.has(e.kind)) throw new TypeError(`SessionEvent.kind must be one of: start, update, end`);
  if (!isNonEmptyString(e.provider)) throw new TypeError('SessionEvent.provider must be a non-empty string');
  if (!isNonEmptyString(e.session_id)) throw new TypeError('SessionEvent.session_id must be a non-empty string');

  if (e.kind === 'start') {
    assertIsoString('SessionEvent.started_at', e.started_at);
  }
  if (e.kind === 'update') {
    assertIsoString('SessionEvent.observed_at', e.observed_at);
    assertNullableNonNegativeInteger('delta_tokens', e.delta_tokens);
    assertNullableNonNegativeInteger('input_tokens', e.input_tokens);
    assertNullableNonNegativeInteger('cached_input_tokens', e.cached_input_tokens);
    assertNullableNonNegativeInteger('cache_creation_input_tokens', e.cache_creation_input_tokens);
    assertNullableNonNegativeInteger('output_tokens', e.output_tokens);
    assertNullableNonNegativeInteger('reasoning_output_tokens', e.reasoning_output_tokens);
  }
  if (e.kind === 'end') {
    assertIsoString('SessionEvent.ended_at', e.ended_at);
    if (e.total_tokens != null && (!Number.isInteger(e.total_tokens) || e.total_tokens < 0)) {
      throw new TypeError('SessionEvent.total_tokens must be a non-negative integer or null');
    }
    if (!isNullableString(e.end_reason)) {
      throw new TypeError('SessionEvent.end_reason must be a string or null');
    }
  }

  if (!isNullableString(e.cwd)) throw new TypeError('SessionEvent.cwd must be a string or null');
  if (!isNullableString(e.model)) throw new TypeError('SessionEvent.model must be a string or null');

  return e;
}

function makeStart({ provider, session_id, started_at, cwd = null, model = null }) {
  const e = { kind: 'start', provider, session_id, started_at, cwd, model };
  return validateEvent(e);
}

function makeUpdate({
  provider,
  session_id,
  observed_at,
  delta_tokens = null,
  cwd = null,
  model = null,
  input_tokens = null,
  cached_input_tokens = null,
  cache_creation_input_tokens = null,
  output_tokens = null,
  reasoning_output_tokens = null,
}) {
  const e = {
    kind: 'update',
    provider,
    session_id,
    observed_at,
    delta_tokens,
    cwd,
    model,
    input_tokens,
    cached_input_tokens,
    cache_creation_input_tokens,
    output_tokens,
    reasoning_output_tokens,
  };
  return validateEvent(e);
}

function makeEnd({ provider, session_id, ended_at, total_tokens = null, end_reason = null, cwd = null, model = null }) {
  const e = { kind: 'end', provider, session_id, ended_at, total_tokens, end_reason, cwd, model };
  return validateEvent(e);
}

module.exports = {
  makeStart,
  makeUpdate,
  makeEnd,
  validateEvent,
};
