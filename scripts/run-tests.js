'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
    ...options,
  });
  if (result.error) {
    process.stderr.write(`${command} failed to start: ${result.error.message}\n`);
    return 1;
  }
  return Number.isInteger(result.status) ? result.status : 1;
}

function listDefaultTests() {
  return fs
    .readdirSync(path.join(repoRoot, 'test'))
    .filter((name) => name.endsWith('.test.js'))
    .sort()
    .map((name) => path.join('test', name));
}

function main() {
  const buildStatus = run(npmCommand(), ['run', 'dashboard:build']);
  if (buildStatus !== 0) return buildStatus;

  const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vibedeck-test-home-'));
  const testFiles = process.argv.slice(2);
  const args = ['--test', '--test-concurrency=1', ...(testFiles.length > 0 ? testFiles : listDefaultTests())];
  try {
    return run(process.execPath, args, {
      env: {
        ...process.env,
        HOME: isolatedHome,
        CODEX_HOME: path.join(isolatedHome, '.codex'),
        CODE_HOME: path.join(isolatedHome, '.code'),
        GEMINI_HOME: path.join(isolatedHome, '.gemini'),
        OPENCODE_HOME: path.join(isolatedHome, '.opencode'),
        OPENCODE_CONFIG_DIR: path.join(isolatedHome, '.config', 'opencode'),
        GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || 'VibeDeck Test',
        GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || 'vibedeck-test@example.invalid',
        GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || 'VibeDeck Test',
        GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || 'vibedeck-test@example.invalid',
        VIBEDECK_TEST_HOME: isolatedHome,
      },
    });
  } finally {
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  }
}

process.exitCode = main();
