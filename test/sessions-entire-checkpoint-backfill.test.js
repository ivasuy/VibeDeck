const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const { ensureSchema } = require('../src/lib/db');
const { backfillEntireCheckpointLinks } = require('../src/lib/sessions/entire-checkpoint-backfill');

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vd-entire-backfill-'));
  const dbPath = path.join(dir, 'vibedeck.sqlite3');
  ensureSchema(dbPath);
  return { dir, dbPath };
}

function insertSession(db, row) {
  db.prepare(`
    INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, ended_at, end_reason, cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence, override_user, model, total_tokens, total_cost_usd,
      last_observed_at, cost_estimated, cost_quality, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.provider,
    row.session_id,
    row.started_at,
    row.ended_at ?? null,
    row.end_reason ?? null,
    row.cwd ?? null,
    row.repo_root ?? null,
    row.repo_common_dir ?? null,
    row.parent_repo ?? null,
    row.branch ?? null,
    row.branch_resolution_tier ?? 'B',
    row.confidence ?? 'high',
    row.override_user ?? null,
    row.model ?? null,
    row.total_tokens ?? 0,
    row.total_cost_usd ?? null,
    row.last_observed_at ?? row.started_at,
    row.cost_estimated ?? 0,
    row.cost_quality ?? 'stored',
    row.created_at ?? row.started_at,
    row.updated_at ?? row.ended_at ?? row.started_at,
  );
}

function baseMetadata(overrides = {}) {
  return {
    path: 'e2/abdc1ec6/metadata.json',
    kind: 'json',
    parsed: {
      checkpoint_id: 'e2abdc1ec6',
      entire_session_id: 'entire-session-1',
      agent: 'codex',
      model: 'gpt-5.5',
      branch: 'main',
      started_at: '2026-05-12T01:00:00.000Z',
      ended_at: '2026-05-12T01:05:00.000Z',
      ...overrides,
    },
  };
}

async function runBackfill(dbPath, metadata) {
  return backfillEntireCheckpointLinks({
    dbPath,
    repoRoot: '/repo',
    checkpointTip: null,
    listCheckpointsCached: async () => ({
      available: true,
      files: ['e2/abdc1ec6/metadata.json', 'e2/abdc1ec6/0/prompt.txt'],
    }),
    readCheckpoint: async () => metadata,
    now: () => new Date('2026-05-12T09:00:00.000Z'),
  });
}

async function runBackfillWithFiles(dbPath, metadata, files) {
  return backfillEntireCheckpointLinks({
    dbPath,
    repoRoot: '/repo',
    checkpointTip: null,
    listCheckpointsCached: async () => ({
      available: true,
      files,
    }),
    readCheckpoint: async () => metadata,
    now: () => new Date('2026-05-12T09:00:00.000Z'),
  });
}

test('backfill links a checkpoint to one exact repo/provider/model/branch/time session', async () => {
  const { dir, dbPath } = tmpDb();
  try {
    const db = new DatabaseSync(dbPath);
    insertSession(db, {
      provider: 'codex',
      session_id: 'sess-1',
      started_at: '2026-05-12T01:00:00.000Z',
      ended_at: '2026-05-12T01:06:00.000Z',
      repo_root: '/repo',
      repo_common_dir: '/repo/.git',
      branch: 'main',
      model: 'gpt-5.5',
      total_tokens: 100,
      total_cost_usd: 1.25,
      last_observed_at: '2026-05-12T01:06:00.000Z',
    });
    db.close();

    const result = await runBackfill(dbPath, baseMetadata());
    assert.equal(result.scanned, 1);
    assert.equal(result.linked, 1);
    assert.equal(result.ambiguous, 0);
    assert.equal(result.unmatched, 0);

    const readDb = new DatabaseSync(dbPath, { readOnly: true });
    const matchRow = readDb.prepare(`
      SELECT match_status, match_confidence, session_provider, session_id, reason, candidate_count
      FROM vibedeck_entire_checkpoint_matches
      WHERE repo_root = ? AND checkpoint_group_id = ?
    `).get('/repo', 'e2/abdc1ec6');
    assert.equal(matchRow.match_status, 'linked');
    assert.equal(matchRow.match_confidence, 'exact');
    assert.equal(matchRow.session_provider, 'codex');
    assert.equal(matchRow.session_id, 'sess-1');
    assert.equal(matchRow.reason, null);
    assert.equal(matchRow.candidate_count, 1);

    const linkRow = readDb.prepare(`
      SELECT provider, session_id, entire_session_id, match_confidence
      FROM vibedeck_session_entire_links
    `).get();
    assert.equal(linkRow.provider, 'codex');
    assert.equal(linkRow.session_id, 'sess-1');
    assert.equal(linkRow.entire_session_id, 'entire-session-1');
    assert.equal(linkRow.match_confidence, 'exact');
    readDb.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('backfill records ambiguous when two canonical sessions match the same checkpoint', async () => {
  const { dir, dbPath } = tmpDb();
  try {
    const db = new DatabaseSync(dbPath);
    insertSession(db, {
      provider: 'codex',
      session_id: 'sess-1',
      started_at: '2026-05-12T01:00:00.000Z',
      ended_at: '2026-05-12T01:06:00.000Z',
      repo_root: '/repo',
      branch: 'main',
      model: 'gpt-5.5',
      total_tokens: 100,
      total_cost_usd: 1.25,
      last_observed_at: '2026-05-12T01:06:00.000Z',
    });
    insertSession(db, {
      provider: 'codex',
      session_id: 'sess-2',
      started_at: '2026-05-12T01:01:00.000Z',
      ended_at: '2026-05-12T01:05:30.000Z',
      repo_root: '/repo',
      branch: 'main',
      model: 'gpt-5.5',
      total_tokens: 80,
      total_cost_usd: 0.75,
      last_observed_at: '2026-05-12T01:05:30.000Z',
    });
    db.close();

    const result = await runBackfill(dbPath, baseMetadata());
    assert.equal(result.linked, 0);
    assert.equal(result.ambiguous, 1);

    const readDb = new DatabaseSync(dbPath, { readOnly: true });
    const matchRow = readDb.prepare(`
      SELECT match_status, match_confidence, session_provider, session_id, reason, candidate_count
      FROM vibedeck_entire_checkpoint_matches
      WHERE repo_root = ? AND checkpoint_group_id = ?
    `).get('/repo', 'e2/abdc1ec6');
    assert.equal(matchRow.match_status, 'ambiguous');
    assert.equal(matchRow.match_confidence, 'ambiguous');
    assert.equal(matchRow.session_provider, null);
    assert.equal(matchRow.session_id, null);
    assert.equal(matchRow.reason, 'multiple_candidates');
    assert.equal(matchRow.candidate_count, 2);

    const linkCount = readDb.prepare('SELECT COUNT(*) AS count FROM vibedeck_session_entire_links').get().count;
    assert.equal(linkCount, 0);
    readDb.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('backfill records unmatched when no canonical session overlaps the checkpoint', async () => {
  const { dir, dbPath } = tmpDb();
  try {
    const db = new DatabaseSync(dbPath);
    insertSession(db, {
      provider: 'codex',
      session_id: 'sess-1',
      started_at: '2026-05-12T03:00:00.000Z',
      ended_at: '2026-05-12T03:05:00.000Z',
      repo_root: '/repo',
      branch: 'main',
      model: 'gpt-5.5',
      total_tokens: 100,
      total_cost_usd: 1.25,
      last_observed_at: '2026-05-12T03:05:00.000Z',
    });
    db.close();

    const result = await runBackfill(dbPath, baseMetadata());
    assert.equal(result.linked, 0);
    assert.equal(result.ambiguous, 0);
    assert.equal(result.unmatched, 1);

    const readDb = new DatabaseSync(dbPath, { readOnly: true });
    const matchRow = readDb.prepare(`
      SELECT match_status, match_confidence, session_provider, session_id, reason, candidate_count
      FROM vibedeck_entire_checkpoint_matches
      WHERE repo_root = ? AND checkpoint_group_id = ?
    `).get('/repo', 'e2/abdc1ec6');
    assert.equal(matchRow.match_status, 'unmatched');
    assert.equal(matchRow.match_confidence, 'unmatched');
    assert.equal(matchRow.session_provider, null);
    assert.equal(matchRow.session_id, null);
    assert.equal(matchRow.reason, 'no_matching_session');
    assert.equal(matchRow.candidate_count, 0);

    const linkCount = readDb.prepare('SELECT COUNT(*) AS count FROM vibedeck_session_entire_links').get().count;
    assert.equal(linkCount, 0);
    readDb.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('backfill does not create vibedeck_session_entire_links for ambiguous or unmatched checkpoints', async () => {
  const { dir, dbPath } = tmpDb();
  try {
    const db = new DatabaseSync(dbPath);
    insertSession(db, {
      provider: 'codex',
      session_id: 'sess-1',
      started_at: '2026-05-12T01:00:00.000Z',
      ended_at: '2026-05-12T01:06:00.000Z',
      repo_root: '/repo',
      branch: 'main',
      model: 'gpt-5.5',
      total_tokens: 100,
      total_cost_usd: 1.25,
      last_observed_at: '2026-05-12T01:06:00.000Z',
    });
    insertSession(db, {
      provider: 'codex',
      session_id: 'sess-2',
      started_at: '2026-05-12T01:01:00.000Z',
      ended_at: '2026-05-12T01:05:30.000Z',
      repo_root: '/repo',
      branch: 'main',
      model: 'gpt-5.5',
      total_tokens: 80,
      total_cost_usd: 0.75,
      last_observed_at: '2026-05-12T01:05:30.000Z',
    });
    db.close();

    await runBackfill(dbPath, baseMetadata());
    await runBackfill(dbPath, baseMetadata({ started_at: '2026-05-12T05:00:00.000Z', ended_at: '2026-05-12T05:03:00.000Z' }));

    const readDb = new DatabaseSync(dbPath, { readOnly: true });
    const linkCount = readDb.prepare('SELECT COUNT(*) AS count FROM vibedeck_session_entire_links').get().count;
    assert.equal(linkCount, 0);
    readDb.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('backfill links the only model match when branch metadata is missing', async () => {
  const { dir, dbPath } = tmpDb();
  try {
    const db = new DatabaseSync(dbPath);
    insertSession(db, {
      provider: 'codex',
      session_id: 'sess-model-1',
      started_at: '2026-05-12T01:00:00.000Z',
      ended_at: '2026-05-12T01:06:00.000Z',
      repo_root: '/repo',
      branch: 'feature',
      model: 'gpt-5.5',
    });
    insertSession(db, {
      provider: 'codex',
      session_id: 'sess-model-2',
      started_at: '2026-05-12T01:00:30.000Z',
      ended_at: '2026-05-12T01:06:30.000Z',
      repo_root: '/repo',
      branch: 'main',
      model: 'gpt-4.1',
    });
    db.close();

    const result = await runBackfill(dbPath, baseMetadata({ branch: '' }));
    assert.equal(result.linked, 1);

    const readDb = new DatabaseSync(dbPath, { readOnly: true });
    const matchRow = readDb.prepare(`
      SELECT match_status, match_confidence, session_id, candidate_count
      FROM vibedeck_entire_checkpoint_matches
      WHERE repo_root = ? AND checkpoint_group_id = ?
    `).get('/repo', 'e2/abdc1ec6');
    assert.equal(matchRow.match_status, 'linked');
    assert.equal(matchRow.match_confidence, 'overlap');
    assert.equal(matchRow.session_id, 'sess-model-1');
    assert.equal(matchRow.candidate_count, 1);

    const linkRow = readDb.prepare(`
      SELECT provider, session_id, match_confidence
      FROM vibedeck_session_entire_links
      WHERE provider = ? AND session_id = ?
    `).get('codex', 'sess-model-1');
    assert.equal(linkRow.provider, 'codex');
    assert.equal(linkRow.session_id, 'sess-model-1');
    assert.equal(linkRow.match_confidence, 'overlap');
    readDb.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('backfill links the only branch match when model metadata is missing', async () => {
  const { dir, dbPath } = tmpDb();
  try {
    const db = new DatabaseSync(dbPath);
    insertSession(db, {
      provider: 'codex',
      session_id: 'sess-branch-1',
      started_at: '2026-05-12T01:00:00.000Z',
      ended_at: '2026-05-12T01:06:00.000Z',
      repo_root: '/repo',
      branch: 'main',
      model: 'gpt-4.1',
    });
    insertSession(db, {
      provider: 'codex',
      session_id: 'sess-branch-2',
      started_at: '2026-05-12T01:00:30.000Z',
      ended_at: '2026-05-12T01:06:30.000Z',
      repo_root: '/repo',
      branch: 'feature',
      model: 'gpt-4.1',
    });
    db.close();

    const result = await runBackfill(dbPath, baseMetadata({ model: '' }));
    assert.equal(result.linked, 1);

    const readDb = new DatabaseSync(dbPath, { readOnly: true });
    const matchRow = readDb.prepare(`
      SELECT match_status, match_confidence, session_id, candidate_count
      FROM vibedeck_entire_checkpoint_matches
      WHERE repo_root = ? AND checkpoint_group_id = ?
    `).get('/repo', 'e2/abdc1ec6');
    assert.equal(matchRow.match_status, 'linked');
    assert.equal(matchRow.match_confidence, 'overlap');
    assert.equal(matchRow.session_id, 'sess-branch-1');
    assert.equal(matchRow.candidate_count, 1);
    readDb.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('backfill skips groups without metadata json', async () => {
  const { dir, dbPath } = tmpDb();
  try {
    const result = await runBackfillWithFiles(
      dbPath,
      baseMetadata(),
      ['e2/abdc1ec6/payload.json', 'e2/abdc1ec6/0/prompt.txt'],
    );
    assert.equal(result.scanned, 0);
    assert.equal(result.skipped, 1);

    const readDb = new DatabaseSync(dbPath, { readOnly: true });
    const count = readDb.prepare('SELECT COUNT(*) AS count FROM vibedeck_entire_checkpoint_matches').get().count;
    assert.equal(count, 0);
    readDb.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('backfill records unmatched when strict metadata filters leave no candidate', async () => {
  const { dir, dbPath } = tmpDb();
  try {
    const db = new DatabaseSync(dbPath);
    insertSession(db, {
      provider: 'codex',
      session_id: 'sess-mismatch-1',
      started_at: '2026-05-12T01:00:00.000Z',
      ended_at: '2026-05-12T01:06:00.000Z',
      repo_root: '/repo',
      branch: 'dev',
      model: 'gpt-4.1',
    });
    db.close();

    const result = await runBackfill(dbPath, baseMetadata({ branch: 'main', model: 'gpt-5.5' }));
    assert.equal(result.unmatched, 1);
    assert.equal(result.linked, 0);
    assert.equal(result.ambiguous, 0);

    const readDb = new DatabaseSync(dbPath, { readOnly: true });
    const matchRow = readDb.prepare(`
      SELECT match_status, match_confidence, reason, candidate_count
      FROM vibedeck_entire_checkpoint_matches
      WHERE repo_root = ? AND checkpoint_group_id = ?
    `).get('/repo', 'e2/abdc1ec6');
    assert.equal(matchRow.match_status, 'unmatched');
    assert.equal(matchRow.match_confidence, 'unmatched');
    assert.equal(matchRow.candidate_count, 0);
    assert.ok(['no_matching_session', 'no_strict_match'].includes(matchRow.reason));

    const links = readDb.prepare('SELECT COUNT(*) AS count FROM vibedeck_session_entire_links').get().count;
    assert.equal(links, 0);
    readDb.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('backfill links by metadata runtime session_id when timestamps are missing', async () => {
  const { dir, dbPath } = tmpDb();
  try {
    const runtimeId = '019e14a6-ea73-7c02-9101-d9169718424b';
    const db = new DatabaseSync(dbPath);
    insertSession(db, {
      provider: 'codex',
      session_id: `/Users/dev/.codex/sessions/2026/05/11/rollout-foo-${runtimeId}.jsonl`,
      started_at: '2026-05-11T04:30:00.000Z',
      ended_at: '2026-05-11T04:40:00.000Z',
      repo_root: '/repo',
      branch: 'publish-main',
      model: 'gpt-5.5',
      total_tokens: 1200,
      total_cost_usd: 2.4,
    });
    db.close();

    const metadata = baseMetadata({
      checkpoint_id: '06e2abdc1ec6',
      started_at: '',
      ended_at: '',
      branch: 'publish-main',
      model: 'gpt-5.5',
      session_id: runtimeId,
    });
    const result = await runBackfill(dbPath, metadata);
    assert.equal(result.scanned, 1);
    assert.equal(result.linked, 1);
    assert.equal(result.ambiguous, 0);
    assert.equal(result.unmatched, 0);

    const readDb = new DatabaseSync(dbPath, { readOnly: true });
    const matchRow = readDb.prepare(`
      SELECT match_status, match_confidence, session_provider, session_id, reason, candidate_count
      FROM vibedeck_entire_checkpoint_matches
      WHERE repo_root = ? AND checkpoint_group_id = ?
    `).get('/repo', 'e2/abdc1ec6');
    assert.equal(matchRow.match_status, 'linked');
    assert.equal(matchRow.match_confidence, 'exact');
    assert.equal(matchRow.session_provider, 'codex');
    assert.equal(matchRow.session_id.includes(runtimeId), true);
    assert.equal(matchRow.reason, null);
    assert.equal(matchRow.candidate_count, 1);

    const linkRow = readDb.prepare(`
      SELECT provider, session_id, entire_session_id, match_confidence
      FROM vibedeck_session_entire_links
    `).get();
    assert.equal(linkRow.provider, 'codex');
    assert.equal(linkRow.session_id.includes(runtimeId), true);
    assert.equal(linkRow.entire_session_id, 'entire-session-1');
    assert.equal(linkRow.match_confidence, 'exact');
    readDb.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
