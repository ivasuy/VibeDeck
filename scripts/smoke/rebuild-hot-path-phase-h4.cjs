#!/usr/bin/env node

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const ARTIFACT_DIR = path.join(
  REPO_ROOT,
  'docs',
  'superpowers',
  'plans',
  'phase-h4-smoke-artifacts',
);
const H3_BASELINE_MS = 337_412;
const H3_BASELINE_REPAIR_PASS_MS = 65_127.053;
const H3_BASELINE_BRANCH_FACT_STAGE_MS = 27_321.343;
const TARGET_MS = 300_000;
const REPAIR_PASS_STAGE_NAME = 'repair_pass';
const BRANCH_FACT_STAGE_NAME = 'branch_fact_rebuild_pass';
const PHASE_H4_ENV_FLAGS = {
  VIBEDECK_REBUILD_PROFILE: '1',
  VIBEDECK_FRESH_STAGED_REBUILD: '1',
  VIBEDECK_REBUILD_CACHE: '1',
  VIBEDECK_SINGLE_REBUILD_WRITER: '1',
  VIBEDECK_PARALLEL_PARSE: '1',
  VIBEDECK_PROVIDER_BRANCH_FIX: '1',
  VIBEDECK_REBUILD_RECENT_FASTPATH: '1',
  VIBEDECK_REBUILD_DIRTY_POST_DRAIN: '1',
  VIBEDECK_REBUILD_FLUSH_SLICE_EVENTS: '2000',
  VIBEDECK_REBUILD_SESSION_BATCH_EVENTS: '1000',
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

function stageDuration(stages, name) {
  const stage = stages.find((entry) => entry.name === name);
  return stage ? stage.duration_ms : null;
}

function stageGate({ exitCode, stages, stageName, baselineMs, mode }) {
  const currentMs = stageDuration(stages, stageName);
  const covered = currentMs !== null;
  const passed =
    exitCode === 0 &&
    covered &&
    (mode === 'improvement' ? currentMs < baselineMs : currentMs <= baselineMs);

  return {
    stage_name: stageName,
    baseline_ms: baselineMs,
    target_ms: baselineMs,
    current_ms: currentMs,
    covered,
    passed,
    delta_vs_baseline_ms:
      currentMs === null ? null : Math.round((currentMs - baselineMs) * 1000) / 1000,
  };
}

function buildPhaseH4SmokeSummary({
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
  const stageTotalMs = Math.round(stages.reduce((sum, stage) => sum + stage.duration_ms, 0));
  const wallClockPassed = exitCode === 0 && measuredMs !== null && measuredMs <= TARGET_MS;
  const repairPassGate = stageGate({
    exitCode,
    stages,
    stageName: REPAIR_PASS_STAGE_NAME,
    baselineMs: H3_BASELINE_REPAIR_PASS_MS,
    mode: 'improvement',
  });
  const branchFactGate = stageGate({
    exitCode,
    stages,
    stageName: BRANCH_FACT_STAGE_NAME,
    baselineMs: H3_BASELINE_BRANCH_FACT_STAGE_MS,
    mode: 'non_regression',
  });
  const gatePassed = wallClockPassed && repairPassGate.passed && branchFactGate.passed;

  return {
    generated_at: generatedAt,
    command,
    phase_h4_flags: PHASE_H4_ENV_FLAGS,
    phase_h3_baseline: {
      wall_clock_ms: H3_BASELINE_MS,
      repair_pass_stage_name: REPAIR_PASS_STAGE_NAME,
      repair_pass_ms: H3_BASELINE_REPAIR_PASS_MS,
      branch_fact_stage_name: BRANCH_FACT_STAGE_NAME,
      branch_fact_stage_ms: H3_BASELINE_BRANCH_FACT_STAGE_MS,
    },
    result: gatePassed ? 'pass' : 'fail',
    exit_code: exitCode,
    wall_clock_ms: measuredMs,
    wall_clock_s: measuredMs === null ? null : Math.round((measuredMs / 1000) * 100) / 100,
    wall_clock_gate: {
      baseline_ms: H3_BASELINE_MS,
      target_ms: TARGET_MS,
      current_ms: measuredMs,
      passed: wallClockPassed,
      delta_vs_baseline_ms: measuredMs === null ? null : measuredMs - H3_BASELINE_MS,
      delta_vs_target_ms: measuredMs === null ? null : measuredMs - TARGET_MS,
    },
    repair_pass_gate: repairPassGate,
    branch_fact_gate: branchFactGate,
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

async function writePhaseH4SmokeArtifacts({
  artifactDir = ARTIFACT_DIR,
  profilePath = defaultProfilePath(),
  wallClockMs,
  command,
  exitCode = 0,
  error = null,
} = {}) {
  await fs.mkdir(artifactDir, { recursive: true });
  const copiedProfilePath = path.join(artifactDir, 'phase-h4-rebuild-profile.json');
  const summaryPath = path.join(artifactDir, 'phase-h4-rebuild-summary.json');
  await copyIfPresent(profilePath, copiedProfilePath);
  const profile = await readJsonIfPresent(profilePath);
  const summary = buildPhaseH4SmokeSummary({
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

async function runPhaseH4Rebuild() {
  const command = `${process.execPath} ${REBUILD_ARGS.map((arg) => JSON.stringify(arg)).join(' ')}`;
  const startedAt = process.hrtime.bigint();
  const stdoutLines = [];
  const stderrLines = [];
  const child = spawn(process.execPath, REBUILD_ARGS, {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ...PHASE_H4_ENV_FLAGS,
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
  const run = await runPhaseH4Rebuild();
  const error =
    run.exitCode === 0
      ? null
      : {
          message: 'phase h4 rebuild command exited non-zero',
          stdout_tail: run.stdout_tail,
          stderr_tail: run.stderr_tail,
        };
  const summary = await writePhaseH4SmokeArtifacts({
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
  H3_BASELINE_MS,
  H3_BASELINE_REPAIR_PASS_MS,
  H3_BASELINE_BRANCH_FACT_STAGE_MS,
  TARGET_MS,
  PHASE_H4_ENV_FLAGS,
  buildPhaseH4SmokeSummary,
  writePhaseH4SmokeArtifacts,
};
