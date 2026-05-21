#!/usr/bin/env node

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ARTIFACT_DIR = path.join(REPO_ROOT, 'docs', 'superpowers', 'plans', 'phase-h-smoke-artifacts');
const BASELINE_MS = 268_890;
const TARGET_MS = 195_000;
const PHASE_H_ENV_FLAGS = {
  VIBEDECK_REBUILD_PROFILE: '1',
  VIBEDECK_FRESH_STAGED_REBUILD: '1',
  VIBEDECK_REBUILD_CACHE: '1',
  VIBEDECK_SINGLE_REBUILD_WRITER: '1',
  VIBEDECK_PARALLEL_PARSE: '1',
  VIBEDECK_PROVIDER_BRANCH_FIX: '1',
  VIBEDECK_REBUILD_RECENT_FASTPATH: '1',
  VIBEDECK_REBUILD_DIRTY_POST_DRAIN: '1',
};
const REBUILD_ARGS = [path.join(REPO_ROOT, 'bin', 'vibedeck.js'), 'sync', '--rebuild-vibedeck-db'];

function defaultProfilePath(env = process.env) {
  const home = env.VIBEDECK_HOME || os.homedir();
  return path.join(home, '.vibedeck', 'tracker', 'rebuild_profile.json');
}

function compactStage(stage = {}) {
  return {
    name: typeof stage.name === 'string' ? stage.name : 'unknown',
    duration_ms: Number.isFinite(Number(stage.duration_ms)) ? Number(stage.duration_ms) : 0,
    counters: stage.counters && typeof stage.counters === 'object' ? stage.counters : {},
  };
}

function buildPhaseHSmokeSummary({
  profile = null,
  wallClockMs,
  command,
  exitCode = 0,
  error = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  const measuredMs = Number.isFinite(Number(wallClockMs)) ? Math.round(Number(wallClockMs)) : null;
  const stages = Array.isArray(profile?.stages) ? profile.stages.map(compactStage) : [];
  const topStages = stages
    .slice()
    .sort((a, b) => b.duration_ms - a.duration_ms)
    .slice(0, 10);
  const gatePassed = exitCode === 0 && measuredMs !== null && measuredMs <= TARGET_MS;
  const stageTotalMs = Math.round(stages.reduce((sum, stage) => sum + stage.duration_ms, 0));

  return {
    generated_at: generatedAt,
    command,
    phase_h_flags: PHASE_H_ENV_FLAGS,
    result: gatePassed ? 'pass' : 'fail',
    exit_code: exitCode,
    wall_clock_ms: measuredMs,
    wall_clock_s: measuredMs === null ? null : Math.round((measuredMs / 1000) * 100) / 100,
    performance_gate: {
      baseline_ms: BASELINE_MS,
      target_ms: TARGET_MS,
      passed: gatePassed,
      delta_vs_baseline_ms: measuredMs === null ? null : measuredMs - BASELINE_MS,
      delta_vs_target_ms: measuredMs === null ? null : measuredMs - TARGET_MS,
    },
    totals: {
      ...(profile?.counters && typeof profile.counters === 'object' ? profile.counters : {}),
      profile_stage_total_ms: stageTotalMs,
      profile_stage_count: stages.length,
    },
    top_stages: topStages,
    error,
  };
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

async function copyIfPresent(from, to) {
  try {
    await fs.copyFile(from, to);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function writePhaseHSmokeArtifacts({
  artifactDir = ARTIFACT_DIR,
  profilePath = defaultProfilePath(),
  wallClockMs,
  command,
  exitCode = 0,
  error = null,
} = {}) {
  await fs.mkdir(artifactDir, { recursive: true });
  const copiedProfilePath = path.join(artifactDir, 'phase-h-rebuild-profile.json');
  const summaryPath = path.join(artifactDir, 'phase-h-rebuild-summary.json');
  await copyIfPresent(profilePath, copiedProfilePath);
  const profile = await readJsonIfPresent(profilePath);
  const summary = buildPhaseHSmokeSummary({
    profile,
    wallClockMs,
    command,
    exitCode,
    error,
  });
  await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return summary;
}

function tailLines(lines, max = 80) {
  return lines.slice(Math.max(0, lines.length - max));
}

async function runPhaseHRebuild() {
  const command = `${process.execPath} ${REBUILD_ARGS.map((arg) => JSON.stringify(arg)).join(' ')}`;
  const startedAt = process.hrtime.bigint();
  const stdoutLines = [];
  const stderrLines = [];
  const child = spawn(process.execPath, REBUILD_ARGS, {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ...PHASE_H_ENV_FLAGS,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    stdoutLines.push(...String(chunk).split(/\r?\n/).filter(Boolean));
  });
  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk);
    stderrLines.push(...String(chunk).split(/\r?\n/).filter(Boolean));
  });

  const exitCode = await new Promise((resolve) => {
    child.on('error', (error) => {
      stderrLines.push(error.message);
      resolve(1);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
  const wallClockMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

  return {
    command,
    exitCode,
    wallClockMs,
    stdout_tail: tailLines(stdoutLines),
    stderr_tail: tailLines(stderrLines),
  };
}

async function main() {
  const run = await runPhaseHRebuild();
  const error =
    run.exitCode === 0
      ? null
      : {
          message: 'phase h rebuild command exited non-zero',
          stdout_tail: run.stdout_tail,
          stderr_tail: run.stderr_tail,
        };
  const summary = await writePhaseHSmokeArtifacts({
    wallClockMs: run.wallClockMs,
    command: run.command,
    exitCode: run.exitCode,
    error,
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exitCode = summary.result === 'pass' ? 0 : 1;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message || String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  BASELINE_MS,
  TARGET_MS,
  PHASE_H_ENV_FLAGS,
  buildPhaseHSmokeSummary,
  writePhaseHSmokeArtifacts,
};
