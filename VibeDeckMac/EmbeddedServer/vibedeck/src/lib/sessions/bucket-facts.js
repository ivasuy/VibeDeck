'use strict';

const {
  resolveUsageCost,
  createCostAccumulator,
  addCostToAccumulator,
  finalizeCostAccumulator,
} = require('../cost-estimation');

function toUtcHalfHourStart(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  d.setUTCMinutes(d.getUTCMinutes() < 30 ? 0 : 30, 0, 0);
  return d.toISOString();
}

function maxIso(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  return a >= b ? a : b;
}

function sumTokenFields(row) {
  return [
    'input_tokens',
    'cached_input_tokens',
    'cache_creation_input_tokens',
    'output_tokens',
    'reasoning_output_tokens',
  ].reduce((sum, key) => sum + (Number(row?.[key] || 0) || 0), 0);
}

function bucketCostPayload(row) {
  return resolveUsageCost({
    source: row.bucket_provider,
    model: row.bucket_model,
    total_tokens: row.total_tokens,
    input_tokens: row.input_tokens,
    cached_input_tokens: row.cached_input_tokens,
    cache_creation_input_tokens: row.cache_creation_input_tokens,
    output_tokens: row.output_tokens,
    reasoning_output_tokens: row.reasoning_output_tokens,
    stored_cost_usd: null,
  });
}

function upsertBucketFact(db, sessionRow, event) {
  if (!sessionRow || !event || event.kind !== 'update') return false;
  const hourStart = toUtcHalfHourStart(event.observed_at);
  if (!hourStart) return false;

  const inputTokens = Number(event.input_tokens || 0) || 0;
  const cachedInputTokens = Number(event.cached_input_tokens || 0) || 0;
  const cacheCreationInputTokens = Number(event.cache_creation_input_tokens || 0) || 0;
  const outputTokens = Number(event.output_tokens || 0) || 0;
  const reasoningOutputTokens = Number(event.reasoning_output_tokens || 0) || 0;
  const conversationCount = Number(event.conversation_count || 0) || 0;
  const bucketTotalTokens =
    event.delta_tokens == null
      ? inputTokens + cachedInputTokens + cacheCreationInputTokens + outputTokens + reasoningOutputTokens
      : Number(event.delta_tokens || 0) || 0;

  if (
    bucketTotalTokens === 0 &&
    inputTokens === 0 &&
    cachedInputTokens === 0 &&
    cacheCreationInputTokens === 0 &&
    outputTokens === 0 &&
    reasoningOutputTokens === 0 &&
    conversationCount === 0
  ) {
    return false;
  }

  const bucketModel = event.model || sessionRow.model || 'unknown';
  db.prepare(
    `
    INSERT INTO vibedeck_session_buckets (
      provider, session_id, bucket_provider, bucket_model, bucket_hour_start,
      proportion, input_tokens, cached_input_tokens, cache_creation_input_tokens,
      output_tokens, reasoning_output_tokens, conversation_count, total_tokens,
      last_observed_at
    ) VALUES (
      @provider, @session_id, @bucket_provider, @bucket_model, @bucket_hour_start,
      1.0, @input_tokens, @cached_input_tokens, @cache_creation_input_tokens,
      @output_tokens, @reasoning_output_tokens, @conversation_count, @total_tokens,
      @last_observed_at
    )
    ON CONFLICT(provider, session_id, bucket_provider, bucket_model, bucket_hour_start) DO UPDATE SET
      input_tokens = vibedeck_session_buckets.input_tokens + excluded.input_tokens,
      cached_input_tokens = vibedeck_session_buckets.cached_input_tokens + excluded.cached_input_tokens,
      cache_creation_input_tokens =
        vibedeck_session_buckets.cache_creation_input_tokens + excluded.cache_creation_input_tokens,
      output_tokens = vibedeck_session_buckets.output_tokens + excluded.output_tokens,
      reasoning_output_tokens = vibedeck_session_buckets.reasoning_output_tokens + excluded.reasoning_output_tokens,
      conversation_count = vibedeck_session_buckets.conversation_count + excluded.conversation_count,
      total_tokens = vibedeck_session_buckets.total_tokens + excluded.total_tokens,
      last_observed_at = CASE
        WHEN vibedeck_session_buckets.last_observed_at IS NULL THEN excluded.last_observed_at
        WHEN excluded.last_observed_at > vibedeck_session_buckets.last_observed_at THEN excluded.last_observed_at
        ELSE vibedeck_session_buckets.last_observed_at
      END
    `,
  ).run({
    provider: sessionRow.provider,
    session_id: sessionRow.session_id,
    bucket_provider: sessionRow.provider,
    bucket_model: bucketModel,
    bucket_hour_start: hourStart,
    input_tokens: inputTokens,
    cached_input_tokens: cachedInputTokens,
    cache_creation_input_tokens: cacheCreationInputTokens,
    output_tokens: outputTokens,
    reasoning_output_tokens: reasoningOutputTokens,
    conversation_count: conversationCount,
    total_tokens: bucketTotalTokens,
    last_observed_at: event.observed_at,
  });

  const bucket = db
    .prepare(
      `
      SELECT *
      FROM vibedeck_session_buckets
      WHERE provider = ? AND session_id = ? AND bucket_provider = ? AND bucket_model = ? AND bucket_hour_start = ?
      `,
    )
    .get(sessionRow.provider, sessionRow.session_id, sessionRow.provider, bucketModel, hourStart);
  if (!bucket) return false;

  const cost = bucketCostPayload(bucket);
  db.prepare(
    `
    UPDATE vibedeck_session_buckets
    SET total_cost_usd = ?, cost_estimated = ?, cost_quality = ?, last_observed_at = ?
    WHERE provider = ? AND session_id = ? AND bucket_provider = ? AND bucket_model = ? AND bucket_hour_start = ?
    `,
  ).run(
    cost.total_cost_usd,
    cost.cost_estimated ? 1 : 0,
    cost.cost_quality,
    maxIso(bucket.last_observed_at, event.observed_at),
    sessionRow.provider,
    sessionRow.session_id,
    sessionRow.provider,
    bucketModel,
    hourStart,
  );

  return true;
}

function recomputeSessionLedger(db, sessionRow) {
  if (!sessionRow) return null;
  const buckets = db
    .prepare(
      `
      SELECT total_tokens, total_cost_usd, cost_estimated, cost_quality, last_observed_at
      FROM vibedeck_session_buckets
      WHERE provider = ? AND session_id = ?
      `,
    )
    .all(sessionRow.provider, sessionRow.session_id);
  if (!Array.isArray(buckets) || buckets.length === 0) return null;

  const totalTokens = buckets.reduce((sum, row) => sum + (Number(row?.total_tokens || 0) || 0), 0);
  const lastObservedAt = buckets.reduce(
    (latest, row) => maxIso(latest, typeof row?.last_observed_at === 'string' ? row.last_observed_at : null),
    sessionRow.last_observed_at || null,
  );

  const costAcc = createCostAccumulator();
  for (const row of buckets) {
    addCostToAccumulator(costAcc, {
      total_cost_usd: row.total_cost_usd == null ? null : Number(row.total_cost_usd),
      cost_estimated: Boolean(row.cost_estimated),
      cost_quality: row.cost_quality || null,
    });
  }
  const cost = finalizeCostAccumulator(costAcc);
  const fallbackCost = totalTokens === 0
    ? { total_cost_usd: 0, cost_estimated: false, cost_quality: 'zero_tokens' }
    : cost;

  db.prepare(
    `
    UPDATE vibedeck_sessions
    SET
      total_tokens = ?,
      total_cost_usd = ?,
      last_observed_at = ?,
      cost_estimated = ?,
      cost_quality = ?
    WHERE provider = ? AND session_id = ?
    `,
  ).run(
    totalTokens,
    fallbackCost.total_cost_usd,
    lastObservedAt || sessionRow.last_observed_at || sessionRow.updated_at || sessionRow.started_at,
    fallbackCost.cost_estimated ? 1 : 0,
    fallbackCost.cost_quality,
    sessionRow.provider,
    sessionRow.session_id,
  );

  return {
    total_tokens: totalTokens,
    total_cost_usd: fallbackCost.total_cost_usd,
    last_observed_at: lastObservedAt,
    cost_estimated: fallbackCost.cost_estimated,
    cost_quality: fallbackCost.cost_quality,
  };
}

module.exports = { toUtcHalfHourStart, upsertBucketFact, recomputeSessionLedger };
