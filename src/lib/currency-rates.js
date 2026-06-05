'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function defaultCachePath() {
  return path.join(os.homedir(), '.vibedeck', 'currency-rates.json');
}

function normalizeCurrency(value, fallback = 'USD') {
  const currency = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return /^[A-Z]{3}$/.test(currency) ? currency : fallback;
}

function normalizeSymbols(symbols) {
  const source = Array.isArray(symbols) ? symbols : [symbols];
  const out = [];
  const seen = new Set();
  for (const symbol of source) {
    const currency = normalizeCurrency(symbol, '');
    if (!currency || seen.has(currency)) continue;
    seen.add(currency);
    out.push(currency);
  }
  return out.length > 0 ? out : ['USD'];
}

function readCache(cachePath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    if (!parsed.base || !parsed.rates || typeof parsed.rates !== 'object') return null;
    return {
      base: normalizeCurrency(parsed.base),
      rates: parsed.rates,
      as_of: parsed.as_of || null,
    };
  } catch (_err) {
    return null;
  }
}

function hasRequestedRates(cache, base, symbols) {
  if (!cache || cache.base !== base) return false;
  return symbols.every((symbol) => symbol === base || Number.isFinite(Number(cache.rates[symbol])));
}

function isFresh(cache) {
  const time = Date.parse(cache?.as_of || '');
  return Number.isFinite(time) && Date.now() - time < CACHE_MAX_AGE_MS;
}

function normalizeRates(base, rates) {
  const out = { [base]: 1 };
  for (const [symbol, value] of Object.entries(rates || {})) {
    const currency = normalizeCurrency(symbol, '');
    const n = Number(value);
    if (currency && Number.isFinite(n) && n > 0) out[currency] = n;
  }
  return out;
}

async function readCurrencyRates({ base = 'USD', symbols = ['EUR'], cachePath, fetchImpl } = {}) {
  const normalizedBase = normalizeCurrency(base);
  const normalizedSymbols = normalizeSymbols(symbols);
  const resolvedCachePath = cachePath || defaultCachePath();
  const cache = readCache(resolvedCachePath);

  if (hasRequestedRates(cache, normalizedBase, normalizedSymbols) && isFresh(cache)) {
    return {
      base: cache.base,
      rates: normalizeRates(cache.base, cache.rates),
      cached: true,
      as_of: cache.as_of,
    };
  }

  const fetcher = fetchImpl || globalThis.fetch;
  try {
    if (typeof fetcher !== 'function') throw new Error('fetch unavailable');
    const to = normalizedSymbols
      .filter((symbol) => symbol !== normalizedBase)
      .map((symbol) => encodeURIComponent(symbol))
      .join(',');
    const url = `https://api.frankfurter.app/latest?from=${encodeURIComponent(normalizedBase)}&to=${to || encodeURIComponent(normalizedBase)}`;
    const response = await fetcher(url);
    if (!response || response.ok === false) throw new Error(`currency fetch failed: ${response?.status || 'unknown'}`);
    const body = await response.json();
    const payload = {
      base: normalizeCurrency(body?.base, normalizedBase),
      rates: normalizeRates(normalizedBase, body?.rates),
      cached: false,
      as_of: new Date().toISOString(),
    };
    fs.mkdirSync(path.dirname(resolvedCachePath), { recursive: true });
    fs.writeFileSync(
      resolvedCachePath,
      JSON.stringify({ base: payload.base, rates: payload.rates, as_of: payload.as_of }, null, 2),
      'utf8',
    );
    return payload;
  } catch (err) {
    if (hasRequestedRates(cache, normalizedBase, normalizedSymbols)) {
      return {
        base: cache.base,
        rates: normalizeRates(cache.base, cache.rates),
        cached: true,
        stale: true,
        as_of: cache.as_of,
        error: err?.message || String(err),
      };
    }
    return {
      base: normalizedBase,
      rates: { [normalizedBase]: 1 },
      error: 'currency_rates_unavailable',
    };
  }
}

module.exports = {
  readCurrencyRates,
};
