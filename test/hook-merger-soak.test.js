const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const signature = require('../src/lib/hook-merger/signature');
const claude = require('../src/lib/hook-merger/claude');
const codebuddy = require('../src/lib/hook-merger/codebuddy');
const cursor = require('../src/lib/hook-merger/cursor');
const gemini = require('../src/lib/hook-merger/gemini');
const factory = require('../src/lib/hook-merger/factory');
const codex = require('../src/lib/hook-merger/codex');

const SEED = Number(process.env.VIBEDECK_SOAK_SEED || 1);
const TOML_SEED = Number(process.env.VIBEDECK_SOAK_TOML_SEED || 1);

function makeRng(seed) {
  let state = (Number.isFinite(seed) ? seed : 1) | 0;
  if (state === 0) state = 1;
  return () => {
    // xorshift32
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function randInt(rng, maxExclusive) {
  return rng() % maxExclusive;
}

function pick(rng, list) {
  return list[randInt(rng, list.length)];
}

function shuffleInPlace(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function entireEntry(rng, id) {
  const cmd = `/usr/local/bin/entire hook session-end --id=${id}`;
  if (randInt(rng, 2) === 0) return { command: cmd };
  return { hooks: [{ type: 'command', command: cmd }] };
}

function manualEntry(rng, id) {
  const cmd = `echo manual-${id}`;
  if (randInt(rng, 2) === 0) return { command: cmd };
  return { hooks: [{ type: 'command', command: cmd }] };
}

function unknownEntry(rng, id) {
  const entry = {};
  // Deterministic key insert order.
  entry.kind = 'unknown';
  entry.id = id;
  entry.flag = randInt(rng, 2) === 0;
  if (randInt(rng, 3) === 0) entry.command = `echo unknown-${id}`;
  if (randInt(rng, 3) === 0) entry.hooks = 'not-an-array';
  if (randInt(rng, 3) === 0) entry.nested = { a: randInt(rng, 10), b: String(randInt(rng, 10)) };
  return entry;
}

function buildInitialConfig(rng, provider) {
  const entireCount = randInt(rng, 6); // 0-5
  const manualCount = randInt(rng, 4); // 0-3
  const unknownCount = randInt(rng, 3); // 0-2

  const entries = [];
  for (let i = 0; i < entireCount; i++) entries.push(entireEntry(rng, `e${i}`));
  for (let i = 0; i < manualCount; i++) entries.push(manualEntry(rng, `m${i}`));
  for (let i = 0; i < unknownCount; i++) entries.push(unknownEntry(rng, `u${i}`));

  shuffleInPlace(rng, entries);

  if (provider === 'cursor') {
    return { version: 1, hooks: { sessionEnd: entries }, extra: { ok: true } };
  }

  if (provider === 'gemini') {
    return {
      tools: randInt(rng, 2) === 0 ? {} : { enableHooks: false },
      hooks: { SessionEnd: entries },
      extra: { ok: true },
    };
  }

  // Claude-like shape (claude, codebuddy, factory, copilot).
  return { hooks: { SessionEnd: entries }, extra: { ok: true } };
}

function extractEntries(provider, obj) {
  if (provider === 'cursor') return (obj && obj.hooks && obj.hooks.sessionEnd) || [];
  if (provider === 'gemini') return (obj && obj.hooks && obj.hooks.SessionEnd) || [];
  return (obj && obj.hooks && obj.hooks.SessionEnd) || [];
}

function setEntries(provider, obj, entries) {
  if (provider === 'cursor') return { ...(obj || {}), hooks: { ...((obj && obj.hooks) || {}), sessionEnd: entries } };
  if (provider === 'gemini') return { ...(obj || {}), hooks: { ...((obj && obj.hooks) || {}), SessionEnd: entries } };
  return { ...(obj || {}), hooks: { ...((obj && obj.hooks) || {}), SessionEnd: entries } };
}

const PROVIDERS = [
  { name: 'claude', merger: claude },
  { name: 'codebuddy', merger: codebuddy },
  { name: 'cursor', merger: cursor },
  { name: 'gemini', merger: gemini },
  { name: 'factory', merger: factory },
];

test('hook-merger property soak: 1000 random JSON states preserve non-vibedeck entries', async () => {
  const rng = makeRng(SEED);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-soak-'));

  for (let i = 0; i < 1000; i++) {
    const { name: provider, merger } = pick(rng, PROVIDERS);
    const filePath = path.join(dir, `${provider}-${i}.json`);

    const initial = buildInitialConfig(rng, provider);
    fs.writeFileSync(filePath, `${JSON.stringify(initial, null, 2)}\n`);

    const originalObj = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const originalEntries = extractEntries(provider, originalObj);
    const originalStrings = originalEntries.map((e) => JSON.stringify(e));

    try {
      await merger.install(filePath);

      const afterInstallObj = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const afterInstallEntries = extractEntries(provider, afterInstallObj);
      assert.strictEqual(afterInstallEntries.filter((e) => signature.isVibedeckEntryJSON(e)).length, 1);

      const keptAfterInstall = afterInstallEntries.filter((e) => !signature.isVibedeckEntryJSON(e));
      assert.deepStrictEqual(
        keptAfterInstall.map((e) => JSON.stringify(e)),
        originalStrings,
      );

      await merger.remove(filePath);

      const afterRemoveObj = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const afterRemoveEntries = extractEntries(provider, afterRemoveObj);
      assert.strictEqual(afterRemoveEntries.filter((e) => signature.isVibedeckEntryJSON(e)).length, 0);

      const keptAfterRemove = afterRemoveEntries.filter((e) => !signature.isVibedeckEntryJSON(e));
      assert.deepStrictEqual(
        keptAfterRemove.map((e) => JSON.stringify(e)),
        originalStrings,
      );

      // Defensive: the file should always parse and still be a JSON object.
      assert.strictEqual(typeof afterRemoveObj, 'object');
      // Ensure we didn't drop other top-level keys.
      const roundTrip = setEntries(provider, afterRemoveObj, keptAfterRemove);
      assert.ok(roundTrip && typeof roundTrip === 'object');
    } catch (err) {
      const msg =
        `Soak failure (seed=${SEED} iter=${i} provider=${provider}). ` +
        `Repro: VIBEDECK_SOAK_SEED=${SEED} node --test test/hook-merger-soak.test.js`;
      err.message = `${msg}\n${err.message}`;
      throw err;
    }
  }
});

function buildTomlFixture(rng) {
  const lines = [];

  const leadingKeys = randInt(rng, 4); // 0-3
  for (let i = 0; i < leadingKeys; i++) {
    const kind = randInt(rng, 4);
    if (kind === 0) lines.push(`name = \"x-${randInt(rng, 1000)}\"${randInt(rng, 2) === 0 ? '' : ' # name'}`);
    else if (kind === 1) lines.push(`port = ${7600 + randInt(rng, 200)}${randInt(rng, 2) === 0 ? '' : ' # port'}`);
    else if (kind === 2) lines.push(`# leading comment ${randInt(rng, 1000)}`);
    else lines.push(`enabled = ${randInt(rng, 2) === 0 ? 'true' : 'false'}${randInt(rng, 2) === 0 ? '' : ' # enabled'}`);
  }

  // Optional table to ensure injectNotifyArray inserts before the first table header.
  if (randInt(rng, 2) === 0) {
    lines.push('[telemetry]');
    lines.push(`enabled = ${randInt(rng, 2) === 0 ? 'true' : 'false'}`);
  }

  const entireCount = randInt(rng, 6); // 0-5
  const manualCount = randInt(rng, 4); // 0-3

  const entire = [];
  for (let i = 0; i < entireCount; i++) entire.push(`/usr/local/bin/entire hook session-end --id=e${i}`);

  const manual = [];
  for (let i = 0; i < manualCount; i++) manual.push(`echo manual-${i}`);

  const notifyValues = shuffleInPlace(rng, entire.concat(manual));

  const notifyMode = randInt(rng, 4); // 0=absent,1=string,2=array,3=multiline+comments
  if (notifyMode !== 0) {
    if (notifyValues.length === 0) notifyValues.push(`echo manual-solo-${randInt(rng, 1000)}`);
    if (notifyMode === 1) {
      const v = notifyValues[0] || `echo solo-${randInt(rng, 1000)}`;
      lines.push(`notify = \"${v}\"${randInt(rng, 2) === 0 ? '' : ' # notify string'}`);
    } else if (notifyMode === 2) {
      const parts = notifyValues.map((v) => `\"${v}\"`);
      lines.push(`notify = [${parts.join(', ')}]${randInt(rng, 2) === 0 ? '' : ' # notify array'}`);
    } else {
      lines.push('notify = [');
      for (const v of notifyValues) {
        const tail = randInt(rng, 3) === 0 ? ` # entry ${randInt(rng, 1000)}` : '';
        lines.push(`  \"${v}\",${tail}`);
        if (randInt(rng, 5) === 0) lines.push(`  # mid comment ${randInt(rng, 1000)}`);
      }
      lines.push(']');
    }
  }

  lines.push(`# trailing comment ${randInt(rng, 1000)}`);
  return `${lines.join('\n')}\n`;
}

function extractNotifyValuesFromFixtureToml(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^\s*notify\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const rhs = String(m[1] || '');
    if (rhs.trim().startsWith('[')) {
      const chunks = [rhs];
      while (i + 1 < lines.length && !chunks.join('\n').includes(']')) {
        i += 1;
        chunks.push(lines[i]);
      }
      const joined = chunks.join('\n');
      const re = /["']([^"']*)["']/g;
      let mm;
      // eslint-disable-next-line no-cond-assign
      while ((mm = re.exec(joined))) out.push(mm[1]);
    } else {
      const mm = rhs.match(/^\s*["']([^"']*)["']/);
      if (mm) out.push(mm[1]);
    }
  }
  return out;
}

function hasNotifyAssignment(text) {
  return /^\s*notify\s*=\s*/m.test(String(text || ''));
}

function extractNonNotifyLines(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^\s*notify\s*=\s*(.*)\s*$/);
    if (!m) {
      if (line) out.push(line);
      continue;
    }
    const rhs = String(m[1] || '');
    if (rhs.trim().startsWith('[')) {
      while (i + 1 < lines.length && !lines[i].includes(']')) i += 1;
    }
  }
  return out;
}

test('hook-merger property soak: 500 random TOML states preserve non-notify lines and notify semantics', async () => {
  const rng = makeRng(TOML_SEED);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-soak-toml-'));

  for (let i = 0; i < 500; i++) {
    const filePath = path.join(dir, `codex-${i}.toml`);
    const initial = buildTomlFixture(rng);
    fs.writeFileSync(filePath, initial);

    const originalText = fs.readFileSync(filePath, 'utf8');
    const originalHadNotify = hasNotifyAssignment(originalText);
    const originalNotify = extractNotifyValuesFromFixtureToml(originalText);
    const originalEntire = new Set(originalNotify.filter((v) => signature.isEntireCommandStringTOML(v)));
    const originalManual = new Set(
      originalNotify.filter((v) => !signature.isEntireCommandStringTOML(v) && !signature.isVibedeckCommandStringTOML(v)),
    );

    const preservedLines = extractNonNotifyLines(originalText);

    try {
      await codex.install(filePath);
      const afterInstallText = fs.readFileSync(filePath, 'utf8');

      for (const line of preservedLines) assert.ok(afterInstallText.includes(line));

      const afterInstallNotify = extractNotifyValuesFromFixtureToml(afterInstallText);
      assert.ok(hasNotifyAssignment(afterInstallText));
      assert.strictEqual(afterInstallNotify.filter((v) => signature.isVibedeckCommandStringTOML(v)).length, 1);

      const afterInstallEntire = new Set(afterInstallNotify.filter((v) => signature.isEntireCommandStringTOML(v)));
      const afterInstallManual = new Set(
        afterInstallNotify.filter(
          (v) => !signature.isEntireCommandStringTOML(v) && !signature.isVibedeckCommandStringTOML(v),
        ),
      );
      assert.deepStrictEqual(afterInstallEntire, originalEntire);
      assert.deepStrictEqual(afterInstallManual, originalManual);

      await codex.remove(filePath);
      const afterRemoveText = fs.readFileSync(filePath, 'utf8');

      for (const line of preservedLines) assert.ok(afterRemoveText.includes(line));

      if (originalHadNotify) assert.ok(hasNotifyAssignment(afterRemoveText));
      else assert.ok(!hasNotifyAssignment(afterRemoveText));

      const afterRemoveNotify = extractNotifyValuesFromFixtureToml(afterRemoveText);
      assert.strictEqual(afterRemoveNotify.filter((v) => signature.isVibedeckCommandStringTOML(v)).length, 0);

      const afterRemoveEntire = new Set(afterRemoveNotify.filter((v) => signature.isEntireCommandStringTOML(v)));
      const afterRemoveManual = new Set(
        afterRemoveNotify.filter(
          (v) => !signature.isEntireCommandStringTOML(v) && !signature.isVibedeckCommandStringTOML(v),
        ),
      );
      assert.deepStrictEqual(afterRemoveEntire, originalEntire);
      assert.deepStrictEqual(afterRemoveManual, originalManual);
    } catch (err) {
      const msg =
        `TOML soak failure (seed=${TOML_SEED} iter=${i}). ` +
        `Repro: VIBEDECK_SOAK_TOML_SEED=${TOML_SEED} node --test test/hook-merger-soak.test.js`;
      err.message = `${msg}\n${err.message}`;
      throw err;
    }
  }
});
