'use strict';
const path = require('node:path');

function getProjectReadmeSyncService() {
  const servicePath = path.join(__dirname, '..', 'lib', 'project-readme-sync', 'service.js');
  const cachedService = require.cache[servicePath];
  if (cachedService?.exports?.runProjectReadmeSync) {
    return cachedService.exports;
  }

  return require('../lib/project-readme-sync/service');
}

function showUsage() {
  process.stderr.write('Usage: vibedeck project-readme-sync\n');
}

async function run(argv = []) {
  if (argv.length > 0) {
    showUsage();
    return 1;
  }

  const { runProjectReadmeSync } = getProjectReadmeSyncService();
  const result = await runProjectReadmeSync();

  process.stdout.write(
    [
      'Project README sync: updated',
      `README: ${result.readmePath}`,
      `Banner: ${result.bannerPath}`,
    ].join('\n') + '\n',
  );

  return 0;
}

module.exports = {
  run,
};
