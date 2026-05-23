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
  custom: {
    monthly_usd: 0,
    label: 'API-equivalent cost',
    label_detail: 'API-equivalent cost - this is direct API-equivalent display cost, not a subscription bill.',
  },
};

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

module.exports = {
  readPlanConfig,
};
