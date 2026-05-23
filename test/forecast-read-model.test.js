'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildForecastPayload } = require('../src/lib/forecast-read-model');

function row(day, totalCost, extra = {}) {
  return {
    provider: 'claude',
    session_id: `s-${day}`,
    branch: 'main',
    model: 'claude-sonnet-4',
    last_observed_at: `${day}T12:00:00.000Z`,
    total_cost_usd: totalCost,
    ...extra,
  };
}

test('buildForecastPayload groups rows by day and reports a sorted daily series', () => {
  const payload = buildForecastPayload([
    row('2026-05-03', 3),
    row('2026-05-01', 1),
    row('2026-05-02', 2),
    row('2026-05-02', 4),
  ]);

  assert.equal(payload.ok, true);
  assert.deepEqual(payload.daily, [
    { day: '2026-05-01', total_cost_usd: '1.0000' },
    { day: '2026-05-02', total_cost_usd: '6.0000' },
    { day: '2026-05-03', total_cost_usd: '3.0000' },
  ]);
  assert.equal(payload.moving_average_7d, '3.3333');
});

test('buildForecastPayload detects cost spikes against the prior 7-day average', () => {
  const payload = buildForecastPayload([
    row('2026-05-01', 1),
    row('2026-05-02', 1),
    row('2026-05-03', 1),
    row('2026-05-04', 1),
    row('2026-05-05', 1),
    row('2026-05-06', 1),
    row('2026-05-07', 1),
    row('2026-05-08', 5),
  ]);

  assert.equal(payload.anomalies.length, 1);
  assert.deepEqual(payload.anomalies[0], {
    day: '2026-05-08',
    total_cost_usd: '5.0000',
    prior_7d_average_usd: '1.0000',
    delta_usd: '4.0000',
  });
  assert.deepEqual(payload.pulse, {
    state: 'spike',
    reason: 'Latest day is at least 2x the prior 7-day average and $1.00 higher.',
  });
});

test('buildForecastPayload clamps a negative 30-day projection to zero', () => {
  const payload = buildForecastPayload([
    row('2026-05-01', 5),
    row('2026-05-02', 4),
    row('2026-05-03', 3),
    row('2026-05-04', 2),
    row('2026-05-05', 1),
  ]);

  assert.equal(payload.forecast_30d_usd, '0.0000');
  assert.equal(payload.pulse.state, 'quiet');
});
