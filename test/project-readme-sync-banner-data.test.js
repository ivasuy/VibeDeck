const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const test = require('node:test');

const { buildProjectReadmeBannerData } = require('../src/lib/project-readme-sync/banner-data');
const { formatUsd } = require('../src/lib/readme-sync/banner-data');
const { resolveUsageCost } = require('../src/lib/cost-estimation');
const { ensureSchema } = require('../src/lib/db');

function createTempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vibedeck-project-readme-banner-'));
}

function openProjectDb(home) {
  const dbPath = path.join(home, '.vibedeck', 'tracker', 'vibedeck.sqlite3');
  ensureSchema(dbPath);
  return { dbPath, db: new DatabaseSync(dbPath) };
}

function insertSession(db, row) {
  db.prepare(
    `
    INSERT INTO vibedeck_sessions (
      provider,
      session_id,
      started_at,
      ended_at,
      end_reason,
      cwd,
      repo_root,
      repo_common_dir,
      parent_repo,
      branch,
      branch_resolution_tier,
      confidence,
      override_user,
      model,
      input_tokens,
      cached_input_tokens,
      cache_creation_input_tokens,
      output_tokens,
      reasoning_output_tokens,
      total_tokens,
      cost_estimated,
      total_cost_usd,
      created_at,
      updated_at
    ) VALUES (
      @provider,
      @session_id,
      @started_at,
      @ended_at,
      NULL,
      @cwd,
      @repo_root,
      NULL,
      NULL,
      @branch,
      @branch_resolution_tier,
      @confidence,
      NULL,
      @model,
      @input_tokens,
      @cached_input_tokens,
      @cache_creation_input_tokens,
      @output_tokens,
      @reasoning_output_tokens,
      @total_tokens,
      @cost_estimated,
      @total_cost_usd,
      @created_at,
      @updated_at
    )
  `,
  ).run({
    branch: 'main',
    branch_resolution_tier: 'A',
    confidence: 'high',
    input_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    cost_estimated: 0,
    total_cost_usd: null,
    ...row,
  });
}

test('buildProjectReadmeBannerData aggregates totals and per-model split for current path', async () => {
  const home = createTempHome();
  const cwd = path.join(home, 'repo');
  const now = new Date('2026-06-14T12:00:00.000Z');

  const { db, dbPath } = openProjectDb(home);
  fs.mkdirSync(cwd, { recursive: true });

  try {
    insertSession(db, {
      provider: 'codex',
      session_id: 's1',
      started_at: '2026-06-12T09:00:00.000Z',
      ended_at: '2026-06-12T10:00:00.000Z',
      cwd,
      repo_root: cwd,
      model: 'claude-opus-4',
      input_tokens: 800,
      output_tokens: 200,
      total_tokens: 1000,
      total_cost_usd: 12,
      created_at: '2026-06-12T09:00:00.000Z',
      updated_at: '2026-06-12T09:00:00.000Z',
    });
    insertSession(db, {
      provider: 'codex',
      session_id: 's2',
      started_at: '2026-06-13T14:00:00.000Z',
      ended_at: '2026-06-13T14:20:00.000Z',
      cwd: path.join(home, 'other'),
      repo_root: cwd,
      model: 'gpt-5',
      input_tokens: 600,
      output_tokens: 400,
      total_tokens: 1000,
      total_cost_usd: 3,
      created_at: '2026-06-13T14:00:00.000Z',
      updated_at: '2026-06-13T14:20:00.000Z',
    });
    insertSession(db, {
      provider: 'codex',
      session_id: 's3',
      started_at: '2026-06-14T16:00:00.000Z',
      ended_at: '2026-06-14T16:30:00.000Z',
      cwd,
      repo_root: path.join(home, 'something-else'),
      model: 'claude-4',
      input_tokens: 200,
      output_tokens: 100,
      total_tokens: 300,
      total_cost_usd: 4,
      created_at: '2026-06-14T16:00:00.000Z',
      updated_at: '2026-06-14T16:30:00.000Z',
    });
    insertSession(db, {
      provider: 'codex',
      session_id: 's4',
      started_at: '2026-06-11T11:00:00.000Z',
      ended_at: '2026-06-11T12:00:00.000Z',
      cwd: path.join(home, 'outside'),
      repo_root: path.join(home, 'outside'),
      model: 'other-model',
      input_tokens: 999,
      output_tokens: 999,
      total_tokens: 1998,
      total_cost_usd: 99,
      created_at: '2026-06-11T11:00:00.000Z',
      updated_at: '2026-06-11T12:00:00.000Z',
    });

    const payload = await buildProjectReadmeBannerData({ home, cwd, now });

    assert.equal(payload.projectLabel, 'repo');
    assert.equal(payload.updatedDateLabel, 'June 14, 2026');
    assert.equal(payload.totalTokensLabel, '2.3K');
    assert.equal(payload.totalTokensSubLabel, '2,300 tokens total');
    assert.equal(payload.totalCostLabel, '$19');
    assert.equal(payload.activeDaysLabel, '3');
    assert.equal(payload.inputTokensLabel, '1.6K');
    assert.equal(payload.outputTokensLabel, '700');
    assert.equal(Array.isArray(payload.topModels), true);
    assert.equal(payload.topModels.length, 3);
    assert.equal(payload.topModels[0].name, 'claude-opus-4');
    assert.equal(payload.topModels[0].valueLabel, '1K');
    assert.equal(payload.topModels[0].percentLabel, '43%');
    assert.equal(payload.topModels[1].name, 'gpt-5');
    assert.equal(payload.topModels[1].percentLabel, '43%');
    assert.equal(payload.topModels[2].name, 'claude-4');
    assert.equal(payload.topModels[2].percentLabel, '13%');
  } finally {
    db.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('buildProjectReadmeBannerData keeps rows only when repo_root or cwd matches exact cwd', async () => {
  const home = createTempHome();
  const cwd = path.join(home, 'matched');
  const target = path.join(home, 'matched');

  const { db } = openProjectDb(home);

  try {
    fs.mkdirSync(cwd, { recursive: true });

    insertSession(db, {
      provider: 'codex',
      session_id: 's1',
      started_at: '2026-06-10T10:00:00.000Z',
      ended_at: '2026-06-10T10:10:00.000Z',
      cwd: target,
      repo_root: path.join(home, 'other'),
      model: 'exact-by-cwd',
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
      total_cost_usd: 5,
      created_at: '2026-06-10T10:00:00.000Z',
      updated_at: '2026-06-10T10:10:00.000Z',
    });
    insertSession(db, {
      provider: 'codex',
      session_id: 's2',
      started_at: '2026-06-10T11:00:00.000Z',
      ended_at: '2026-06-10T11:10:00.000Z',
      cwd: path.join(home, 'other-cwd'),
      repo_root: target,
      model: 'exact-by-repo',
      input_tokens: 20,
      output_tokens: 10,
      total_tokens: 30,
      total_cost_usd: 15,
      created_at: '2026-06-10T11:00:00.000Z',
      updated_at: '2026-06-10T11:10:00.000Z',
    });
    insertSession(db, {
      provider: 'codex',
      session_id: 's3',
      started_at: '2026-06-10T12:00:00.000Z',
      ended_at: '2026-06-10T12:10:00.000Z',
      cwd: path.join(home, 'other-cwd'),
      repo_root: path.join(home, 'other-root'),
      model: 'excluded',
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
      total_cost_usd: 12,
      created_at: '2026-06-10T12:00:00.000Z',
      updated_at: '2026-06-10T12:10:00.000Z',
    });

    const payload = await buildProjectReadmeBannerData({ home, cwd: target });

    assert.equal(payload.totalTokensLabel, '45');
    assert.equal(payload.totalCostLabel, '$20');
    assert.equal(payload.inputTokensLabel, '30');
    assert.equal(payload.outputTokensLabel, '15');
    assert.equal(payload.topModels.length, 2);
    const names = payload.topModels.map((row) => row.name).sort();
    assert.equal(names.join(','), 'exact-by-cwd,exact-by-repo');
    assert.equal(payload.topModels[0].percentLabel, '67%');
    assert.equal(payload.topModels[1].percentLabel, '33%');
  } finally {
    db.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('buildProjectReadmeBannerData resolves estimated cost when stored cost is non-authoritative', async () => {
  const home = createTempHome();
  const cwd = path.join(home, 'billing');

  const { db } = openProjectDb(home);
  fs.mkdirSync(cwd, { recursive: true });

  const rawRow = {
    provider: 'codex',
    session_id: 's1',
    started_at: '2026-06-10T10:00:00.000Z',
    ended_at: '2026-06-10T10:10:00.000Z',
    cwd,
    repo_root: cwd,
    model: 'gpt-4o-mini',
    input_tokens: 2_000_000,
    output_tokens: 0,
    total_tokens: 2_000_000,
    total_cost_usd: null,
    cost_estimated: 1,
    created_at: '2026-06-10T10:00:00.000Z',
    updated_at: '2026-06-10T10:10:00.000Z',
  };

  const resolvedCost = resolveUsageCost({
    source: rawRow.provider,
    model: rawRow.model,
    total_tokens: rawRow.total_tokens,
    input_tokens: rawRow.input_tokens,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    output_tokens: rawRow.output_tokens,
    reasoning_output_tokens: 0,
    stored_cost_usd: rawRow.total_cost_usd,
    stored_cost_is_authoritative: rawRow.cost_estimated !== 0,
  });

  try {
    insertSession(db, rawRow);

    const data = await buildProjectReadmeBannerData({ home, cwd });

    assert.ok(resolvedCost.total_cost_usd != null);
    assert.equal(
      data.totalCostLabel,
      formatUsd(resolvedCost.total_cost_usd),
    );
  } finally {
    db.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('buildProjectReadmeBannerData returns zero-state when no matching rows exist', async () => {
  const home = createTempHome();
  const cwd = path.join(home, 'empty');

  const { db } = openProjectDb(home);
  try {
    const data = await buildProjectReadmeBannerData({
    home,
    cwd,
    now: new Date('2026-06-14T12:00:00.000Z'),
  });

    assert.equal(data.projectLabel, 'empty');
    assert.equal(data.updatedDateLabel, 'June 14, 2026');
    assert.equal(data.totalTokensLabel, '0');
    assert.equal(data.totalTokensSubLabel, '0 tokens total');
    assert.equal(data.totalCostLabel, '$0');
    assert.equal(data.activeDaysLabel, '0');
    assert.equal(data.inputTokensLabel, '0');
    assert.equal(data.outputTokensLabel, '0');
    assert.deepEqual(data.topModels, []);
  } finally {
    db.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
