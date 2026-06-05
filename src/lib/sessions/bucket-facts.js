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
  const nonCacheTokens = [
    'input_tokens',
    'cached_input_tokens',
    'output_tokens',
    'reasoning_output_tokens',
  ].reduce((sum, key) => sum + (Number(row?.[key] || 0) || 0), 0);
  return nonCacheTokens + cacheCreationTotal(row);
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

function parseCounterJson(str) {
  const parsed = safeJsonParse(str);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

  const out = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof key !== 'string' || key === '') continue;
    if (!Number.isInteger(value) || value < 0) continue;
    out[key] = value;
  }
  return out;
}

function stableCounterJson(counter) {
  if (!counter || Object.keys(counter).length === 0) return null;
  return stableStringify(counter);
}

function sumCounterJson(base, values) {
  const sums = parseCounterJson(base);
  for (const value of values) {
    const parsed = parseCounterJson(value);
    for (const [key, count] of Object.entries(parsed)) {
      sums[key] = (sums[key] || 0) + count;
    }
  }
  return stableCounterJson(sums);
}

function hasCounterJson(str) {
  return Object.keys(parseCounterJson(str)).length > 0;
}

function cacheCreationTotal(row) {
  const legacy = Number(row?.cache_creation_input_tokens || 0) || 0;
  const split5m = Number(row?.cache_creation_5m_input_tokens || 0) || 0;
  const split1h = Number(row?.cache_creation_1h_input_tokens || 0) || 0;
  return split5m > 0 || split1h > 0 ? split5m + split1h : legacy;
}

function costTotalTokens(row) {
  const totalTokens = Number(row?.total_tokens || 0) || 0;
  if (totalTokens !== 0) return totalTokens;
  const webSearchRequests = typeof row?.web_search_requests === 'number' && Number.isFinite(row.web_search_requests)
    ? row.web_search_requests
    : 0;
  return webSearchRequests > 0 ? webSearchRequests : totalTokens;
}

function bucketCostPayload(row) {
  return resolveUsageCost({
    source: row.bucket_provider,
    model: row.bucket_model,
    total_tokens: costTotalTokens(row),
    input_tokens: row.input_tokens,
    cached_input_tokens: row.cached_input_tokens,
    cache_creation_input_tokens: row.cache_creation_input_tokens,
    cache_creation_5m_input_tokens: row.cache_creation_5m_input_tokens,
    cache_creation_1h_input_tokens: row.cache_creation_1h_input_tokens,
    output_tokens: row.output_tokens,
    reasoning_output_tokens: row.reasoning_output_tokens,
    web_search_requests: row.web_search_requests,
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
  const cacheCreation5mInputTokens = Number(event.cache_creation_5m_input_tokens || 0) || 0;
  const cacheCreation1hInputTokens = Number(event.cache_creation_1h_input_tokens || 0) || 0;
  const outputTokens = Number(event.output_tokens || 0) || 0;
  const reasoningOutputTokens = Number(event.reasoning_output_tokens || 0) || 0;
  const conversationCount = Number(event.conversation_count || 0) || 0;
  const webSearchRequests = Number(event.web_search_requests || 0) || 0;
  const toolCallCount = Number(event.tool_call_count || 0) || 0;
  const toolsJson = stableCounterJson(parseCounterJson(event.tools_json));
  const activityJson = stableCounterJson(parseCounterJson(event.activity_json));
  const taskCategory = stableCounterJson(parseCounterJson(event.task_category));
  const skillsJson = stableCounterJson(parseCounterJson(event.skills_json));
  const fastMode = Number(event.fast_mode || 0) || 0;
  const eventCacheCreationTotal = cacheCreation5mInputTokens > 0 || cacheCreation1hInputTokens > 0
    ? cacheCreation5mInputTokens + cacheCreation1hInputTokens
    : cacheCreationInputTokens;
  const bucketTotalTokens =
    event.delta_tokens == null
      ? inputTokens + cachedInputTokens + eventCacheCreationTotal + outputTokens + reasoningOutputTokens
      : Number(event.delta_tokens || 0) || 0;
  const billableTotalTokens = event.billable_total_tokens == null
    ? bucketTotalTokens
    : Number(event.billable_total_tokens || 0) || 0;

  if (
    bucketTotalTokens === 0 &&
    inputTokens === 0 &&
    cachedInputTokens === 0 &&
    cacheCreationInputTokens === 0 &&
    cacheCreation5mInputTokens === 0 &&
    cacheCreation1hInputTokens === 0 &&
    outputTokens === 0 &&
    reasoningOutputTokens === 0 &&
    conversationCount === 0 &&
    webSearchRequests === 0 &&
    toolCallCount === 0 &&
    fastMode === 0 &&
    !hasCounterJson(toolsJson) &&
    !hasCounterJson(activityJson) &&
    !hasCounterJson(taskCategory) &&
    !hasCounterJson(skillsJson)
  ) {
    return false;
  }

  const bucketModel = event.model || sessionRow.model || 'unknown';
  const existingBucket = db
    .prepare(
      `
      SELECT tools_json, activity_json, task_category, skills_json
      FROM vibedeck_session_buckets
      WHERE provider = ? AND session_id = ? AND bucket_provider = ? AND bucket_model = ? AND bucket_hour_start = ?
      `,
    )
    .get(sessionRow.provider, sessionRow.session_id, sessionRow.provider, bucketModel, hourStart);
  const mergedToolsJson = sumCounterJson(existingBucket?.tools_json, [toolsJson]);
  const mergedActivityJson = sumCounterJson(existingBucket?.activity_json, [activityJson]);
  const mergedTaskCategory = sumCounterJson(existingBucket?.task_category, [taskCategory]);
  const mergedSkillsJson = sumCounterJson(existingBucket?.skills_json, [skillsJson]);

  db.prepare(
    `
    INSERT INTO vibedeck_session_buckets (
      provider, session_id, bucket_provider, bucket_model, bucket_hour_start,
      proportion, input_tokens, cached_input_tokens, cache_creation_input_tokens,
      cache_creation_5m_input_tokens, cache_creation_1h_input_tokens,
      output_tokens, reasoning_output_tokens,
      web_search_requests, tool_call_count, tools_json, activity_json,
      task_category, skills_json, fast_mode,
      conversation_count, total_tokens, billable_total_tokens,
      last_observed_at
    ) VALUES (
      @provider, @session_id, @bucket_provider, @bucket_model, @bucket_hour_start,
      1.0, @input_tokens, @cached_input_tokens, @cache_creation_input_tokens,
      @cache_creation_5m_input_tokens, @cache_creation_1h_input_tokens,
      @output_tokens, @reasoning_output_tokens,
      @web_search_requests, @tool_call_count, @tools_json, @activity_json,
      @task_category, @skills_json, @fast_mode,
      @conversation_count, @total_tokens, @billable_total_tokens,
      @last_observed_at
    )
    ON CONFLICT(provider, session_id, bucket_provider, bucket_model, bucket_hour_start) DO UPDATE SET
      input_tokens = vibedeck_session_buckets.input_tokens + excluded.input_tokens,
      cached_input_tokens = vibedeck_session_buckets.cached_input_tokens + excluded.cached_input_tokens,
      cache_creation_input_tokens =
        vibedeck_session_buckets.cache_creation_input_tokens + excluded.cache_creation_input_tokens,
      cache_creation_5m_input_tokens =
        vibedeck_session_buckets.cache_creation_5m_input_tokens + excluded.cache_creation_5m_input_tokens,
      cache_creation_1h_input_tokens =
        vibedeck_session_buckets.cache_creation_1h_input_tokens + excluded.cache_creation_1h_input_tokens,
      output_tokens = vibedeck_session_buckets.output_tokens + excluded.output_tokens,
      reasoning_output_tokens = vibedeck_session_buckets.reasoning_output_tokens + excluded.reasoning_output_tokens,
      web_search_requests = vibedeck_session_buckets.web_search_requests + excluded.web_search_requests,
      tool_call_count = vibedeck_session_buckets.tool_call_count + excluded.tool_call_count,
      tools_json = @merged_tools_json,
      activity_json = @merged_activity_json,
      task_category = @merged_task_category,
      skills_json = @merged_skills_json,
      fast_mode = vibedeck_session_buckets.fast_mode + excluded.fast_mode,
      conversation_count = vibedeck_session_buckets.conversation_count + excluded.conversation_count,
      total_tokens = vibedeck_session_buckets.total_tokens + excluded.total_tokens,
      billable_total_tokens = vibedeck_session_buckets.billable_total_tokens + excluded.billable_total_tokens,
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
    cache_creation_5m_input_tokens: cacheCreation5mInputTokens,
    cache_creation_1h_input_tokens: cacheCreation1hInputTokens,
    output_tokens: outputTokens,
    reasoning_output_tokens: reasoningOutputTokens,
    web_search_requests: webSearchRequests,
    tool_call_count: toolCallCount,
    tools_json: mergedToolsJson,
    activity_json: mergedActivityJson,
    task_category: mergedTaskCategory,
    skills_json: mergedSkillsJson,
    fast_mode: fastMode,
    merged_tools_json: mergedToolsJson,
    merged_activity_json: mergedActivityJson,
    merged_task_category: mergedTaskCategory,
    merged_skills_json: mergedSkillsJson,
    conversation_count: conversationCount,
    total_tokens: bucketTotalTokens,
    billable_total_tokens: billableTotalTokens,
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
  const fallbackCost = totalTokens === 0 && !(cost.total_cost_usd > 0)
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

function rebuildBucketFactsForSession(db, sessionRow) {
  if (!sessionRow) return null;
  db.prepare('DELETE FROM vibedeck_session_buckets WHERE provider = ? AND session_id = ?').run(
    sessionRow.provider,
    sessionRow.session_id,
  );
  const events = db
    .prepare(
      `
      SELECT *
      FROM vibedeck_session_events
      WHERE provider = ? AND session_id = ? AND kind = 'update'
      ORDER BY observed_at ASC, event_key ASC
      `,
    )
    .all(sessionRow.provider, sessionRow.session_id);
  for (const event of events) {
    upsertBucketFact(db, sessionRow, event);
  }
  return recomputeSessionLedger(db, sessionRow);
}

module.exports = { toUtcHalfHourStart, upsertBucketFact, recomputeSessionLedger, rebuildBucketFactsForSession };
