'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PLAN_DEFAULTS = {
  'claude-pro': {
    monthly_usd: 20,
    label: 'Plan usage',
    label_detail: 'Plan usage',
  },
  'claude-max': {
    monthly_usd: 100,
    label: 'Plan usage',
    label_detail: 'Plan usage',
  },
  'cursor-pro': {
    monthly_usd: 20,
    label: 'API-equivalent cost',
    label_detail: 'API-equivalent cost - this is what these tokens would have cost via direct API, not what you owe Cursor.',
  },
  'copilot-pro': {
    monthly_usd: 10,
    label: 'API-equivalent cost',
    label_detail: 'API-equivalent cost - this is what these tokens would have cost via direct API, not what you owe Copilot.',
  },
  'claude-monthly': {
    monthly_usd: 0,
    label: 'Plan usage',
    label_detail: 'Plan usage, detected from your Claude activity.',
  },
  'codex-monthly': {
    monthly_usd: 0,
    label: 'Plan usage',
    label_detail: 'Plan usage, detected from your Codex activity.',
  },
  'mixed-monthly': {
    monthly_usd: 0,
    label: 'Plan usage',
    label_detail: 'Plan usage, detected across your active providers.',
  },
  custom: {
    monthly_usd: 0,
    label: 'API-equivalent cost',
    label_detail: 'API-equivalent cost - this is direct API-equivalent display cost, not a subscription bill.',
  },
};

const TIER_PRESETS = [20, 100, 200];

function readConfigFile(home) {
  const configPath = path.join(home || os.homedir(), '.vibedeck', 'plan-config.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_err) {
    return {};
  }
}

function normalizePlan(value) {
  const plan = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return Object.prototype.hasOwnProperty.call(PLAN_DEFAULTS, plan) ? plan : 'custom';
}

function normalizeMonthlyUsd(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function normalizeCurrency(value) {
  const currency = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z]{3}$/.test(currency) ? currency : 'USD';
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

function readPlanConfig({ env = process.env, home = os.homedir() } = {}) {
  const fileConfig = readConfigFile(home);
  const plan = normalizePlan(firstDefined(env.VIBEDECK_PLAN, fileConfig.plan));
  const defaults = PLAN_DEFAULTS[plan] || PLAN_DEFAULTS.custom;
  const monthly_usd = normalizeMonthlyUsd(
    firstDefined(env.VIBEDECK_PLAN_MONTHLY_USD, fileConfig.monthly_usd, fileConfig.monthlyUsd),
    defaults.monthly_usd,
  );
  const display_currency = normalizeCurrency(firstDefined(env.VIBEDECK_DISPLAY_CURRENCY, fileConfig.display_currency, fileConfig.displayCurrency));

  return {
    plan,
    monthly_usd,
    label: defaults.label,
    label_detail: defaults.label_detail,
    display_currency,
  };
}

function snapToTier(cost) {
  const n = Number(cost);
  if (!Number.isFinite(n) || n <= 0) return TIER_PRESETS[0];
  for (const tier of TIER_PRESETS) {
    if (n <= tier) return tier;
  }
  return TIER_PRESETS[TIER_PRESETS.length - 1];
}

function lastNDaysIso(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function inferPlanFromDb(dbPath) {
  if (!dbPath || !fs.existsSync(dbPath)) return null;
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch (_err) {
    return null;
  }

  let rows;
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    rows = db.prepare(`
      SELECT LOWER(provider) AS provider, SUM(total_cost_usd) AS cost
      FROM vibedeck_branch_usage_facts
      WHERE substr(last_observed_at, 1, 10) >= @since
        AND provider IS NOT NULL AND TRIM(provider) <> ''
      GROUP BY LOWER(provider)
    `).all({ since: lastNDaysIso(30) });
  } catch (_err) {
    return null;
  } finally {
    try { if (db) db.close(); } catch (_e) { /* ignore */ }
  }

  if (!Array.isArray(rows) || rows.length === 0) return null;

  const providers = rows
    .map((row) => String(row.provider || '').trim())
    .filter(Boolean)
    .sort();
  if (providers.length === 0) return null;

  let monthly = 0;
  for (const row of rows) {
    monthly += snapToTier(row.cost);
  }

  let planId = 'custom';
  const hasClaude = providers.includes('claude');
  const hasCodex = providers.includes('codex');
  if (hasClaude && hasCodex) planId = 'mixed-monthly';
  else if (hasClaude) planId = 'claude-monthly';
  else if (hasCodex) planId = 'codex-monthly';

  const defaults = PLAN_DEFAULTS[planId] || PLAN_DEFAULTS.custom;
  return {
    plan: planId,
    monthly_usd: monthly,
    label: defaults.label,
    label_detail: defaults.label_detail,
    providers,
  };
}

function hasExplicitConfig({ env, fileConfig }) {
  const explicit = firstDefined(
    env.VIBEDECK_PLAN,
    env.VIBEDECK_PLAN_MONTHLY_USD,
    fileConfig.plan,
    fileConfig.monthly_usd,
    fileConfig.monthlyUsd,
  );
  return explicit !== undefined;
}

function readEffectivePlanConfig({ env = process.env, home = os.homedir(), dbPath = null } = {}) {
  const fileConfig = readConfigFile(home);
  if (hasExplicitConfig({ env, fileConfig })) {
    return { ...readPlanConfig({ env, home }), inferred: false };
  }

  const inferred = inferPlanFromDb(dbPath);
  if (inferred) {
    const display_currency = normalizeCurrency(
      firstDefined(env.VIBEDECK_DISPLAY_CURRENCY, fileConfig.display_currency, fileConfig.displayCurrency),
    );
    return { ...inferred, display_currency, inferred: true };
  }

  return { ...readPlanConfig({ env, home }), inferred: null };
}

module.exports = {
  readPlanConfig,
  readEffectivePlanConfig,
  inferPlanFromDb,
  snapToTier,
};
