'use strict';

const os = require('node:os');
const path = require('node:path');
const { resolveTrackerPaths } = require('../tracker-paths');
const { readUsageRowsFromDb } = require('../usage-read-models');

function parseDateString(isoDate) {
  if (typeof isoDate !== 'string') return null;
  const trimmed = isoDate.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const parsed = new Date(Date.UTC(y, mo, d));
  if (!Number.isFinite(parsed.getTime())) return null;
  if (formatDateUTC(parsed) !== trimmed) return null;
  return parsed;
}

function formatDateUTC(date) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  ).toISOString().slice(0, 10);
}

function addUtcDays(date, days) {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() + days,
    ),
  );
}

function formatUpdatedDate(now) {
  const updated = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date();
  return updated.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function quantile(values, q) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const pos = (n - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const left = sorted[base] ?? sorted[n - 1];
  const right = sorted[Math.min(n - 1, base + 1)] ?? sorted[n - 1];
  return left + (right - left) * rest;
}

function clampLevel(level) {
  if (level <= 0) return 0;
  if (level >= 4) return 4;
  return Math.trunc(level);
}

function resolveHeatmapWindow({ to, weeks = 52, weekStartsOn = 'sun' }) {
  const now = parseDateString(to) || new Date();
  const endBase = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const desired = weekStartsOn === 'mon' ? 1 : 0;
  const endDow = endBase.getUTCDay();
  const end = addUtcDays(endBase, -((endDow - desired + 7) % 7));
  const start = addUtcDays(end, -7 * Math.max(1, weeks - 1));
  return { start, end };
}

function formatCompactTokenCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);

  const format = (v, suffix, decimals = 1) => {
    const normalized = Number(v.toFixed(decimals));
    return `${sign}${normalized.toString()}${suffix}`;
  };

  if (abs >= 1_000_000_000) return format(abs / 1_000_000_000, 'B', 2);
  if (abs >= 1_000_000) {
    const asMillions = abs / 1_000_000;
    const carry = asMillions >= 1000 ? format(asMillions / 1000, 'B', 2) : format(asMillions, 'M', 1);
    return carry;
  }
  if (abs >= 1_000) {
    const asThousands = abs / 1_000;
    const carry = asThousands >= 1000 ? format(asThousands / 1000, 'M', 1) : format(asThousands, 'K', 1);
    return carry;
  }
  return `${sign}${Math.round(abs)}`;
}

function formatUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '$0';
  const rounded = Math.round(Math.abs(n));
  const formattedInt = new Intl.NumberFormat('en-US').format(rounded);
  const sign = n < 0 ? '-' : '';
  return `${sign}$${formattedInt}`;
}

function resolveTopModels(rows, totalBillable) {
  const byModel = new Map();
  for (const row of rows) {
    const model = typeof row?.model === 'string' && row.model.trim() ? row.model.trim() : 'unknown';
    const value = Number(row?.billable_total_tokens ?? row?.total_tokens ?? 0) || 0;
    byModel.set(model, (byModel.get(model) || 0) + value);
  }

  const ordered = Array.from(byModel.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  return ordered.map(([name, billableTokens]) => {
    const percent = totalBillable > 0 ? Math.round((billableTokens / totalBillable) * 100) : 0;
    return {
      name,
      valueLabel: formatCompactTokenCount(billableTokens),
      percentLabel: `${Math.min(100, Math.max(0, percent))}%`,
    };
  });
}

function buildHeatmap(rows, { to, weeks = 52, weekStartsOn = 'sun' }) {
  const { start, end } = resolveHeatmapWindow({ to, weeks, weekStartsOn });
  const totalDays = Math.max(1, Math.ceil(weeks)) * 7;
  const dailyByDate = new Map();

  for (const row of rows) {
    if (!row?.hour_start) continue;
    const day = String(row.hour_start).slice(0, 10);
    const v = Number(row?.billable_total_tokens ?? row?.total_tokens ?? 0);
    if (!day) continue;
    const bucket = dailyByDate.get(day) || 0;
    dailyByDate.set(day, Math.max(0, bucket + (Number.isFinite(v) ? v : 0)));
  }

  const values = [];
  for (let i = 0; i < totalDays; i++) {
    const key = formatDateUTC(addUtcDays(start, i));
    const value = dailyByDate.get(key) || 0;
    if (value > 0) values.push(value);
  }
  values.sort((a, b) => a - b);

  const t1 = quantile(values, 0.5);
  const t2 = quantile(values, 0.75);
  const t3 = quantile(values, 0.9);

  function levelFor(value) {
    if (value <= 0) return 0;
    if (t3 === 0) return 1;
    if (value <= t1) return 1;
    if (value <= t2) return 2;
    if (value <= t3) return 3;
    return 4;
  }

  const weeksOut = [];
  for (let w = 0; w < weeks; w++) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      const idx = w * 7 + d;
      const day = formatDateUTC(addUtcDays(start, idx));
      const value = dailyByDate.get(day) || 0;
      week.push({
        day,
        level: clampLevel(levelFor(Number(value))),
      });
    }
    weeksOut.push(week);
  }

  return {
    from: formatDateUTC(start),
    to: formatDateUTC(end),
    week_starts_on: weekStartsOn,
    weeks: weeksOut.slice(-Math.max(1, Math.trunc(weeks))),
    thresholds: { t1, t2, t3 },
  };
}

async function buildReadmeBannerData({ home = os.homedir(), now = new Date() } = {}) {
  const { trackerDir } = await resolveTrackerPaths({ home });
  const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
  const rows = readUsageRowsFromDb(dbPath);
  const resolvedNow = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date();

  const totals = rows.reduce(
    (acc, row) => {
      const billable = Number(row?.billable_total_tokens ?? row?.total_tokens ?? 0) || 0;
      const cost = Number(row?.total_cost_usd || 0) || 0;
      return {
        total_tokens: acc.total_tokens + billable,
        total_cost_usd: acc.total_cost_usd + cost,
      };
    },
    { total_tokens: 0, total_cost_usd: 0 },
  );

  const totalTokens = totals.total_tokens;
  const topModels = resolveTopModels(rows, totalTokens);
  const heatmap = buildHeatmap(rows, {
    to: formatDateUTC(resolvedNow),
    weeks: 52,
    weekStartsOn: 'sun',
  });

  return {
    updatedDateLabel: formatUpdatedDate(resolvedNow),
    totalTokensLabel: formatCompactTokenCount(totalTokens),
    totalTokensSubLabel: `${Math.round(totalTokens).toLocaleString()} tokens total`,
    totalCostLabel: formatUsd(totals.total_cost_usd),
    topModels,
    heatmap,
  };
}

module.exports = {
  buildReadmeBannerData,
  formatCompactTokenCount,
  buildHeatmap,
  formatUpdatedDate,
  formatUsd,
};
