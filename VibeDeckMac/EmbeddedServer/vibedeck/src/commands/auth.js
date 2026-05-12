'use strict';
const path = require('node:path');
const os = require('node:os');
const auth = require('../lib/local-auth');

function _tokenPath() {
  const home = process.env.VIBEDECK_HOME || os.homedir();
  return path.join(home, '.vibedeck', 'auth.token');
}

async function run(argv = []) {
  const sub = argv[0];
  const tokenPath = _tokenPath();
  if (sub === 'rotate') {
    const t = auth.rotateToken(tokenPath);
    process.stdout.write(`Rotated. New token:\n${t}\n`);
    return 0;
  }
  if (sub === 'show' || sub === undefined) {
    const t = auth.ensureToken(tokenPath);
    process.stdout.write(`${t}\n`);
    return 0;
  }
  process.stderr.write(`Usage: vibedeck auth <show|rotate>\n`);
  return 1;
}

module.exports = { run };
