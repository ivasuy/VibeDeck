'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { buildLiveAuditRollups } = require('../src/lib/sessions/live-rollups');

function liveRow(overrides = {}) {
  return {
    provider: 'codex',
    session_id: 'live-enriched',
    started_at: '2026-05-12T01:00:00.000Z',
    ended_at: null,
    cwd: '/repo/VibeDeck',
    repo_root: '/repo/VibeDeck',
    parent_repo: '/repo/VibeDeck',
    branch: 'feature/enrichment',
    branch_kind: 'known',
    branch_resolution_tier: 'A',
    confidence: 'high',
    model: 'gpt-5.4',
    total_tokens: 0,
    total_cost_usd: null,
    last_observed_at: '2026-05-12T01:10:00.000Z',
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    ...overrides,
  };
}

test('live rollups bill numeric web search requests even when total tokens are zero', () => {
  const payload = buildLiveAuditRollups([
    liveRow({
      session_id: 'live-web-search',
      web_search_requests: 2,
    }),
  ], {
    now: new Date('2026-05-12T01:15:00.000Z'),
    idleTimeoutMin: 60,
    recentEndedMs: 60 * 60 * 1000,
  });

  assert.equal(payload.sessions.length, 1);
  assert.ok(payload.sessions[0].estimated_total_cost_usd > 0);
  assert.equal(payload.sessions[0].cost_quality, 'token_buckets');
  assert.ok(payload.workstreams[0].active_total_cost_usd > 0);
  assert.ok(payload.workstreams[0].audit_total_cost_usd > 0);
});

test('live rollups do not infer billable web searches from tools json alone', () => {
  const payload = buildLiveAuditRollups([
    liveRow({
      session_id: 'live-tools-only',
      tools_json: '{"web_search":2}',
    }),
  ], {
    now: new Date('2026-05-12T01:15:00.000Z'),
    idleTimeoutMin: 60,
    recentEndedMs: 60 * 60 * 1000,
  });

  assert.equal(payload.sessions.length, 1);
  assert.equal(payload.sessions[0].estimated_total_cost_usd, 0);
  assert.equal(payload.workstreams[0].active_total_cost_usd, 0);
  assert.equal(payload.workstreams[0].audit_total_cost_usd, 0);
});

test('fact-backed branch group sessions expose fact-specific enrichment', () => {
  const session = liveRow({
    session_id: 'fact-backed',
    web_search_requests: 1,
    tool_call_count: 2,
    tools_json: '{"SessionTool":2}',
    activity_json: '{"session":1}',
    total_tokens: 100,
    total_cost_usd: 0.01,
  });
  const fact = {
    provider: 'codex',
    session_id: 'fact-backed',
    branch: 'feature/fact',
    attribution_branch: 'feature/fact',
    branch_kind: 'known',
    branch_resolution_tier: 'B',
    confidence: 'medium',
    model: 'gpt-5.4',
    total_tokens: 75,
    total_cost_usd: 0.25,
    cost_estimated: 0,
    cost_quality: 'stored',
    last_observed_at: '2026-05-12T01:11:00.000Z',
    cache_creation_5m_input_tokens: 10,
    cache_creation_1h_input_tokens: 20,
    web_search_requests: 7,
    tool_call_count: 11,
    tools_json: '{"FactTool":3}',
    activity_json: '{"fact":4}',
  };

  const payload = buildLiveAuditRollups([session], {
    now: new Date('2026-05-12T01:15:00.000Z'),
    idleTimeoutMin: 60,
    recentEndedMs: 60 * 60 * 1000,
    branchFacts: [fact],
  });

  const branchGroup = payload.workstreams[0].branch_groups.find((group) => group.branch === 'feature/fact');
  assert.ok(branchGroup);
  assert.equal(branchGroup.cache_creation_5m_input_tokens, 10);
  assert.equal(branchGroup.cache_creation_1h_input_tokens, 20);
  assert.equal(branchGroup.web_search_requests, 7);
  assert.equal(branchGroup.tool_call_count, 11);
  assert.equal(branchGroup.tools_json, '{"FactTool":3}');
  assert.equal(branchGroup.activity_json, '{"fact":4}');

  const displaySession = branchGroup.sessions[0];
  assert.equal(displaySession.branch, 'feature/fact');
  assert.equal(displaySession.total_tokens, 75);
  assert.equal(displaySession.estimated_total_cost_usd, 0.25);
  assert.equal(displaySession.cache_creation_5m_input_tokens, 10);
  assert.equal(displaySession.cache_creation_1h_input_tokens, 20);
  assert.equal(displaySession.web_search_requests, 7);
  assert.equal(displaySession.tool_call_count, 11);
  assert.equal(displaySession.tools_json, '{"FactTool":3}');
  assert.equal(displaySession.activity_json, '{"fact":4}');
});
