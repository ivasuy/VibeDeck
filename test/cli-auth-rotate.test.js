const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

function tmpHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-cli-auth-'));
  fs.mkdirSync(path.join(home, '.vibedeck'), { recursive: true });
  return home;
}

function runCli(args, env) {
  const r = cp.spawnSync(process.execPath, ['bin/vibedeck.js', ...args], { env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`cli failed (${r.status}): ${r.stderr}`);
  return r.stdout;
}

test('vibedeck auth rotate prints a new token and persists it', () => {
  const home = tmpHome();
  const env = { ...process.env, HOME: home, VIBEDECK_HOME: home };
  runCli(['auth', 'show'], env);
  const initial = fs.readFileSync(path.join(home, '.vibedeck', 'auth.token'), 'utf8').trim();
  const out = runCli(['auth', 'rotate'], env);
  const rotated = fs.readFileSync(path.join(home, '.vibedeck', 'auth.token'), 'utf8').trim();
  assert.notStrictEqual(initial, rotated);
  assert.match(out, new RegExp(rotated));
});

test('vibedeck auth show prints the current token without rotating', () => {
  const home = tmpHome();
  const env = { ...process.env, HOME: home, VIBEDECK_HOME: home };
  runCli(['auth', 'show'], env);
  const before = fs.readFileSync(path.join(home, '.vibedeck', 'auth.token'), 'utf8').trim();
  const out = runCli(['auth', 'show'], env);
  const after = fs.readFileSync(path.join(home, '.vibedeck', 'auth.token'), 'utf8').trim();
  assert.strictEqual(before, after);
  assert.match(out, new RegExp(before));
});
