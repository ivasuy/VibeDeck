'use strict';

function numeric(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function fixed4(value) {
  return numeric(value).toFixed(4);
}

function buildDailySeries(rows) {
  const byDay = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const day = typeof row?.last_observed_at === 'string' ? row.last_observed_at.slice(0, 10) : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    byDay.set(day, (byDay.get(day) || 0) + numeric(row.total_cost_usd));
  }
  return Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, total]) => ({ day, total }));
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function linearRegressionProjection(values, days) {
  const n = values.length;
  if (n === 0) return 0;
  if (n === 1) return Math.max(0, values[0] * days);

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i += 1) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumXX += i * i;
  }
  const denominator = n * sumXX - sumX * sumX;
  const slope = denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  let projected = 0;
  for (let x = n; x < n + days; x += 1) {
    projected += intercept + slope * x;
  }
  return Math.max(0, projected);
}

function detectAnomalies(series) {
  const anomalies = [];
  for (let i = 1; i < series.length; i += 1) {
    const prior = series.slice(Math.max(0, i - 7), i).map((entry) => entry.total);
    const priorAverage = average(prior);
    const total = series[i].total;
    if (priorAverage > 0 && total >= priorAverage * 2 && total - priorAverage >= 1) {
      anomalies.push({
        day: series[i].day,
        total_cost_usd: fixed4(total),
        prior_7d_average_usd: fixed4(priorAverage),
        delta_usd: fixed4(total - priorAverage),
      });
    }
  }
  return anomalies;
}

function buildPulse(series, anomalies) {
  if (series.length === 0) {
    return { state: 'quiet', reason: 'No usage rows in the selected range.' };
  }
  const latestDay = series[series.length - 1].day;
  if (anomalies.some((anomaly) => anomaly.day === latestDay)) {
    return {
      state: 'spike',
      reason: 'Latest day is at least 2x the prior 7-day average and $1.00 higher.',
    };
  }

  const latest7 = series.slice(-7).map((entry) => entry.total);
  const previous7 = series.slice(-14, -7).map((entry) => entry.total);
  const latestAverage = average(latest7);
  const previousAverage = average(previous7);
  if (previousAverage > 0 && latestAverage >= previousAverage * 1.25 && latestAverage - previousAverage >= 1) {
    return { state: 'rising', reason: 'Latest 7-day average is rising versus the previous 7 days.' };
  }
  return { state: 'quiet', reason: 'Latest usage is within the recent baseline.' };
}

function buildForecastPayload(rows, options = {}) {
  const series = buildDailySeries(rows);
  const totals = series.map((entry) => entry.total);
  const last7 = totals.slice(-7);
  const anomalies = detectAnomalies(series);
  return {
    ok: true,
    range: {
      from: options.from || '',
      to: options.to || '',
    },
    daily: series.map((entry) => ({ day: entry.day, total_cost_usd: fixed4(entry.total) })),
    moving_average_7d: fixed4(average(last7)),
    forecast_30d_usd: fixed4(linearRegressionProjection(totals, 30)),
    anomalies,
    pulse: buildPulse(series, anomalies),
  };
}

module.exports = {
  buildForecastPayload,
};
