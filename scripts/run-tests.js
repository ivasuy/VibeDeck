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
  const args = ['--test', ...(testFiles.length > 0 ? testFiles : listDefaultTests())];
  try {
    return run(process.execPath, args, {
      env: {
        ...process.env,
        VIBEDECK_HOME: isolatedHome,
      },
    });
  } finally {
    fs.rmSync(isolatedHome, { recursive: true, force: true });
  }
}

process.exitCode = main();
