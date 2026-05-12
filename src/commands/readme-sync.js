'use strict';

const {
  parseRepoRef,
  readReadmeSyncConfig,
  writeReadmeSyncConfig,
  readGitHubToken,
  writeGitHubToken,
  removeReadmeSyncState,
} = require('../lib/readme-sync/config');

function parseArgValue(argv, index) {
  const value = argv[index];
  if (typeof value !== 'string' || value.startsWith('--') || !value.trim()) {
    return null;
  }
  return value;
}

function parseSetOptions(argv) {
  const opts = Object.create(null);
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--repo') {
      const value = parseArgValue(argv, i + 1);
      if (value === null) return null;
      opts.repo = value;
      i += 1;
      continue;
    }
    if (token === '--token') {
      const value = parseArgValue(argv, i + 1);
      if (value === null) return null;
      opts.token = value;
      i += 1;
      continue;
    }
    if (token === '--branch') {
      const value = parseArgValue(argv, i + 1);
      if (value === null) return null;
      opts.branch = value;
      i += 1;
      continue;
    }
    if (token === '--path') {
      const value = parseArgValue(argv, i + 1);
      if (value === null) return null;
      opts.path = value;
      i += 1;
      continue;
    }
    return null;
  }
  return opts;
}

function showUsage() {
  process.stderr.write(
    'Usage: vibedeck readme-sync <set|update|status|unset> [options]\n',
  );
}

async function runSet(argv) {
  const opts = parseSetOptions(argv);
  if (!opts || !opts.repo || !opts.token) {
    showUsage();
    return 1;
  }

  const { owner, repo } = parseRepoRef(opts.repo);
  const config = {
    enabled: true,
    repo_owner: owner,
    repo_name: repo,
    branch: opts.branch || 'main',
    readme_path: opts.path || 'README.md',
    svg_path: 'readme-banner.svg',
    marker_start: '<!-- vibedeck:stats:start -->',
    marker_end: '<!-- vibedeck:stats:end -->',
  };

  await writeReadmeSyncConfig(config);
  await writeGitHubToken(opts.token);
  process.stdout.write(`README sync set for ${owner}/${repo}\n`);
  return 0;
}

async function runStatus() {
  const config = await readReadmeSyncConfig();
  const token = await readGitHubToken();
  if (!config?.enabled) {
    process.stdout.write('README sync: disabled\n');
    return 0;
  }

  const marker = token ? 'present' : 'missing';
  process.stdout.write(
    [
      'README sync: enabled',
      `Repo: ${config.repo_owner}/${config.repo_name}`,
      `Branch: ${config.branch || 'main'}`,
      `README: ${config.readme_path || 'README.md'}`,
      `Token: ${marker}`,
      '',
    ].join('\n'),
  );
  return 0;
}

async function runUnset() {
  await removeReadmeSyncState();
  process.stdout.write('README sync disabled\n');
  return 0;
}

async function runUpdate() {
  const { runReadmeSyncUpdate } = require('../lib/readme-sync/service');
  const result = await runReadmeSyncUpdate();
  process.stdout.write(
    `README sync: updated ${result.repo || 'unknown'}\n`,
  );
  return 0;
}

async function run(argv = []) {
  const [subcommand] = argv;
  if (subcommand === 'set') return runSet(argv.slice(1));
  if (subcommand === 'update') return runUpdate();
  if (subcommand === 'status') return runStatus();
  if (subcommand === 'unset') return runUnset();

  showUsage();
  return 1;
}

module.exports = { run };
