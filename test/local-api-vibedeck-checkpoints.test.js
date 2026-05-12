const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { ensureSchema } = require("../src/lib/db");

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

function loadLocalApiWithEntireBridgeStub(stub) {
  const entireBridgePath = path.join(__dirname, "..", "src", "lib", "entire-bridge.js");
  delete require.cache[entireBridgePath];
  require.cache[entireBridgePath] = {
    id: entireBridgePath,
    filename: entireBridgePath,
    loaded: true,
    exports: stub,
  };

  delete require.cache[require.resolve("../src/lib/local-api")];
  const mod = require("../src/lib/local-api");
  return {
    mod,
    restore() {
      delete require.cache[entireBridgePath];
      delete require.cache[require.resolve("../src/lib/local-api")];
    },
  };
}

test("local API exposes vibedeck Entire read-only endpoints", async () => {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "vibedeck-repo-"));
  const { mod, restore } = loadLocalApiWithEntireBridgeStub({
    listCheckpointsCached: async () => ({ available: true, files: ["a.json"] }),
    readCheckpoint: async () => ({ ok: true, hello: "world" }),
    getEntireRepoStatus: async () => ({ state: "not_enabled", version: "1.2.3" }),
  });

  try {
    const handler = mod.createLocalApiHandler({ queuePath: path.join(repoDir, "queue.jsonl") });

    {
      const req = createRequest({ method: "GET" });
      const res = createResponse();
      const handled = await handler(
        req,
        res,
        new URL(
          `http://127.0.0.1/functions/vibedeck-checkpoints?repo=${encodeURIComponent(repoDir)}`,
        ),
      );
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(JSON.parse(res.body.toString("utf8")), {
        available: true,
        files: ["a.json"],
        checkpoint_usage: {},
      });
    }

    {
      const req = createRequest({ method: "GET" });
      const res = createResponse();
      const handled = await handler(
        req,
        res,
        new URL(
          `http://127.0.0.1/functions/vibedeck-checkpoint?repo=${encodeURIComponent(repoDir)}&path=${encodeURIComponent("a.json")}`,
        ),
      );
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(JSON.parse(res.body.toString("utf8")), { ok: true, hello: "world" });
    }

    {
      const req = createRequest({ method: "GET" });
      const res = createResponse();
      const handled = await handler(
        req,
        res,
        new URL(
          `http://127.0.0.1/functions/vibedeck-entire-status?repo=${encodeURIComponent(repoDir)}`,
        ),
      );
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(JSON.parse(res.body.toString("utf8")), {
        state: "not_enabled",
        version: "1.2.3",
      });
    }
  } finally {
    restore();
    await fs.rm(repoDir, { recursive: true, force: true });
  }
});

test("vibedeck Entire endpoints reject invalid repo paths", async () => {
  const { mod, restore } = loadLocalApiWithEntireBridgeStub({
    listCheckpointsCached: async () => ({ available: true, files: [] }),
    readCheckpoint: async () => ({ ok: true }),
    getEntireRepoStatus: async () => ({ state: "not_installed" }),
  });

  try {
    const handler = mod.createLocalApiHandler({ queuePath: path.join(os.tmpdir(), "queue.jsonl") });
    const req = createRequest({ method: "GET" });
    const res = createResponse();
    const handled = await handler(
      req,
      res,
      new URL("http://127.0.0.1/functions/vibedeck-checkpoints?repo=/path/does/not/exist"),
    );
    assert.equal(handled, true);
    assert.equal(res.statusCode, 400);
  } finally {
    restore();
  }
});

test("vibedeck checkpoint endpoints include canonical checkpoint usage from persisted entire links", async () => {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "vibedeck-repo-usage-"));
  const trackerDir = path.join(repoDir, ".vibedeck", "tracker");
  const queuePath = path.join(trackerDir, "queue.jsonl");
  const dbPath = path.join(trackerDir, "vibedeck.sqlite3");
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, "", "utf8");
  ensureSchema(dbPath);

  const db = new DatabaseSync(dbPath);
  db.exec(`
    INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence, override_user,
      model, total_tokens, total_cost_usd, last_observed_at,
      cost_estimated, cost_quality, created_at, updated_at
    ) VALUES (
      'codex', 'sess-1', '2026-05-12T01:00:00.000Z', '2026-05-12T01:05:00.000Z', 'complete',
      '/repo/VibeDeck', '/repo/VibeDeck', NULL, '/repo/VibeDeck',
      'main', 'A', 'high', NULL,
      'gpt-5.5', 1000, 1.23, '2026-05-12T01:05:00.000Z',
      0, 'stored', '2026-05-12T01:00:00.000Z', '2026-05-12T01:05:00.000Z'
    );
    INSERT INTO vibedeck_session_entire_links (
      provider, session_id, entire_session_id, entire_checkpoint_ids, match_confidence
    ) VALUES (
      'codex', 'sess-1', 'entire-session-1', '["e2abdc1ec6"]', 'high'
    );
  `);
  db.close();

  const metadataPath = "e2/abdc1ec6/metadata.json";
  const metadataPayload = {
    path: metadataPath,
    kind: "json",
    parsed: {
      checkpoint_id: "e2abdc1ec6",
      entire_session_id: "entire-session-1",
      agent: "codex",
      branch: "main",
      started_at: "2026-05-12T01:00:00.000Z",
      ended_at: "2026-05-12T01:05:00.000Z",
    },
    raw: "{}",
  };
  const { mod, restore } = loadLocalApiWithEntireBridgeStub({
    listCheckpointsCached: async () => ({ available: true, files: [metadataPath] }),
    readCheckpoint: async (_repo, filePath) => {
      if (filePath !== metadataPath) throw new Error("missing checkpoint");
      return metadataPayload;
    },
    getEntireRepoStatus: async () => ({ state: "not_enabled", version: "1.2.3" }),
  });

  try {
    const handler = mod.createLocalApiHandler({ queuePath });
    {
      const req = createRequest({ method: "GET" });
      const res = createResponse();
      const handled = await handler(
        req,
        res,
        new URL(`http://127.0.0.1/functions/vibedeck-checkpoints?repo=${encodeURIComponent(repoDir)}`),
      );
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body.toString("utf8"));
      assert.equal(body.available, true);
      assert.ok(body.checkpoint_usage);
      assert.deepEqual(body.checkpoint_usage["e2/abdc1ec6"], {
        checkpoint_id: "e2abdc1ec6",
        metadata_path: "e2/abdc1ec6/metadata.json",
        checkpoint_group_id: "e2/abdc1ec6",
        agent: "codex",
        branch: "main",
        total_tokens: 1000,
        total_cost_usd: 1.23,
        known_cost_usd: 1.23,
        cost_unknown_count: 0,
        providers: [{ provider: "codex", total_tokens: 1000, total_cost_usd: 1.23, known_cost_usd: 1.23, cost_unknown_count: 0, session_count: 1 }],
        models: [{ model: "gpt-5.5", total_tokens: 1000, total_cost_usd: 1.23, known_cost_usd: 1.23, cost_unknown_count: 0, session_count: 1 }],
        provider_breakdown: [{ provider: "codex", total_tokens: 1000, total_cost_usd: 1.23, known_cost_usd: 1.23, cost_unknown_count: 0, session_count: 1 }],
        model_breakdown: [{ model: "gpt-5.5", total_tokens: 1000, total_cost_usd: 1.23, known_cost_usd: 1.23, cost_unknown_count: 0, session_count: 1 }],
        confidence: "linked",
        session_count: 1,
      });
    }

    {
      const req = createRequest({ method: "GET" });
      const res = createResponse();
      const handled = await handler(
        req,
        res,
        new URL(`http://127.0.0.1/functions/vibedeck-checkpoint?repo=${encodeURIComponent(repoDir)}&path=${encodeURIComponent(metadataPath)}`),
      );
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body.toString("utf8"));
      assert.deepEqual(body.usage, {
        checkpoint_id: "e2abdc1ec6",
        metadata_path: "e2/abdc1ec6/metadata.json",
        checkpoint_group_id: "e2/abdc1ec6",
        agent: "codex",
        branch: "main",
        total_tokens: 1000,
        total_cost_usd: 1.23,
        known_cost_usd: 1.23,
        cost_unknown_count: 0,
        providers: [{ provider: "codex", total_tokens: 1000, total_cost_usd: 1.23, known_cost_usd: 1.23, cost_unknown_count: 0, session_count: 1 }],
        models: [{ model: "gpt-5.5", total_tokens: 1000, total_cost_usd: 1.23, known_cost_usd: 1.23, cost_unknown_count: 0, session_count: 1 }],
        provider_breakdown: [{ provider: "codex", total_tokens: 1000, total_cost_usd: 1.23, known_cost_usd: 1.23, cost_unknown_count: 0, session_count: 1 }],
        model_breakdown: [{ model: "gpt-5.5", total_tokens: 1000, total_cost_usd: 1.23, known_cost_usd: 1.23, cost_unknown_count: 0, session_count: 1 }],
        confidence: "linked",
        session_count: 1,
      });
    }
  } finally {
    restore();
    await fs.rm(repoDir, { recursive: true, force: true });
  }
});

test("vibedeck checkpoint usage resolves links by checkpoint_id when entire_session_id is absent", async () => {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "vibedeck-repo-usage-by-checkpoint-id-"));
  const trackerDir = path.join(repoDir, ".vibedeck", "tracker");
  const queuePath = path.join(trackerDir, "queue.jsonl");
  const dbPath = path.join(trackerDir, "vibedeck.sqlite3");
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, "", "utf8");
  ensureSchema(dbPath);

  const db = new DatabaseSync(dbPath);
  db.exec(`
    INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence, override_user,
      model, total_tokens, total_cost_usd, last_observed_at,
      cost_estimated, cost_quality, created_at, updated_at
    ) VALUES (
      'codex', 'sess-2', '2026-05-12T02:00:00.000Z', '2026-05-12T02:05:00.000Z', 'complete',
      '/repo/VibeDeck', '/repo/VibeDeck', NULL, '/repo/VibeDeck',
      'main', 'A', 'high', NULL,
      'gpt-5.5', 500, 0.5, '2026-05-12T02:05:00.000Z',
      0, 'stored', '2026-05-12T02:00:00.000Z', '2026-05-12T02:05:00.000Z'
    );
    INSERT INTO vibedeck_session_entire_links (
      provider, session_id, entire_session_id, entire_checkpoint_ids, match_confidence
    ) VALUES (
      'codex', 'sess-2', 'entire-session-2', '["aa11bb22ccdd"]', 'high'
    );
  `);
  db.close();

  const metadataPath = "aa/11bb22ccdd/metadata.json";
  const { mod, restore } = loadLocalApiWithEntireBridgeStub({
    listCheckpointsCached: async () => ({ available: true, files: [metadataPath] }),
    readCheckpoint: async () => ({
      path: metadataPath,
      kind: "json",
      parsed: {
        checkpoint_id: "aa11bb22ccdd",
        agent: "codex",
        branch: "main",
        started_at: "2026-05-12T02:00:00.000Z",
        ended_at: "2026-05-12T02:05:00.000Z",
      },
      raw: "{}",
    }),
    getEntireRepoStatus: async () => ({ state: "not_enabled", version: "1.2.3" }),
  });

  try {
    const handler = mod.createLocalApiHandler({ queuePath });
    const req = createRequest({ method: "GET" });
    const res = createResponse();
    const handled = await handler(
      req,
      res,
      new URL(`http://127.0.0.1/functions/vibedeck-checkpoints?repo=${encodeURIComponent(repoDir)}`),
    );
    assert.equal(handled, true);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body.toString("utf8"));
    assert.equal(body.checkpoint_usage["aa/11bb22ccdd"].total_tokens, 500);
    assert.equal(body.checkpoint_usage["aa/11bb22ccdd"].confidence, "linked");
  } finally {
    restore();
    await fs.rm(repoDir, { recursive: true, force: true });
  }
});
