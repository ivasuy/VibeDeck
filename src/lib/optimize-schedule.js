'use strict';

const { DatabaseSync } = require('node:sqlite');
const { ensureSchema } = require('./db');
const { runOptimizeScan } = require('./optimize-scanner');

function enabledFromEnv(env = process.env) {
  return env.VIBEDECK_OPTIMIZE_SCHEDULE_V1 === 'on' || env.VIBEDECK_OPTIMIZE_SCHEDULE_V1 === '1';
}

function latestRunMs(dbPath) {
  ensureSchema(dbPath);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare('SELECT observed_at FROM vibedeck_optimize_runs ORDER BY observed_at DESC LIMIT 1').get();
    if (!row || !row.observed_at) return 0;
    const ms = Date.parse(row.observed_at);
    return Number.isFinite(ms) ? ms : 0;
  } finally {
    db.close();
  }
}

function startOptimizeSchedule({ dbPath, logger = console, intervalMs = 6 * 60 * 60 * 1000, env = process.env } = {}) {
  let stopped = false;
  let timer = null;
  const enabled = enabledFromEnv(env);

  async function trigger() {
    if (!enabled || stopped) return { ok: true, skipped: true };
    try {
      const last = latestRunMs(dbPath);
      if (last > 0 && Date.now() - last < intervalMs) return { ok: true, skipped: true };
      return runOptimizeScan({ dbPath });
    } catch (err) {
      try {
        logger?.warn?.(`Optimize scan warning: ${err?.message || err}`);
      } catch (_logErr) {}
      return { ok: false, skipped: false, error: String(err?.message || err) };
    }
  }

  function scheduleNext(delayMs) {
    if (!enabled || stopped) return;
    timer = setTimeout(async () => {
      await trigger();
      scheduleNext(intervalMs);
    }, delayMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  scheduleNext(10_000);

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    trigger,
  };
}

module.exports = { startOptimizeSchedule };
