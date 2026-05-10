const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");

const { ensureSchema } = require("../src/lib/db");
const { createLocalApiHandler } = require("../src/lib/local-api");

async function writeJsonLines(filePath, rows) {
  await fs.promises.writeFile(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf8",
  );
}

async function callEndpoint(queuePath, endpoint) {
  const handler = createLocalApiHandler({ queuePath });
  const url = new URL(`http://localhost${endpoint}`);
  const req = {
    method: "GET",
    url: url.pathname + url.search,
    headers: { host: "localhost" },
  };
  const chunks = [];
  const res = {
    statusCode: 200,
    setHeader() {},
    writeHead() {},
    write(chunk) {
      chunks.push(chunk);
    },
    end(body) {
      if (body) chunks.push(body);
    },
  };
  const handled = await handler(req, res, url);
  assert.ok(handled, `endpoint must be handled: ${endpoint}`);
  return JSON.parse(chunks.join(""));
}

function insertSession(db, row) {
  db.prepare(`
    INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence, override_user,
      model, total_tokens, total_cost_usd, created_at, updated_at
    ) VALUES (
      @provider, @session_id, @started_at, @ended_at, NULL,
      @cwd, @repo_root, NULL, NULL,
      NULL, @branch_resolution_tier, @confidence, NULL,
      @model, @total_tokens, @total_cost_usd, @created_at, @updated_at
    )
  `).run({
    total_cost_usd: null,
    created_at: row.started_at,
    updated_at: row.started_at,
    ...row,
  });
}

test("vibedeck project usage alias matches the legacy response shape", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vibedeck-project-usage-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const projectQueuePath = path.join(tmp, "project.queue.jsonl");

    await writeJsonLines(queuePath, []);
    await writeJsonLines(projectQueuePath, [
      {
        project_key: "acme/alpha",
        project_ref: "https://github.com/acme/alpha",
        source: "codex",
        hour_start: "2026-05-03T12:00:00.000Z",
        total_tokens: 100,
        billable_total_tokens: 100,
      },
    ]);

    const legacy = await callEndpoint(queuePath, "/functions/tokentracker-project-usage-summary");
    const alias = await callEndpoint(queuePath, "/functions/vibedeck-project-usage-summary");

    assert.deepEqual(Object.keys(alias).sort(), Object.keys(legacy).sort());
    assert.deepEqual(alias.entries, legacy.entries);
    assert.deepEqual(
      Object.keys(alias.entries[0] || {}).sort(),
      Object.keys(legacy.entries[0] || {}).sort(),
    );
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("project usage supports recent sorting, limit, and last_seen_at metadata", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vibedeck-project-usage-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const projectQueuePath = path.join(tmp, "project.queue.jsonl");

    await writeJsonLines(queuePath, []);
    await writeJsonLines(projectQueuePath, [
      {
        project_key: "acme/alpha",
        project_ref: "https://github.com/acme/alpha",
        source: "codex",
        hour_start: "2026-05-01T09:00:00.000Z",
        total_tokens: 90,
        billable_total_tokens: 90,
      },
      {
        project_key: "acme/alpha",
        project_ref: "https://github.com/acme/alpha",
        source: "codex",
        hour_start: "2026-05-03T12:00:00.000Z",
        total_tokens: 10,
        billable_total_tokens: 10,
      },
      {
        project_key: "acme/beta",
        project_ref: "https://github.com/acme/beta",
        source: "codex",
        hour_start: "2026-05-02T11:00:00.000Z",
        timestamp: "2026-05-10T11:45:00.000Z",
        total_tokens: 60,
        billable_total_tokens: 60,
      },
      {
        project_key: "acme/gamma",
        project_ref: "https://github.com/acme/gamma",
        source: "codex",
        hour_start: "2026-05-09T08:00:00.000Z",
        total_tokens: 50,
        billable_total_tokens: 50,
      },
    ]);

    const body = await callEndpoint(
      queuePath,
      "/functions/vibedeck-project-usage-summary?sort=recent&limit=2",
    );

    assert.equal(body.entries.length, 2);
    assert.deepEqual(
      body.entries.map((entry) => entry.project_key),
      ["acme/beta", "acme/gamma"],
    );
    assert.equal(body.entries[0].last_seen_at, "2026-05-10T11:45:00.000Z");
    assert.equal(body.entries[1].last_seen_at, "2026-05-09T08:00:00.000Z");
    for (const entry of body.entries) {
      assert.ok(entry.last_seen_at, "each entry must include last_seen_at");
    }
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("project usage merges fresh local repo usage from SQLite ahead of stale project queue rows", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vibedeck-project-usage-"));
  try {
    const trackerDir = path.join(tmp, "tracker");
    await fs.promises.mkdir(trackerDir, { recursive: true });

    const queuePath = path.join(trackerDir, "queue.jsonl");
    const projectQueuePath = path.join(trackerDir, "project.queue.jsonl");
    const dbPath = path.join(trackerDir, "vibedeck.sqlite3");

    await writeJsonLines(queuePath, []);
    await writeJsonLines(projectQueuePath, [
      {
        project_key: "acme/public-alpha",
        project_ref: "https://github.com/acme/public-alpha",
        source: "codex",
        hour_start: "2026-05-08T09:00:00.000Z",
        total_tokens: 150,
        billable_total_tokens: 150,
      },
      {
        project_key: "acme/public-beta",
        project_ref: "https://github.com/acme/public-beta",
        source: "codex",
        hour_start: "2026-05-07T10:00:00.000Z",
        total_tokens: 120,
        billable_total_tokens: 120,
      },
      {
        project_key: "/Users/vasuyadav/Downloads/Projects/VibeDeck",
        project_ref: "/Users/vasuyadav/Downloads/Projects/VibeDeck",
        source: "codex",
        hour_start: "2026-05-09T08:30:00.000Z",
        total_tokens: 25,
        billable_total_tokens: 25,
      },
    ]);

    ensureSchema(dbPath);
    const db = new DatabaseSync(dbPath);
    try {
      insertSession(db, {
        provider: "codex",
        session_id: "vd-1",
        started_at: "2026-05-10T12:30:00.000Z",
        ended_at: "2026-05-10T12:55:00.000Z",
        cwd: "/Users/vasuyadav/Downloads/Projects/VibeDeck",
        repo_root: "/Users/vasuyadav/Downloads/Projects/VibeDeck",
        branch_resolution_tier: "A",
        confidence: "high",
        model: "gpt-5",
        total_tokens: 450,
      });
      insertSession(db, {
        provider: "codex",
        session_id: "swe-1",
        started_at: "2026-05-10T11:15:00.000Z",
        ended_at: "2026-05-10T11:45:00.000Z",
        cwd: "/Users/vasuyadav/Downloads/Projects/SWE-AF",
        repo_root: "/Users/vasuyadav/Downloads/Projects/SWE-AF",
        branch_resolution_tier: "A",
        confidence: "high",
        model: "gpt-5",
        total_tokens: 320,
      });
      insertSession(db, {
        provider: "claude",
        session_id: "vd-2",
        started_at: "2026-05-09T18:00:00.000Z",
        ended_at: "2026-05-09T18:20:00.000Z",
        cwd: "/Users/vasuyadav/Downloads/Projects/VibeDeck",
        repo_root: "/Users/vasuyadav/Downloads/Projects/VibeDeck",
        branch_resolution_tier: "B",
        confidence: "medium",
        model: "claude-sonnet-4-6",
        total_tokens: 50,
      });
    } finally {
      db.close();
    }

    const body = await callEndpoint(
      queuePath,
      "/functions/vibedeck-project-usage-summary?sort=recent&limit=2",
    );

    assert.deepEqual(
      body.entries.map((entry) => entry.project_key),
      ["VibeDeck", "SWE-AF"],
    );
    assert.equal(body.entries[0].project_ref, "/Users/vasuyadav/Downloads/Projects/VibeDeck");
    assert.equal(body.entries[0].last_seen_at, "2026-05-10T12:55:00.000Z");
    assert.equal(body.entries[0].total_tokens, "525");
    assert.equal(body.entries[1].project_ref, "/Users/vasuyadav/Downloads/Projects/SWE-AF");
    assert.equal(body.entries[1].last_seen_at, "2026-05-10T11:45:00.000Z");
    assert.equal(body.entries[1].total_tokens, "320");
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("project usage recent sort uses latest session activity instead of latest start time", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vibedeck-project-usage-"));
  try {
    const trackerDir = path.join(tmp, "tracker");
    await fs.promises.mkdir(trackerDir, { recursive: true });

    const queuePath = path.join(trackerDir, "queue.jsonl");
    const projectQueuePath = path.join(trackerDir, "project.queue.jsonl");
    const dbPath = path.join(trackerDir, "vibedeck.sqlite3");

    await writeJsonLines(queuePath, []);
    await writeJsonLines(projectQueuePath, []);

    ensureSchema(dbPath);
    const db = new DatabaseSync(dbPath);
    try {
      insertSession(db, {
        provider: "codex",
        session_id: "repo-a",
        started_at: "2026-05-10T09:00:00.000Z",
        ended_at: "2026-05-10T13:30:00.000Z",
        cwd: "/Users/vasuyadav/Downloads/Projects/VibeDeck",
        repo_root: "/Users/vasuyadav/Downloads/Projects/VibeDeck",
        branch_resolution_tier: "A",
        confidence: "high",
        model: "gpt-5",
        total_tokens: 200,
      });
      insertSession(db, {
        provider: "claude",
        session_id: "repo-b",
        started_at: "2026-05-10T12:00:00.000Z",
        ended_at: "2026-05-10T12:45:00.000Z",
        cwd: "/Users/vasuyadav/Downloads/Projects/SWE-AF",
        repo_root: "/Users/vasuyadav/Downloads/Projects/SWE-AF",
        branch_resolution_tier: "A",
        confidence: "high",
        model: "claude-sonnet-4-6",
        total_tokens: 150,
      });
    } finally {
      db.close();
    }

    const body = await callEndpoint(
      queuePath,
      "/functions/vibedeck-project-usage-summary?sort=recent&limit=2",
    );

    assert.deepEqual(
      body.entries.map((entry) => entry.project_key),
      ["VibeDeck", "SWE-AF"],
    );
    assert.equal(body.entries[0].last_seen_at, "2026-05-10T13:30:00.000Z");
    assert.equal(body.entries[1].last_seen_at, "2026-05-10T12:45:00.000Z");
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("project usage enriches DB-backed entries with provider and model cost breakdowns", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vibedeck-project-usage-"));
  try {
    const trackerDir = path.join(tmp, "tracker");
    await fs.promises.mkdir(trackerDir, { recursive: true });

    const queuePath = path.join(trackerDir, "queue.jsonl");
    const projectQueuePath = path.join(trackerDir, "project.queue.jsonl");
    const dbPath = path.join(trackerDir, "vibedeck.sqlite3");

    await writeJsonLines(queuePath, []);
    await writeJsonLines(projectQueuePath, []);

    ensureSchema(dbPath);
    const db = new DatabaseSync(dbPath);
    try {
      insertSession(db, {
        provider: "codex",
        session_id: "vd-codex-1",
        started_at: "2026-05-10T09:00:00.000Z",
        ended_at: "2026-05-10T09:30:00.000Z",
        cwd: "/Users/vasuyadav/Downloads/Projects/VibeDeck",
        repo_root: "/Users/vasuyadav/Downloads/Projects/VibeDeck",
        branch_resolution_tier: "A",
        confidence: "high",
        model: "gpt-5",
        total_tokens: 200,
        total_cost_usd: 1.25,
        created_at: "2026-05-10T09:00:00.000Z",
        updated_at: "2026-05-10T09:30:00.000Z",
      });
      insertSession(db, {
        provider: "codex",
        session_id: "vd-codex-2",
        started_at: "2026-05-10T10:00:00.000Z",
        ended_at: "2026-05-10T10:20:00.000Z",
        cwd: "/Users/vasuyadav/Downloads/Projects/VibeDeck",
        repo_root: "/Users/vasuyadav/Downloads/Projects/VibeDeck",
        branch_resolution_tier: "A",
        confidence: "high",
        model: "gpt-5",
        total_tokens: 100,
        total_cost_usd: null,
        created_at: "2026-05-10T10:00:00.000Z",
        updated_at: "2026-05-10T10:20:00.000Z",
      });
      insertSession(db, {
        provider: "claude",
        session_id: "vd-claude-1",
        started_at: "2026-05-10T11:00:00.000Z",
        ended_at: "2026-05-10T11:45:00.000Z",
        cwd: "/Users/vasuyadav/Downloads/Projects/VibeDeck",
        repo_root: "/Users/vasuyadav/Downloads/Projects/VibeDeck",
        branch_resolution_tier: "A",
        confidence: "high",
        model: "claude-sonnet-4-6",
        total_tokens: 80,
        total_cost_usd: 0.4,
        created_at: "2026-05-10T11:00:00.000Z",
        updated_at: "2026-05-10T11:45:00.000Z",
      });
    } finally {
      db.close();
    }

    const body = await callEndpoint(queuePath, "/functions/vibedeck-project-usage-summary");

    assert.equal(body.entries.length, 1);
    const entry = body.entries[0];
    assert.equal(entry.project_key, "VibeDeck");
    assert.equal(entry.project_ref, "/Users/vasuyadav/Downloads/Projects/VibeDeck");
    assert.equal(entry.repo_root, "/Users/vasuyadav/Downloads/Projects/VibeDeck");
    assert.equal(entry.total_tokens, "380");
    assert.equal(entry.billable_total_tokens, "380");
    assert.equal(entry.last_seen_at, "2026-05-10T11:45:00.000Z");
    assert.equal(entry.cost_estimated, true);
    assert.equal(entry.cost_quality, "mixed_known");
    assert.match(entry.estimated_total_cost_usd, /^\d+\.\d+$/);

    assert.deepEqual(
      entry.providers.map((provider) => provider.provider),
      ["codex", "claude"],
    );

    const codex = entry.providers[0];
    assert.equal(codex.total_tokens, "300");
    assert.equal(codex.session_count, 2);
    assert.equal(codex.cost_estimated, true);
    assert.equal(codex.cost_quality, "estimated_total_tokens");
    assert.match(codex.estimated_total_cost_usd, /^\d+\.\d+$/);
    assert.equal(codex.models.length, 1);
    assert.equal(codex.models[0].model, "gpt-5");
    assert.equal(codex.models[0].total_tokens, "300");
    assert.equal(codex.models[0].session_count, 2);
    assert.equal(codex.models[0].cost_estimated, true);
    assert.equal(codex.models[0].cost_quality, "estimated_total_tokens");
    assert.match(codex.models[0].estimated_total_cost_usd, /^\d+\.\d+$/);

    const claude = entry.providers[1];
    assert.equal(claude.total_tokens, "80");
    assert.equal(claude.session_count, 1);
    assert.equal(claude.cost_estimated, false);
    assert.equal(claude.cost_quality, "stored");
    assert.equal(claude.estimated_total_cost_usd, "0.400000");
    assert.equal(claude.models[0].model, "claude-sonnet-4-6");
    assert.equal(claude.models[0].estimated_total_cost_usd, "0.400000");

    assert.equal(entry.top_models.length, 2);
    assert.deepEqual(
      entry.top_models.map((model) => [model.provider, model.model, model.total_tokens]),
      [
        ["codex", "gpt-5", "300"],
        ["claude", "claude-sonnet-4-6", "80"],
      ],
    );
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("project usage applies DB-backed from, to, and source filters without breaking queue fallback", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vibedeck-project-usage-"));
  try {
    const trackerDir = path.join(tmp, "tracker");
    await fs.promises.mkdir(trackerDir, { recursive: true });

    const queuePath = path.join(trackerDir, "queue.jsonl");
    const projectQueuePath = path.join(trackerDir, "project.queue.jsonl");
    const dbPath = path.join(trackerDir, "vibedeck.sqlite3");

    await writeJsonLines(queuePath, [
      {
        source: "codex",
        hour_start: "2026-05-09T08:00:00.000Z",
        total_tokens: 50,
        billable_total_tokens: 50,
      },
    ]);
    await writeJsonLines(projectQueuePath, []);

    ensureSchema(dbPath);
    const db = new DatabaseSync(dbPath);
    try {
      insertSession(db, {
        provider: "codex",
        session_id: "vd-codex-keep",
        started_at: "2026-05-10T09:00:00.000Z",
        ended_at: "2026-05-10T09:15:00.000Z",
        cwd: "/Users/vasuyadav/Downloads/Projects/VibeDeck",
        repo_root: "/Users/vasuyadav/Downloads/Projects/VibeDeck",
        branch_resolution_tier: "A",
        confidence: "high",
        model: "gpt-5",
        total_tokens: 200,
        total_cost_usd: null,
        created_at: "2026-05-10T09:00:00.000Z",
        updated_at: "2026-05-10T09:15:00.000Z",
      });
      insertSession(db, {
        provider: "claude",
        session_id: "vd-claude-filtered",
        started_at: "2026-05-10T11:00:00.000Z",
        ended_at: "2026-05-10T11:20:00.000Z",
        cwd: "/Users/vasuyadav/Downloads/Projects/VibeDeck",
        repo_root: "/Users/vasuyadav/Downloads/Projects/VibeDeck",
        branch_resolution_tier: "A",
        confidence: "high",
        model: "claude-sonnet-4-6",
        total_tokens: 80,
        total_cost_usd: null,
        created_at: "2026-05-10T11:00:00.000Z",
        updated_at: "2026-05-10T11:20:00.000Z",
      });
      insertSession(db, {
        provider: "codex",
        session_id: "vd-codex-old",
        started_at: "2026-05-08T11:00:00.000Z",
        ended_at: "2026-05-08T11:30:00.000Z",
        cwd: "/Users/vasuyadav/Downloads/Projects/VibeDeck",
        repo_root: "/Users/vasuyadav/Downloads/Projects/VibeDeck",
        branch_resolution_tier: "A",
        confidence: "high",
        model: "gpt-5",
        total_tokens: 999,
        total_cost_usd: null,
        created_at: "2026-05-08T11:00:00.000Z",
        updated_at: "2026-05-08T11:30:00.000Z",
      });
    } finally {
      db.close();
    }

    const filtered = await callEndpoint(
      queuePath,
      "/functions/vibedeck-project-usage-summary?from=2026-05-10&to=2026-05-10&source=codex",
    );

    assert.equal(filtered.entries.length, 1);
    assert.equal(filtered.entries[0].project_key, "VibeDeck");
    assert.equal(filtered.entries[0].total_tokens, "200");
    assert.equal(filtered.entries[0].providers.length, 1);
    assert.equal(filtered.entries[0].providers[0].provider, "codex");
    assert.equal(filtered.entries[0].providers[0].total_tokens, "200");
    assert.equal(filtered.entries[0].top_models.length, 1);
    assert.equal(filtered.entries[0].top_models[0].model, "gpt-5");

    const fallback = await callEndpoint(
      queuePath,
      "/functions/vibedeck-project-usage-summary?from=2026-05-09&to=2026-05-09&source=codex",
    );

    assert.equal(fallback.entries.length, 1);
    assert.equal(fallback.entries[0].project_key, "codex");
    assert.equal(fallback.entries[0].total_tokens, "50");
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});
