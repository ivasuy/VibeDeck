'use strict';

const os = require('node:os');
const fs = require('node:fs');
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

function formatDateInTimeZone(date, timeZone) {
  const resolvedDate = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(resolvedDate.getTime())) return null;
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(resolvedDate);
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    // Fall back to UTC when the runtime does not recognize the local timezone.
  }
  return formatDateUTC(resolvedDate);
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
  const endWeekStart = addUtcDays(endBase, -((endDow - desired + 7) % 7));
  const start = addUtcDays(endWeekStart, -7 * Math.max(0, weeks - 1));
  return { start, end: endBase };
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

function isLegacyInclusiveCodexRow(row) {
  if (!row || (row.source !== 'codex' && row.source !== 'every-code')) return false;
  const inputTokens = Number(row.input_tokens || 0);
  const cachedInputTokens = Number(row.cached_input_tokens || 0);
  const outputTokens = Number(row.output_tokens || 0);
  const totalTokens = Number(row.total_tokens || 0);
  if (!Number.isFinite(inputTokens) || !Number.isFinite(cachedInputTokens)) return false;
  if (cachedInputTokens <= 0 || inputTokens < cachedInputTokens) return false;
  return totalTokens === inputTokens + outputTokens;
}

function normalizeQueueRow(row) {
  if (!isLegacyInclusiveCodexRow(row)) return row;
  return {
    ...row,
    input_tokens: Number(row.input_tokens || 0) - Number(row.cached_input_tokens || 0),
  };
}

function readQueueRows(queuePath) {
  if (typeof queuePath !== 'string' || !queuePath.trim() || !fs.existsSync(queuePath)) return [];
  const lines = fs.readFileSync(queuePath, 'utf8').split('\n').filter((line) => line.trim());
  const seen = new Map();

  for (const line of lines) {
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const key = `${row?.source || ''}|${row?.model || ''}|${row?.hour_start || ''}`;
    seen.set(key, normalizeQueueRow(row));
  }

  return Array.from(seen.values());
}

function readUsageRowsFromTracker(trackerDir) {
  const dbPath = path.join(trackerDir, 'vibedeck.sqlite3');
  const dbRows = readUsageRowsFromDb(dbPath);
  if (Array.isArray(dbRows) && dbRows.length > 0) return dbRows;
  return readQueueRows(path.join(trackerDir, 'queue.jsonl'));
}

function buildHeatmap(rows, { to, weeks = 52, weekStartsOn = 'sun', timeZone = 'UTC' }) {
  const { start, end } = resolveHeatmapWindow({ to, weeks, weekStartsOn });
  const totalDays = Math.max(1, Math.ceil(weeks)) * 7;
  const dailyByDate = new Map();

  for (const row of rows) {
    if (!row?.hour_start) continue;
    const day = formatDateInTimeZone(new Date(row.hour_start), timeZone);
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
  const maxValue = values.length > 0 ? Math.max(...values) : 0;

  function levelFor(value) {
    if (value <= 0) return 0;
    if (maxValue === 0) return 1;
    const ratio = value / maxValue;
    if (ratio <= 0.25) return 1;
    if (ratio <= 0.5) return 2;
    if (ratio <= 0.75) return 3;
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
        value,
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
    thresholds: {
      t1: maxValue * 0.25,
      t2: maxValue * 0.5,
      t3: maxValue * 0.75,
    },
  };
}

async function buildReadmeBannerData({ home = os.homedir(), now = new Date(), timeZone: preferredTimeZone } = {}) {
  const { trackerDir } = await resolveTrackerPaths({ home });
  const rows = readUsageRowsFromTracker(trackerDir);
  const resolvedNow = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date();
  const timeZone = preferredTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

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
    to: formatDateInTimeZone(resolvedNow, timeZone),
    weeks: 52,
    weekStartsOn: 'sun',
    timeZone,
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
