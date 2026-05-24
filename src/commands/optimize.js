'use strict';

const path = require('node:path');

const { runOptimizeScan } = require('../lib/optimize-scanner');
const { resolveTrackerPaths } = require('../lib/tracker-paths');

async function resolveOptimizeDbPath() {
  if (process.env.VIBEDECK_DB_PATH) return process.env.VIBEDECK_DB_PATH;
  const { trackerDir } = await resolveTrackerPaths();
  return path.join(trackerDir, 'vibedeck.sqlite3');
}

async function cmdOptimize(argv = []) {
  const json = argv.includes('--json');
  const scan = argv.includes('--scan') || argv.length === 0 || (json && argv.length === 1);
  if (!scan) throw new Error('Usage: vibedeck optimize [--scan] [--json]');
  const dbPath = await resolveOptimizeDbPath();
  const result = runOptimizeScan({ dbPath });
  if (json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    process.stdout.write(`Optimize scan ${result.run_id}: ${result.inserted} findings, health ${result.health_grade}\n`);
  }
  return 0;
}

module.exports = { cmdOptimize };
