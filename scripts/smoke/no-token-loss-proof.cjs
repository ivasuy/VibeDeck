#!/usr/bin/env node
'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const { resolveTrackerPaths } = require('../../src/lib/tracker-paths');
const {
  collectRolloutSourceDeltas,
  listRolloutFiles,
} = require('../../src/lib/rollout');
const {
  cmdSync,
  readCanonicalNoTokenLossDeltas,
} = require('../../src/commands/sync');

const PROVIDERS = ['codex', 'every-code'];
const COMPARED_FIELDS = [
  'session_count',
  'event_count',
  'total_tokens',
  'input_tokens',
  'cached_input_tokens',
  'cache_creation_input_tokens',
  'output_tokens',
  'reasoning_output_tokens',
  'conversation_count',
  'session_total_tokens',
];
const SESSION_COMPARED_FIELDS = [
  'event_count',
  'total_tokens',
  'input_tokens',
  'cached_input_tokens',
  'cache_creation_input_tokens',
  'output_tokens',
  'reasoning_output_tokens',
  'conversation_count',
  'session_total_tokens',
];
const EVENT_COMPARED_FIELDS = [
  'delta_tokens',
  'input_tokens',
  'cached_input_tokens',
  'cache_creation_input_tokens',
  'output_tokens',
  'reasoning_output_tokens',
  'conversation_count',
  'total_tokens',
];

function zeroProvider(provider) {
  return {
    provider,
    file_count: 0,
    session_count: 0,
    event_count: 0,
    session_total_tokens: 0,
    first_observed_at: null,
    last_observed_at: null,
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
    billable_total_tokens: 0,
    conversation_count: 0,
    sessions: [],
  };
}

function normalizeProvider(value) {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : null;
}

function normalizeProviders(providers) {
  const list = Array.isArray(providers) && providers.length > 0 ? providers : PROVIDERS;
  return Array.from(new Set(list.map(normalizeProvider).filter(Boolean))).sort();
}

function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function normalizeSummary(raw, provider) {
  const base = zeroProvider(provider);
  const input = raw && typeof raw === 'object' ? raw : {};
  for (const key of Object.keys(base)) {
    if (key === 'provider') continue;
    if (key === 'sessions') {
      base.sessions = Array.isArray(input.sessions) ? input.sessions.map(normalizeSession).sort(sortSession) : [];
      continue;
    }
    if (key === 'first_observed_at' || key === 'last_observed_at') {
      base[key] = typeof input[key] === 'string' && input[key].trim() ? input[key].trim() : null;
      continue;
    }
    base[key] = toNumber(input[key]);
  }
  return base;
}

function zeroSession(sessionId) {
  return {
    session_id: sessionId,
    event_count: 0,
    session_total_tokens: 0,
    first_observed_at: null,
    last_observed_at: null,
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
    billable_total_tokens: 0,
    conversation_count: 0,
    events: [],
  };
}

function normalizeSession(raw) {
  const sessionId = typeof raw?.session_id === 'string' ? raw.session_id : '';
  const base = zeroSession(sessionId);
  const input = raw && typeof raw === 'object' ? raw : {};
  for (const key of Object.keys(base)) {
    if (key === 'session_id') continue;
    if (key === 'events') {
      base.events = Array.isArray(input.events) ? input.events.map(normalizeEvent).sort(sortEvent) : [];
      continue;
    }
    if (key === 'first_observed_at' || key === 'last_observed_at') {
      base[key] = typeof input[key] === 'string' && input[key].trim() ? input[key].trim() : null;
      continue;
    }
    base[key] = toNumber(input[key]);
  }
  return base;
}

function normalizeEvent(raw) {
  return {
    event_key: typeof raw?.event_key === 'string' ? raw.event_key : '',
    kind: typeof raw?.kind === 'string' ? raw.kind : 'update',
    observed_at: typeof raw?.observed_at === 'string' ? raw.observed_at : null,
    delta_tokens: toNumber(raw?.delta_tokens),
    input_tokens: toNumber(raw?.input_tokens),
    cached_input_tokens: toNumber(raw?.cached_input_tokens),
    cache_creation_input_tokens: toNumber(raw?.cache_creation_input_tokens),
    output_tokens: toNumber(raw?.output_tokens),
    reasoning_output_tokens: toNumber(raw?.reasoning_output_tokens),
    conversation_count: toNumber(raw?.conversation_count),
    total_tokens: toNumber(raw?.total_tokens),
  };
}

function sortSession(a, b) {
  return a.session_id.localeCompare(b.session_id);
}

function sortEvent(a, b) {
  return a.event_key.localeCompare(b.event_key);
}

function indexByProvider(rows, providers) {
  const out = new Map(providers.map((provider) => [provider, zeroProvider(provider)]));
  for (const row of Array.isArray(rows) ? rows : []) {
    const provider = normalizeProvider(row && row.provider);
    if (!provider) continue;
    out.set(provider, normalizeSummary(row, provider));
  }
  return out;
}

function compareProvider(provider, source, canonical) {
  const mismatches = [];
  for (const field of COMPARED_FIELDS) {
    const sourceValue = toNumber(source[field]);
    const canonicalValue = toNumber(canonical[field]);
    if (sourceValue === canonicalValue) continue;
    mismatches.push({
      provider,
      field,
      source: sourceValue,
      canonical: canonicalValue,
      delta: canonicalValue - sourceValue,
    });
  }
  const sessionMismatches = compareSessions(provider, source.sessions, canonical.sessions);
  const eventMismatches = compareEvents(provider, source.sessions, canonical.sessions);
  return {
    provider,
    match: mismatches.length === 0 && sessionMismatches.length === 0 && eventMismatches.length === 0,
    source,
    canonical,
    mismatches,
    session_mismatches: sessionMismatches,
    event_mismatches: eventMismatches,
  };
}

function compareSessions(provider, sourceSessions, canonicalSessions) {
  const mismatches = [];
  const sourceById = new Map((Array.isArray(sourceSessions) ? sourceSessions : []).map((s) => [s.session_id, s]));
  const canonicalById = new Map((Array.isArray(canonicalSessions) ? canonicalSessions : []).map((s) => [s.session_id, s]));
  const sessionIds = Array.from(new Set([...sourceById.keys(), ...canonicalById.keys()])).sort();
  for (const sessionId of sessionIds) {
    const source = sourceById.get(sessionId) || zeroSession(sessionId);
    const canonical = canonicalById.get(sessionId) || zeroSession(sessionId);
    for (const field of SESSION_COMPARED_FIELDS) {
      const sourceValue = toNumber(source[field]);
      const canonicalValue = toNumber(canonical[field]);
      if (sourceValue === canonicalValue) continue;
      mismatches.push({
        provider,
        session_id: sessionId,
        field,
        source: sourceValue,
        canonical: canonicalValue,
        delta: canonicalValue - sourceValue,
      });
    }
  }
  return mismatches;
}

function compareEvents(provider, sourceSessions, canonicalSessions) {
  const mismatches = [];
  const sourceById = new Map((Array.isArray(sourceSessions) ? sourceSessions : []).map((s) => [s.session_id, s]));
  const canonicalById = new Map((Array.isArray(canonicalSessions) ? canonicalSessions : []).map((s) => [s.session_id, s]));
  const sessionIds = Array.from(new Set([...sourceById.keys(), ...canonicalById.keys()])).sort();
  for (const sessionId of sessionIds) {
    const sourceEvents = new Map(((sourceById.get(sessionId) || zeroSession(sessionId)).events || []).map((e) => [e.event_key, e]));
    const canonicalEvents = new Map(((canonicalById.get(sessionId) || zeroSession(sessionId)).events || []).map((e) => [e.event_key, e]));
    const eventKeys = Array.from(new Set([...sourceEvents.keys(), ...canonicalEvents.keys()])).sort();
    for (const eventKey of eventKeys) {
      const source = sourceEvents.get(eventKey);
      const canonical = canonicalEvents.get(eventKey);
      if (!source || !canonical) {
        mismatches.push({
          provider,
          session_id: sessionId,
          event_key: eventKey,
          field: source ? 'missing_canonical_event' : 'missing_source_event',
          source: source ? 1 : 0,
          canonical: canonical ? 1 : 0,
          delta: (canonical ? 1 : 0) - (source ? 1 : 0),
        });
        continue;
      }
      for (const field of EVENT_COMPARED_FIELDS) {
        const sourceValue = toNumber(source[field]);
        const canonicalValue = toNumber(canonical[field]);
        if (sourceValue === canonicalValue) continue;
        mismatches.push({
          provider,
          session_id: sessionId,
          event_key: eventKey,
          field,
          source: sourceValue,
          canonical: canonicalValue,
          delta: canonicalValue - sourceValue,
        });
      }
    }
  }
  return mismatches;
}

function addSummaryTotals(target, source, prefix) {
  target[`${prefix}_total_tokens`] += toNumber(source.total_tokens);
  target[`${prefix}_event_count`] += toNumber(source.event_count);
}

async function resolveProviderFiles({ home, env = process.env, providers = PROVIDERS } = {}) {
  const providerList = normalizeProviders(providers);
  const codexHome = env.CODEX_HOME || path.join(home || process.env.HOME || '', '.codex');
  const everyCodeHome = env.CODE_HOME || path.join(home || process.env.HOME || '', '.code');
  const files = [];

  if (providerList.includes('codex')) {
    for (const filePath of await listRolloutFiles(path.join(codexHome, 'sessions'))) {
      files.push({ source: 'codex', path: filePath });
    }
  }
  if (providerList.includes('every-code')) {
    for (const filePath of await listRolloutFiles(path.join(everyCodeHome, 'sessions'))) {
      files.push({ source: 'every-code', path: filePath });
    }
  }

  return files.sort((a, b) => a.source.localeCompare(b.source) || a.path.localeCompare(b.path));
}

async function buildNoTokenLossProof({
  home = process.env.VIBEDECK_HOME || process.env.HOME,
  trackerDir = null,
  dbPath = null,
  generatedAt = new Date().toISOString(),
  providers = PROVIDERS,
  env = process.env,
} = {}) {
  if (typeof collectRolloutSourceDeltas !== 'function') {
    return {
      version: 1,
      status: 'uncovered',
      reason: 'missing_collect_rollout_source_deltas_api',
      generated_at: generatedAt,
      tracker_dir: trackerDir || null,
      db_path: dbPath || null,
      providers: [],
      summary: {
        provider_count: 0,
        mismatch_count: 0,
        session_mismatch_count: 0,
        event_mismatch_count: 0,
        source_total_tokens: 0,
        canonical_total_tokens: 0,
        source_event_count: 0,
        canonical_event_count: 0,
      },
    };
  }
  const providerList = normalizeProviders(providers);
  const paths = trackerDir ? { trackerDir } : await resolveTrackerPaths({ home });
  const resolvedTrackerDir = trackerDir || paths.trackerDir;
  const resolvedDbPath = dbPath || path.join(resolvedTrackerDir, 'vibedeck.sqlite3');
  const providerFiles = await resolveProviderFiles({ home, env, providers: providerList });
  const sourceRows = await collectRolloutSourceDeltas({ providerFiles });
  const canonicalRows = readCanonicalNoTokenLossDeltas(resolvedDbPath, { providers: providerList });
  const sourceByProvider = indexByProvider(sourceRows, providerList);
  const canonicalByProvider = indexByProvider(canonicalRows, providerList);
  const proofProviders = providerList.map((provider) =>
    compareProvider(provider, sourceByProvider.get(provider), canonicalByProvider.get(provider)),
  );
  const summary = {
    provider_count: proofProviders.length,
    mismatch_count: proofProviders.reduce((sum, entry) => sum + entry.mismatches.length, 0),
    session_mismatch_count: proofProviders.reduce((sum, entry) => sum + entry.session_mismatches.length, 0),
    event_mismatch_count: proofProviders.reduce((sum, entry) => sum + entry.event_mismatches.length, 0),
    source_total_tokens: 0,
    canonical_total_tokens: 0,
    source_event_count: 0,
    canonical_event_count: 0,
  };
  for (const entry of proofProviders) {
    addSummaryTotals(summary, entry.source, 'source');
    addSummaryTotals(summary, entry.canonical, 'canonical');
  }

  return {
    version: 1,
    status: summary.mismatch_count === 0 && summary.session_mismatch_count === 0 && summary.event_mismatch_count === 0 ? 'pass' : 'fail',
    generated_at: generatedAt,
    tracker_dir: resolvedTrackerDir,
    db_path: resolvedDbPath,
    providers: proofProviders,
    summary,
  };
}

function buildHomeEnv(home, baseEnv = process.env) {
  return {
    HOME: home,
    VIBEDECK_HOME: home,
    CODEX_HOME: path.join(home, '.codex'),
    CODE_HOME: path.join(home, '.code'),
    GEMINI_HOME: path.join(home, '.gemini'),
    OPENCODE_HOME: path.join(home, '.opencode'),
    ...Object.fromEntries(
      Object.entries(baseEnv).filter(([key]) => ![
        'HOME',
        'VIBEDECK_HOME',
        'CODEX_HOME',
        'CODE_HOME',
        'GEMINI_HOME',
        'OPENCODE_HOME',
      ].includes(key)),
    ),
  };
}

async function withProcessEnv(patch, fn) {
  const previous = {};
  for (const key of Object.keys(patch)) {
    previous[key] = process.env[key];
    process.env[key] = patch[key];
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(patch)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

async function writeNoTokenLossProofArtifact({ outputPath, proof } = {}) {
  if (!outputPath || typeof outputPath !== 'string') {
    throw new TypeError('outputPath is required');
  }
  if (!proof || typeof proof !== 'object') {
    throw new TypeError('proof is required');
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8');
  return proof;
}

function parseArgs(argv) {
  const out = {
    outputPath: null,
    home: null,
    skipSync: false,
    providers: PROVIDERS,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--output') out.outputPath = argv[++i] || null;
    else if (arg === '--home') out.home = argv[++i] || null;
    else if (arg === '--provider') out.providers = [argv[++i]].filter(Boolean);
    else if (arg === '--providers') out.providers = String(argv[++i] || '').split(',').map((v) => v.trim()).filter(Boolean);
    else if (arg === '--no-sync') out.skipSync = true;
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function printHelp() {
  process.stdout.write(`Usage: node scripts/smoke/no-token-loss-proof.cjs [--output path] [--home path] [--no-sync] [--providers codex,every-code]\n`);
}

async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    printHelp();
    return 0;
  }
  const home = opts.home || process.env.VIBEDECK_HOME || process.env.HOME;
  const proofEnv = opts.home ? buildHomeEnv(home) : process.env;
  const { trackerDir } = await resolveTrackerPaths({ home });
  const outputPath = opts.outputPath || path.join(trackerDir, 'diagnostics', 'no-token-loss-proof.json');

  if (!opts.skipSync) {
    if (opts.home) {
      await withProcessEnv(proofEnv, () => cmdSync(['--auto', '--rebuild-vibedeck-db']));
    } else {
      await cmdSync(['--auto', '--rebuild-vibedeck-db']);
    }
  }

  const proof = await buildNoTokenLossProof({
    home,
    trackerDir,
    providers: opts.providers,
    env: proofEnv,
  });
  await writeNoTokenLossProofArtifact({ outputPath, proof });
  process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
  if (proof.status === 'uncovered') return 2;
  return proof.status === 'pass' ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildNoTokenLossProof,
  writeNoTokenLossProofArtifact,
  resolveProviderFiles,
  main,
};
