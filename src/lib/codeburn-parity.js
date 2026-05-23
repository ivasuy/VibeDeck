'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync: defaultExecFileSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function toFiniteNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function numericField(row, key) {
  const n = Number(row?.[key] || 0);
  return Number.isFinite(n) ? n : 0;
}

function formatFixed(value, digits) {
  const n = Number(value);
  return (Number.isFinite(n) ? n : 0).toFixed(digits);
}

function parseCounterJson(value) {
  const parsed = typeof value === 'string'
    ? (() => {
      if (!value.trim()) return null;
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    })()
    : value;

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out = {};
  for (const [key, count] of Object.entries(parsed)) {
    if (!isNonEmptyString(key)) continue;
    if (!Number.isInteger(count) || count < 0) continue;
    out[key] = count;
  }
  return out;
}

function stableCounterJson(counter) {
  const parsed = parseCounterJson(counter);
  const keys = Object.keys(parsed).sort();
  if (keys.length === 0) return null;
  const out = {};
  for (const key of keys) out[key] = parsed[key];
  return JSON.stringify(out);
}

function mergeCounter(target, counter) {
  const parsed = parseCounterJson(counter);
  for (const [key, count] of Object.entries(parsed)) {
    target[key] = (target[key] || 0) + count;
  }
}

function sortedCounterObject(counter) {
  const out = {};
  for (const key of Object.keys(counter || {}).sort()) out[key] = counter[key];
  return out;
}

function normalizeDateFilter(value) {
  return isNonEmptyString(value) ? value.trim().slice(0, 10) : '';
}

function readCodeburnFactRows(dbPath, { from = null, to = null, source = null, model = null, branch = null } = {}) {
  if (!isNonEmptyString(dbPath) || !fs.existsSync(dbPath)) return [];
  const clauses = [];
  const params = {};

  const fromDay = normalizeDateFilter(from);
  const toDay = normalizeDateFilter(to);
  if (fromDay) {
    clauses.push("substr(last_observed_at, 1, 10) >= @from");
    params.from = fromDay;
  }
  if (toDay) {
    clauses.push("substr(last_observed_at, 1, 10) <= @to");
    params.to = toDay;
  }
  if (isNonEmptyString(source)) {
    clauses.push("LOWER(provider) = @source");
    params.source = source.trim().toLowerCase();
  }
  if (isNonEmptyString(model)) {
    clauses.push("model = @model");
    params.model = model.trim();
  }
  if (isNonEmptyString(branch)) {
    clauses.push("branch = @branch");
    params.branch = branch.trim();
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    return db.prepare(`
      SELECT *
      FROM vibedeck_branch_usage_facts
      ${where}
      ORDER BY last_observed_at ASC, first_observed_at ASC, provider ASC, session_id ASC
    `).all(params);
  } finally {
    db.close();
  }
}

function buildTotals(rows) {
  const identities = new Set();
  const totalCost = rows.reduce((sum, row) => {
    identities.add(`${row.provider || ''}\u0000${row.session_id || ''}`);
    return sum + numericField(row, 'total_cost_usd');
  }, 0);
  const totalTokens = rows.reduce((sum, row) => sum + numericField(row, 'total_tokens'), 0);
  const qualities = Array.from(new Set(rows.map((row) => row.cost_quality).filter(Boolean)));
  return {
    session_count: identities.size,
    total_tokens: totalTokens,
    total_cost_usd: formatFixed(totalCost, 4),
    cost_estimated: rows.some((row) => Boolean(row.cost_estimated)),
    cost_quality: totalTokens === 0 ? 'zero_tokens' : qualities.length === 1 ? qualities[0] : 'mixed',
  };
}

function latestTimestamp(rows) {
  let latest = null;
  for (const row of rows) {
    for (const value of [row?.updated_at, row?.last_observed_at, row?.first_observed_at]) {
      if (!isNonEmptyString(value)) continue;
      const iso = new Date(value).toISOString();
      if (!latest || iso > latest) latest = iso;
    }
  }
  return latest || new Date().toISOString();
}

function envelope(rows, options = {}) {
  return {
    ok: true,
    as_of: latestTimestamp(rows),
    range: {
      from: normalizeDateFilter(options.from),
      to: normalizeDateFilter(options.to),
      tz: isNonEmptyString(options.tz) ? options.tz.trim() : 'UTC',
    },
    totals: buildTotals(rows),
  };
}

function safeRate(numerator, denominator) {
  if (!Number.isFinite(denominator) || denominator <= 0) return '0.00';
  return formatFixed((numerator / denominator) * 100, 2);
}

function buildComparePayload(rows, options = {}) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const totals = buildTotals(sourceRows);
  const sessions = totals.session_count;
  let oneShot = 0;
  let retry = 0;
  let selfCorrection = 0;
  let totalCost = 0;
  let toolCalls = 0;
  let editCount = 0;
  let cachedTokens = 0;
  let cacheDenominator = 0;

  for (const row of sourceRows) {
    const activity = parseCounterJson(row.activity_json);
    const tools = parseCounterJson(row.tools_json);
    if (numericField(row, 'event_count') <= 1 || numericField(row, 'conversation_count') <= 1) oneShot += 1;
    if (numericField(activity, 'editing') > 1) retry += 1;
    if (numericField(tools, 'Bash') > 0 && numericField(tools, 'Edit') > 0) selfCorrection += 1;
    totalCost += numericField(row, 'total_cost_usd');
    toolCalls += numericField(row, 'tool_call_count');
    editCount += numericField(activity, 'editing');
    cachedTokens += numericField(row, 'cached_input_tokens');
    cacheDenominator += numericField(row, 'input_tokens')
      + numericField(row, 'cache_creation_5m_input_tokens')
      + numericField(row, 'cache_creation_1h_input_tokens');
  }

  return {
    ...envelope(sourceRows, options),
    metrics: {
      one_shot_rate: safeRate(oneShot, sessions),
      retry_rate: safeRate(retry, sessions),
      self_correction_rate: safeRate(selfCorrection, sessions),
      cost_per_call_usd: formatFixed(toolCalls > 0 ? totalCost / toolCalls : 0, 4),
      cost_per_edit_usd: formatFixed(editCount > 0 ? totalCost / editCount : 0, 4),
      cache_hit_percent: safeRate(cachedTokens, cacheDenominator),
    },
  };
}

function buildModelsPayload(rows, options = {}) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const byModel = new Map();
  for (const row of sourceRows) {
    const model = isNonEmptyString(row?.model) ? row.model.trim() : 'unknown';
    if (!byModel.has(model)) {
      byModel.set(model, {
        model,
        providers: new Set(),
        total_tokens: 0,
        total_cost_usd: 0,
        session_count: 0,
        task_categories: {},
        tools: {},
        skills: {},
        fast_mode_count: 0,
      });
    }
    const entry = byModel.get(model);
    if (isNonEmptyString(row?.provider)) entry.providers.add(row.provider.trim());
    entry.total_tokens += numericField(row, 'total_tokens');
    entry.total_cost_usd += numericField(row, 'total_cost_usd');
    entry.session_count += 1;
    mergeCounter(entry.task_categories, row.task_category);
    mergeCounter(entry.tools, row.tools_json);
    mergeCounter(entry.skills, row.skills_json);
    entry.fast_mode_count += numericField(row, 'fast_mode');
  }

  const models = Array.from(byModel.values())
    .map((entry) => ({
      model: entry.model,
      providers: Array.from(entry.providers).sort(),
      total_tokens: entry.total_tokens,
      total_cost_usd: formatFixed(entry.total_cost_usd, 4),
      session_count: entry.session_count,
      task_categories: sortedCounterObject(entry.task_categories),
      tools: sortedCounterObject(entry.tools),
      skills: sortedCounterObject(entry.skills),
      fast_mode_count: entry.fast_mode_count,
    }))
    .sort((a, b) => b.total_tokens - a.total_tokens || a.model.localeCompare(b.model));

  return { ...envelope(sourceRows, options), models };
}

function buildStatusPayload(dbPath) {
  const empty = {
    ok: true,
    as_of: new Date().toISOString(),
    range: { from: '', to: '', tz: 'UTC' },
    totals: {
      session_count: 0,
      total_tokens: 0,
      total_cost_usd: '0.0000',
      cost_estimated: false,
      cost_quality: 'zero_tokens',
    },
    session_count: 0,
    branch_fact_count: 0,
    event_count: 0,
    providers: [],
    canonical_db_updated_at: null,
    one_liner: '0 sessions | 0 branch facts | 0 providers | DB fresh unknown',
  };
  if (!isNonEmptyString(dbPath) || !fs.existsSync(dbPath)) return empty;

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const session = db.prepare('SELECT COUNT(*) AS count, MAX(updated_at) AS updated_at FROM vibedeck_sessions').get();
    const facts = db.prepare(`
      SELECT
        COUNT(*) AS count,
        COUNT(DISTINCT provider || char(0) || session_id) AS session_count,
        MAX(updated_at) AS updated_at,
        COALESCE(SUM(total_tokens), 0) AS total_tokens,
        COALESCE(SUM(total_cost_usd), 0) AS total_cost_usd,
        SUM(CASE WHEN cost_estimated THEN 1 ELSE 0 END) AS estimated_count
      FROM vibedeck_branch_usage_facts
    `).get();
    const events = db.prepare('SELECT COUNT(*) AS count, MAX(created_at) AS updated_at FROM vibedeck_session_events').get();
    const providers = db.prepare(`
      SELECT provider
      FROM (
        SELECT provider FROM vibedeck_branch_usage_facts
        UNION
        SELECT provider FROM vibedeck_session_events
      )
      WHERE provider IS NOT NULL AND TRIM(provider) <> ''
      ORDER BY provider ASC
    `).all().map((row) => row.provider);
    const latest = latestTimestamp([
      { updated_at: session?.updated_at },
      { updated_at: facts?.updated_at },
      { updated_at: events?.updated_at },
    ]);
    const payload = {
      ok: true,
      as_of: latest,
      range: { from: '', to: '', tz: 'UTC' },
      totals: {
        session_count: Number(facts?.session_count || 0),
        total_tokens: Number(facts?.total_tokens || 0),
        total_cost_usd: formatFixed(facts?.total_cost_usd || 0, 4),
        cost_estimated: Number(facts?.estimated_count || 0) > 0,
        cost_quality: Number(facts?.total_tokens || 0) === 0
          ? 'zero_tokens'
          : Number(facts?.estimated_count || 0) > 0 ? 'mixed' : 'stored',
      },
      session_count: Number(session?.count || 0),
      branch_fact_count: Number(facts?.count || 0),
      event_count: Number(events?.count || 0),
      providers,
      canonical_db_updated_at: latest,
    };
    payload.one_liner = `${payload.session_count} sessions | ${payload.branch_fact_count} branch facts | ${providers.length} providers | DB fresh ${latest}`;
    return payload;
  } finally {
    db.close();
  }
}

function exportRow(row) {
  return {
    provider: row?.provider || '',
    session_id: row?.session_id || '',
    branch: row?.branch || '',
    model: row?.model || '',
    total_tokens: numericField(row, 'total_tokens'),
    cost_usd: formatFixed(numericField(row, 'total_cost_usd'), 4),
    first_observed_at: row?.first_observed_at || '',
    last_observed_at: row?.last_observed_at || '',
    task_category: stableCounterJson(row?.task_category) || '',
    tools_json: stableCounterJson(row?.tools_json) || '',
    activity_json: stableCounterJson(row?.activity_json) || '',
    skills_json: stableCounterJson(row?.skills_json) || '',
  };
}

function buildExportPayload(rows, options = {}) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  return { ...envelope(sourceRows, options), rows: sourceRows.map(exportRow) };
}

const CSV_COLUMNS = [
  'provider',
  'session_id',
  'branch',
  'model',
  'total_tokens',
  'cost_usd',
  'first_observed_at',
  'last_observed_at',
  'task_category',
  'tools_json',
  'activity_json',
  'skills_json',
];

function csvCell(value) {
  const raw = value == null ? '' : String(value);
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function toCsv(rows) {
  const normalized = (Array.isArray(rows) ? rows : []).map((row) =>
    Object.prototype.hasOwnProperty.call(row, 'cost_usd') ? row : exportRow(row));
  return [
    CSV_COLUMNS.join(','),
    ...normalized.map((row) => CSV_COLUMNS.map((column) => csvCell(row[column])).join(',')),
  ].join('\n');
}

function branchYieldState(branch, rows, { from = '', to = '', execFileSync = defaultExecFileSync } = {}) {
  const repoRoot = rows.find((row) => isNonEmptyString(row?.repo_root))?.repo_root;
  const totalTokens = rows.reduce((sum, row) => sum + numericField(row, 'total_tokens'), 0);
  if (!isNonEmptyString(repoRoot) || !fs.existsSync(repoRoot) || !isNonEmptyString(branch)) return 'unknown';

  try {
    const args = ['-C', repoRoot, 'log', '--format=%s'];
    const fromDay = normalizeDateFilter(from);
    const toDay = normalizeDateFilter(to);
    if (fromDay) args.push(`--since=${fromDay}T00:00:00Z`);
    if (toDay) args.push(`--until=${toDay}T23:59:59Z`);
    args.push(branch, '--');
    const output = String(execFileSync('git', args, {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }) || '');
    const subjects = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (subjects.some((subject) => /\brevert\b/i.test(subject))) return 'reverted';
    if (subjects.length > 0) return 'productive';
    return totalTokens > 0 ? 'abandoned' : 'unknown';
  } catch {
    return 'unknown';
  }
}

function buildYieldPayload(rows, options = {}) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const byBranch = new Map();
  for (const row of sourceRows) {
    const branch = isNonEmptyString(row?.branch) ? row.branch.trim() : 'Unknown branch';
    if (!byBranch.has(branch)) byBranch.set(branch, []);
    byBranch.get(branch).push(row);
  }
  const branches = Array.from(byBranch.entries())
    .map(([branch, branchRows]) => {
      const totals = buildTotals(branchRows);
      return {
        branch,
        yield_state: branchYieldState(branch, branchRows, options),
        session_count: totals.session_count,
        total_tokens: totals.total_tokens,
        total_cost_usd: totals.total_cost_usd,
      };
    })
    .sort((a, b) => b.total_tokens - a.total_tokens || a.branch.localeCompare(b.branch));
  return { ...envelope(sourceRows, options), branches };
}

const PROVIDER_PATHS = [
  ['claude', '.claude'],
  ['codex', '.codex'],
  ['cursor', '.cursor'],
  ['gemini', '.gemini'],
  ['openclaw', '.openclaw'],
  ['factory', '.factory'],
  ['qwen', '.qwen'],
  ['kilo', '.config/kilo'],
  ['roo-cline', '.config/Code/User/globalStorage/rooveterinaryinc.roo-cline'],
  ['kiro', '.kiro'],
  ['codebuddy', '.codebuddy'],
  ['craft-agent', '.craft-agent'],
];

function detectInstalledProviders({ env = process.env } = {}) {
  const home = isNonEmptyString(env.HOME) ? env.HOME : os.homedir();
  return PROVIDER_PATHS.map(([provider, relativePath]) => {
    const providerPath = path.join(home, relativePath);
    return {
      provider,
      path: providerPath,
      installed: fs.existsSync(providerPath),
    };
  });
}

module.exports = {
  parseCounterJson,
  stableCounterJson,
  readCodeburnFactRows,
  buildComparePayload,
  buildModelsPayload,
  buildStatusPayload,
  buildExportPayload,
  buildYieldPayload,
  detectInstalledProviders,
  toCsv,
};
