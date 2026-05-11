const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const { ensureSchema } = require("../src/lib/db");
const { upsertEntireState } = require("../src/lib/db/repos");

function createRequest({ method = "GET", headers = {}, body } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = headers;

  process.nextTick(() => {
    if (body != null) req.emit("data", Buffer.from(body));
    req.emit("end");
  });

  return req;
}

function createResponse() {
  return {
    statusCode: null,
    headers: null,
    body: Buffer.alloc(0),
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(chunk) {
      this.body = chunk ? Buffer.from(chunk) : Buffer.alloc(0);
    },
  };
}

async function createTracker() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedeck-known-repos-"));
  const trackerDir = path.join(root, ".vibedeck", "tracker");
  const queuePath = path.join(trackerDir, "queue.jsonl");
  const dbPath = path.join(trackerDir, "vibedeck.sqlite3");
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, "", "utf8");
  ensureSchema(dbPath);
  return { root, queuePath, dbPath };
}

function insertSession(dbPath, row) {
  const now = "2026-05-11T01:00:00.000Z";
  const db = new DatabaseSync(dbPath);
  try {
    db.prepare(
      `
      INSERT INTO vibedeck_sessions (
        provider, session_id, started_at, ended_at, end_reason,
        cwd, repo_root, repo_common_dir, parent_repo,
        branch, branch_resolution_tier, confidence, override_user,
        model, total_tokens, total_cost_usd,
        created_at, updated_at
      ) VALUES (
        @provider, @session_id, @started_at, @ended_at, NULL,
        @cwd, @repo_root, NULL, NULL,
        @branch, @tier, @confidence, '{}',
        @model, @total_tokens, NULL,
        @created_at, @updated_at
      )
    `,
    ).run({
      provider: row.provider || "codex",
      session_id: row.session_id,
      started_at: row.started_at || now,
      ended_at: row.ended_at ?? null,
      cwd: row.cwd ?? row.repo_root ?? null,
      repo_root: row.repo_root ?? null,
      branch: row.branch || null,
      tier: row.tier || "D",
      confidence: row.confidence || "unattributed",
      model: row.model || "gpt-5.5",
      total_tokens: row.total_tokens || 0,
      created_at: now,
      updated_at: row.updated_at || now,
    });
  } finally {
    db.close();
  }
}

test("vibedeck-known-repos merges Entire repo state and attributed sessions", async () => {
  const { root, queuePath, dbPath } = await createTracker();
  const switchyardRepo = path.join(root, "switchyard");
  const vibedeckRepo = path.join(root, "vibedeck");
  try {
    await fs.mkdir(switchyardRepo, { recursive: true });
    await fs.mkdir(vibedeckRepo, { recursive: true });

    upsertEntireState(dbPath, {
      repoRoot: switchyardRepo,
      entire_state: "active",
      entire_version: "0.6.1",
    });
    insertSession(dbPath, {
      session_id: "s1",
      repo_root: vibedeckRepo,
      branch: "main",
      confidence: "low",
      updated_at: "2026-05-11T02:00:00.000Z",
    });
    insertSession(dbPath, {
      session_id: "s2",
      repo_root: switchyardRepo,
      branch: "dashboard",
      confidence: "high",
      ended_at: null,
      updated_at: "2026-05-11T03:00:00.000Z",
    });
    insertSession(dbPath, {
      session_id: "s3",
      repo_root: null,
      branch: null,
    });

    delete require.cache[require.resolve("../src/lib/local-api")];
    const { createLocalApiHandler } = require("../src/lib/local-api");
    const handler = createLocalApiHandler({ queuePath });
    const req = createRequest();
    const res = createResponse();
    const handled = await handler(req, res, new URL("http://127.0.0.1/functions/vibedeck-known-repos"));

    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body.toString("utf8"));
    assert.deepEqual(payload.repos.map((repo) => repo.repo_root).sort(), [
      switchyardRepo,
      vibedeckRepo,
    ]);
    const switchyard = payload.repos.find((repo) => repo.repo_root === switchyardRepo);
    assert.equal(switchyard.entire_state, "active");
    assert.equal(switchyard.entire_version, "0.6.1");
    assert.equal(switchyard.open_session_count, 1);
    assert.equal(switchyard.session_count, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("vibedeck-known-repos hides repos that no longer exist on disk", async () => {
  const { root, queuePath, dbPath } = await createTracker();
  const existingRepo = path.join(root, "existing");
  const missingSessionRepo = path.join(root, "deleted-session-repo");
  const missingEntireRepo = path.join(root, "deleted-entire-repo");
  try {
    await fs.mkdir(existingRepo, { recursive: true });
    upsertEntireState(dbPath, {
      repoRoot: missingEntireRepo,
      entire_state: "active",
      entire_version: "0.6.1",
    });
    insertSession(dbPath, {
      session_id: "existing",
      repo_root: existingRepo,
      branch: "main",
      updated_at: "2026-05-11T04:00:00.000Z",
    });
    insertSession(dbPath, {
      session_id: "missing",
      repo_root: missingSessionRepo,
      branch: "main",
      updated_at: "2026-05-11T05:00:00.000Z",
    });

    delete require.cache[require.resolve("../src/lib/local-api")];
    const { createLocalApiHandler } = require("../src/lib/local-api");
    const handler = createLocalApiHandler({ queuePath });
    const req = createRequest();
    const res = createResponse();
    const handled = await handler(req, res, new URL("http://127.0.0.1/functions/vibedeck-known-repos"));

    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const payload = JSON.parse(res.body.toString("utf8"));
    assert.deepEqual(payload.repos.map((repo) => repo.repo_root), [existingRepo]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("vibedeck-entire-status persists checked repo state into local API tracker db", async () => {
  const { root, queuePath, dbPath } = await createTracker();
  const repoRoot = path.join(root, "repo");
  try {
    await fs.mkdir(path.join(repoRoot, ".entire"), { recursive: true });
    await fs.writeFile(path.join(repoRoot, ".entire", "settings.json"), '{"enabled":true}', "utf8");

    const bridgePath = require.resolve("../src/lib/entire-bridge");
    require.cache[bridgePath] = {
      id: bridgePath,
      filename: bridgePath,
      loaded: true,
      exports: {
        getEntireRepoStatus: async (repo, options = {}) => {
          assert.equal(options.dbPathOverride, dbPath);
          upsertEntireState(options.dbPathOverride, {
            repoRoot: await fs.realpath(repo),
            entire_state: "active",
            entire_version: "0.6.1",
          });
          return { state: "active", version: "0.6.1", checkpoint_branch_tip: "abc123" };
        },
      },
    };
    delete require.cache[require.resolve("../src/lib/local-api")];

    const { createLocalApiHandler } = require("../src/lib/local-api");
    const handler = createLocalApiHandler({ queuePath });
    const req = createRequest();
    const res = createResponse();
    const handled = await handler(
      req,
      res,
      new URL(`http://127.0.0.1/functions/vibedeck-entire-status?repo=${encodeURIComponent(repoRoot)}&cached=1`),
    );

    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);

    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const rows = db
        .prepare("SELECT repo_root, entire_state, entire_version FROM vibedeck_repos")
        .all()
        .map((row) => ({ ...row }));
      assert.deepEqual(rows, [
        {
          repo_root: await fs.realpath(repoRoot),
          entire_state: "active",
          entire_version: "0.6.1",
        },
      ]);
    } finally {
      db.close();
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
