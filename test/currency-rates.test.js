'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { readCurrencyRates } = require('../src/lib/currency-rates');

function tempCachePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibedeck-rates-'));
  return {
    dir,
    cachePath: path.join(dir, 'currency-rates.json'),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

test('readCurrencyRates fetches Frankfurter rates and writes a 24h cache', async () => {
  const f = tempCachePath();
  try {
    let requestedUrl = '';
    const result = await readCurrencyRates({
      cachePath: f.cachePath,
      symbols: ['EUR', 'GBP'],
      fetchImpl: async (url) => {
        requestedUrl = url;
        return {
          ok: true,
          async json() {
            return { base: 'USD', date: '2026-05-23', rates: { EUR: 0.92, GBP: 0.79 } };
          },
        };
      },
    });

    assert.equal(requestedUrl, 'https://api.frankfurter.app/latest?from=USD&to=EUR,GBP');
    assert.equal(result.base, 'USD');
    assert.equal(result.cached, false);
    assert.equal(result.rates.EUR, 0.92);
    assert.equal(result.rates.GBP, 0.79);
    assert.equal(JSON.parse(fs.readFileSync(f.cachePath, 'utf8')).rates.EUR, 0.92);
  } finally {
    f.cleanup();
  }
});

test('readCurrencyRates uses a fresh cache without calling fetch', async () => {
  const f = tempCachePath();
  try {
    fs.writeFileSync(
      f.cachePath,
      JSON.stringify({
        base: 'USD',
        rates: { USD: 1, EUR: 0.91 },
        as_of: new Date().toISOString(),
      }),
      'utf8',
    );

    const result = await readCurrencyRates({
      cachePath: f.cachePath,
      symbols: ['EUR'],
      fetchImpl: async () => {
        throw new Error('fetch should not be called for a fresh cache');
      },
    });

    assert.equal(result.cached, true);
    assert.equal(result.rates.EUR, 0.91);
  } finally {
    f.cleanup();
  }
});

test('readCurrencyRates returns stale cache on fetch failure', async () => {
  const f = tempCachePath();
  try {
    fs.writeFileSync(
      f.cachePath,
      JSON.stringify({
        base: 'USD',
        rates: { USD: 1, EUR: 0.88 },
        as_of: '2026-01-01T00:00:00.000Z',
      }),
      'utf8',
    );

    const result = await readCurrencyRates({
      cachePath: f.cachePath,
      symbols: ['EUR'],
      fetchImpl: async () => {
        throw new Error('offline');
      },
    });

    assert.equal(result.cached, true);
    assert.equal(result.stale, true);
    assert.equal(result.rates.EUR, 0.88);
  } finally {
    f.cleanup();
  }
});

test('readCurrencyRates reports a display-only fallback when no cache is available', async () => {
  const f = tempCachePath();
  try {
    const result = await readCurrencyRates({
      cachePath: f.cachePath,
      symbols: ['EUR'],
      fetchImpl: async () => {
        throw new Error('offline');
      },
    });

    assert.deepEqual(result, {
      base: 'USD',
      rates: { USD: 1 },
      error: 'currency_rates_unavailable',
    });
  } finally {
    f.cleanup();
  }
});
