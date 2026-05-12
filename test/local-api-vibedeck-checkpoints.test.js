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

test("vibedeck checkpoints aggregate usage from child metadata files", async () => {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "vibedeck-repo-metadata-usage-"));
  const trackerDir = path.join(repoDir, ".vibedeck", "tracker");
  const queuePath = path.join(trackerDir, "queue.jsonl");
  const dbPath = path.join(trackerDir, "vibedeck.sqlite3");
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, "", "utf8");
  ensureSchema(dbPath);

  const rootMetadataPath = "17/2a6d406440/metadata.json";
  const firstMetadataPath = "17/2a6d406440/0/metadata.json";
  const secondMetadataPath = "17/2a6d406440/1/metadata.json";
  const checkpointPayloads = new Map([
    [
      rootMetadataPath,
      {
        path: rootMetadataPath,
        kind: "json",
        parsed: {
          checkpoint_id: "172a6d406440",
          branch: "publish-main",
          sessions: [
            { metadata: `/${firstMetadataPath}`, transcript: "/17/2a6d406440/0/full.jsonl" },
            { metadata: `/${secondMetadataPath}`, transcript: "/17/2a6d406440/1/full.jsonl" },
          ],
          token_usage: {
            input_tokens: 21647,
            cache_creation_tokens: 0,
            cache_read_tokens: 2276480,
            output_tokens: 5885,
            api_call_count: 25,
          },
        },
        raw: "{}",
      },
    ],
    [
      firstMetadataPath,
      {
        path: firstMetadataPath,
        kind: "json",
        parsed: {
          checkpoint_id: "172a6d406440",
          session_id: "019e14a6-ea73-7c02-9101-d9169718424b",
          agent: "Codex",
          model: "gpt-5.5",
          turn_id: "502ed0b42539",
          branch: "publish-main",
          token_usage: {
            input_tokens: 11641,
            cache_creation_tokens: 0,
            cache_read_tokens: 1994624,
            output_tokens: 2095,
            api_call_count: 11,
          },
        },
        raw: "{}",
      },
    ],
    [
      secondMetadataPath,
      {
        path: secondMetadataPath,
        kind: "json",
        parsed: {
          checkpoint_id: "172a6d406440",
          session_id: "019e1536-375e-7da0-b5a0-e4f0383234df",
          agent: "Codex",
          model: "gpt-5.3-codex-spark",
          turn_id: "3b301b5acd9b",
          branch: "publish-main",
          token_usage: {
            input_tokens: 10006,
            cache_creation_tokens: 0,
            cache_read_tokens: 281856,
            output_tokens: 3790,
            api_call_count: 14,
          },
        },
        raw: "{}",
      },
    ],
  ]);

  const { mod, restore } = loadLocalApiWithEntireBridgeStub({
    listCheckpointsCached: async () => ({
      available: true,
      files: [rootMetadataPath, firstMetadataPath, secondMetadataPath],
    }),
    readCheckpoint: async (_repo, filePath) => {
      const payload = checkpointPayloads.get(filePath);
      if (!payload) throw new Error(`missing checkpoint: ${filePath}`);
      return payload;
    },
    getEntireRepoStatus: async () => ({ state: "active", version: "1.2.3" }),
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
    const usage = body.checkpoint_usage["17/2a6d406440"];
    assert.equal(usage.status, "metadata");
    assert.equal(usage.confidence, "metadata");
    assert.equal(usage.total_tokens, 2304012);
    assert.ok(usage.total_cost_usd > 0);
    assert.equal(usage.cost_quality, "checkpoint_metadata");
    assert.deepEqual(
      usage.models.map((row) => row.model),
      ["gpt-5.5", "gpt-5.3-codex-spark"],
    );
    assert.deepEqual(
      usage.metadata_files.map((row) => ({
        metadata_path: row.metadata_path,
        model: row.model,
        total_tokens: row.total_tokens,
      })),
      [
        { metadata_path: firstMetadataPath, model: "gpt-5.5", total_tokens: 2008360 },
        { metadata_path: secondMetadataPath, model: "gpt-5.3-codex-spark", total_tokens: 295652 },
      ],
    );
  } finally {
    restore();
    await fs.rm(repoDir, { recursive: true, force: true });
  }
});

test("vibedeck child checkpoint metadata includes direct token and cost usage", async () => {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "vibedeck-repo-metadata-file-usage-"));
  const trackerDir = path.join(repoDir, ".vibedeck", "tracker");
  const queuePath = path.join(trackerDir, "queue.jsonl");
  const dbPath = path.join(trackerDir, "vibedeck.sqlite3");
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, "", "utf8");
  ensureSchema(dbPath);

  const metadataPath = "17/2a6d406440/1/metadata.json";
  const { mod, restore } = loadLocalApiWithEntireBridgeStub({
    listCheckpointsCached: async () => ({ available: true, files: [metadataPath] }),
    readCheckpoint: async () => ({
      path: metadataPath,
      kind: "json",
      parsed: {
        checkpoint_id: "172a6d406440",
        session_id: "019e1536-375e-7da0-b5a0-e4f0383234df",
        agent: "Codex",
        model: "gpt-5.3-codex-spark",
        turn_id: "3b301b5acd9b",
        branch: "publish-main",
        token_usage: {
          input_tokens: 10006,
          cache_creation_tokens: 0,
          cache_read_tokens: 281856,
          output_tokens: 3790,
          api_call_count: 14,
        },
      },
      raw: "{}",
    }),
    getEntireRepoStatus: async () => ({ state: "active", version: "1.2.3" }),
  });

  try {
    const handler = mod.createLocalApiHandler({ queuePath });
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
    assert.equal(body.usage.status, "metadata");
    assert.equal(body.usage.provider, "codex");
    assert.equal(body.usage.model, "gpt-5.3-codex-spark");
    assert.equal(body.usage.total_tokens, 295652);
    assert.ok(body.usage.total_cost_usd > 0);
    assert.equal(body.usage.cost_quality, "checkpoint_metadata");
  } finally {
    restore();
    await fs.rm(repoDir, { recursive: true, force: true });
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
        provider: "codex",
        model: "gpt-5.5",
        branch: "main",
        total_tokens: 1000,
        total_cost_usd: 1.23,
        known_cost_usd: 1.23,
        cost_unknown_count: 0,
        cost_quality: "stored",
        providers: [{ provider: "codex", total_tokens: 1000, total_cost_usd: 1.23, known_cost_usd: 1.23, cost_unknown_count: 0, cost_quality: "stored", session_count: 1 }],
        models: [{ model: "gpt-5.5", total_tokens: 1000, total_cost_usd: 1.23, known_cost_usd: 1.23, cost_unknown_count: 0, cost_quality: "stored", session_count: 1 }],
        provider_breakdown: [{ provider: "codex", total_tokens: 1000, total_cost_usd: 1.23, known_cost_usd: 1.23, cost_unknown_count: 0, cost_quality: "stored", session_count: 1 }],
        model_breakdown: [{ model: "gpt-5.5", total_tokens: 1000, total_cost_usd: 1.23, known_cost_usd: 1.23, cost_unknown_count: 0, cost_quality: "stored", session_count: 1 }],
        status: "linked",
        confidence: "linked",
        session_count: 1,
        reason: null,
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
        provider: "codex",
        model: "gpt-5.5",
        branch: "main",
        total_tokens: 1000,
        total_cost_usd: 1.23,
        known_cost_usd: 1.23,
        cost_unknown_count: 0,
        cost_quality: "stored",
        providers: [{ provider: "codex", total_tokens: 1000, total_cost_usd: 1.23, known_cost_usd: 1.23, cost_unknown_count: 0, cost_quality: "stored", session_count: 1 }],
        models: [{ model: "gpt-5.5", total_tokens: 1000, total_cost_usd: 1.23, known_cost_usd: 1.23, cost_unknown_count: 0, cost_quality: "stored", session_count: 1 }],
        provider_breakdown: [{ provider: "codex", total_tokens: 1000, total_cost_usd: 1.23, known_cost_usd: 1.23, cost_unknown_count: 0, cost_quality: "stored", session_count: 1 }],
        model_breakdown: [{ model: "gpt-5.5", total_tokens: 1000, total_cost_usd: 1.23, known_cost_usd: 1.23, cost_unknown_count: 0, cost_quality: "stored", session_count: 1 }],
        status: "linked",
        confidence: "linked",
        session_count: 1,
        reason: null,
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
    assert.equal(body.checkpoint_usage["aa/11bb22ccdd"].status, "linked");
    assert.equal(body.checkpoint_usage["aa/11bb22ccdd"].confidence, "linked");
    assert.equal(body.checkpoint_usage["aa/11bb22ccdd"].provider, "codex");
    assert.equal(body.checkpoint_usage["aa/11bb22ccdd"].model, "gpt-5.5");
  } finally {
    restore();
    await fs.rm(repoDir, { recursive: true, force: true });
  }
});

test("vibedeck checkpoints include linked cost quality from checkpoint match table", async () => {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "vibedeck-repo-match-linked-"));
  const repoRoot = await fs.realpath(repoDir);
  const trackerDir = path.join(repoDir, ".vibedeck", "tracker");
  const queuePath = path.join(trackerDir, "queue.jsonl");
  const dbPath = path.join(trackerDir, "vibedeck.sqlite3");
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, "", "utf8");
  ensureSchema(dbPath);

  const db = new DatabaseSync(dbPath);
  db.prepare(`
    INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence, override_user,
      model, total_tokens, total_cost_usd, last_observed_at,
      cost_estimated, cost_quality, created_at, updated_at
    ) VALUES (
      'codex', 'sess-1', '2026-05-12T01:00:00.000Z', '2026-05-12T01:05:00.000Z', 'complete',
      ?, ?, NULL, ?,
      'main', 'A', 'high', NULL,
      'gpt-5.5', 1000, 1.23, '2026-05-12T01:05:00.000Z',
      0, 'stored', '2026-05-12T01:00:00.000Z', '2026-05-12T01:05:00.000Z'
    );
  `).run(repoRoot, repoRoot, repoRoot);
  db.prepare(`
    INSERT INTO vibedeck_entire_checkpoint_matches (
      repo_root, checkpoint_group_id, checkpoint_id, metadata_path, checkpoint_tip,
      entire_session_id, agent, provider, model, branch, started_at, ended_at,
      session_provider, session_id, match_status, match_confidence, reason, candidate_count,
      created_at, updated_at
    ) VALUES (
      ?, 'e2/abdc1ec6', 'e2abdc1ec6', 'e2/abdc1ec6/metadata.json', 'tip1',
      'entire-session-1', 'codex', 'codex', 'gpt-5.5', 'main', '2026-05-12T01:00:00.000Z', '2026-05-12T01:05:00.000Z',
      'codex', 'sess-1', 'linked', 'exact', NULL, 1,
      '2026-05-12T01:06:00.000Z', '2026-05-12T01:06:00.000Z'
    );
  `).run(repoRoot);
  db.close();

  const metadataPath = "e2/abdc1ec6/metadata.json";
  const { mod, restore } = loadLocalApiWithEntireBridgeStub({
    listCheckpointsCached: async () => ({ available: true, files: [metadataPath] }),
    readCheckpoint: async () => ({
      path: metadataPath,
      kind: "json",
      parsed: {
        checkpoint_id: "e2abdc1ec6",
        entire_session_id: "entire-session-1",
        agent: "codex",
        model: "gpt-5.5",
        branch: "main",
        started_at: "2026-05-12T01:00:00.000Z",
        ended_at: "2026-05-12T01:05:00.000Z",
      },
      raw: "{}",
    }),
    getEntireRepoStatus: async () => ({ state: "active", version: "1.0.0" }),
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
    const body = JSON.parse(res.body.toString("utf8"));
    const usage = body.checkpoint_usage["e2/abdc1ec6"];
    assert.equal(usage.status, "linked");
    assert.equal(usage.confidence, "exact");
    assert.equal(usage.total_cost_usd, 1.23);
    assert.equal(usage.cost_quality, "stored");
    assert.equal(usage.provider, "codex");
    assert.equal(usage.model, "gpt-5.5");
  } finally {
    restore();
    await fs.rm(repoDir, { recursive: true, force: true });
  }
});

test("vibedeck checkpoints expose ambiguous status without showing zero cost", async () => {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "vibedeck-repo-match-ambiguous-"));
  const repoRoot = await fs.realpath(repoDir);
  const trackerDir = path.join(repoDir, ".vibedeck", "tracker");
  const queuePath = path.join(trackerDir, "queue.jsonl");
  const dbPath = path.join(trackerDir, "vibedeck.sqlite3");
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, "", "utf8");
  ensureSchema(dbPath);

  const db = new DatabaseSync(dbPath);
  db.prepare(`
    INSERT INTO vibedeck_entire_checkpoint_matches (
      repo_root, checkpoint_group_id, checkpoint_id, metadata_path, checkpoint_tip,
      entire_session_id, agent, provider, model, branch, started_at, ended_at,
      session_provider, session_id, match_status, match_confidence, reason, candidate_count,
      created_at, updated_at
    ) VALUES (
      ?, 'e2/abdc1ec6', 'e2abdc1ec6', 'e2/abdc1ec6/metadata.json', 'tip2',
      'entire-session-1', 'codex', 'codex', 'gpt-5.5', 'main', '2026-05-12T01:00:00.000Z', '2026-05-12T01:05:00.000Z',
      NULL, NULL, 'ambiguous', 'ambiguous', 'multiple_matching_sessions', 2,
      '2026-05-12T01:06:00.000Z', '2026-05-12T01:06:00.000Z'
    );
  `).run(repoRoot);
  db.close();

  const metadataPath = "e2/abdc1ec6/metadata.json";
  const { mod, restore } = loadLocalApiWithEntireBridgeStub({
    listCheckpointsCached: async () => ({ available: true, files: [metadataPath] }),
    readCheckpoint: async () => ({ path: metadataPath, kind: "json", parsed: { checkpoint_id: "e2abdc1ec6" }, raw: "{}" }),
    getEntireRepoStatus: async () => ({ state: "active", version: "1.0.0" }),
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
    const body = JSON.parse(res.body.toString("utf8"));
    const usage = body.checkpoint_usage["e2/abdc1ec6"];
    assert.equal(usage.status, "ambiguous");
    assert.equal(usage.confidence, "ambiguous");
    assert.equal(usage.total_tokens, null);
    assert.equal(usage.total_cost_usd, null);
    assert.equal(usage.cost_quality, "unknown");
    assert.equal(usage.reason, "multiple_matching_sessions");
    assert.equal(usage.provider, "codex");
    assert.equal(usage.model, "gpt-5.5");
  } finally {
    restore();
    await fs.rm(repoDir, { recursive: true, force: true });
  }
});

test("vibedeck checkpoint metadata exposes unmatched usage status", async () => {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "vibedeck-repo-match-unmatched-"));
  const repoRoot = await fs.realpath(repoDir);
  const trackerDir = path.join(repoDir, ".vibedeck", "tracker");
  const queuePath = path.join(trackerDir, "queue.jsonl");
  const dbPath = path.join(trackerDir, "vibedeck.sqlite3");
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, "", "utf8");
  ensureSchema(dbPath);

  const db = new DatabaseSync(dbPath);
  db.prepare(`
    INSERT INTO vibedeck_entire_checkpoint_matches (
      repo_root, checkpoint_group_id, checkpoint_id, metadata_path, checkpoint_tip,
      entire_session_id, agent, provider, model, branch, started_at, ended_at,
      session_provider, session_id, match_status, match_confidence, reason, candidate_count,
      created_at, updated_at
    ) VALUES (
      ?, 'e2/abdc1ec6', 'e2abdc1ec6', 'e2/abdc1ec6/metadata.json', 'tip3',
      'entire-session-1', 'codex', 'codex', 'gpt-5.5', 'main', '2026-05-12T01:00:00.000Z', '2026-05-12T01:05:00.000Z',
      NULL, NULL, 'unmatched', 'unmatched', 'no_matching_session', 0,
      '2026-05-12T01:06:00.000Z', '2026-05-12T01:06:00.000Z'
    );
  `).run(repoRoot);
  db.close();

  const metadataPath = "e2/abdc1ec6/metadata.json";
  const { mod, restore } = loadLocalApiWithEntireBridgeStub({
    listCheckpointsCached: async () => ({ available: true, files: [metadataPath] }),
    readCheckpoint: async () => ({ path: metadataPath, kind: "json", parsed: { checkpoint_id: "e2abdc1ec6" }, raw: "{}" }),
    getEntireRepoStatus: async () => ({ state: "active", version: "1.0.0" }),
  });

  try {
    const handler = mod.createLocalApiHandler({ queuePath });
    const req = createRequest({ method: "GET" });
    const res = createResponse();
    const handled = await handler(
      req,
      res,
      new URL(`http://127.0.0.1/functions/vibedeck-checkpoint?repo=${encodeURIComponent(repoDir)}&path=${encodeURIComponent(metadataPath)}`),
    );
    assert.equal(handled, true);
    const body = JSON.parse(res.body.toString("utf8"));
    assert.equal(body.usage.status, "unmatched");
    assert.equal(body.usage.total_cost_usd, null);
    assert.equal(body.usage.cost_quality, "unknown");
    assert.equal(body.usage.provider, "codex");
    assert.equal(body.usage.model, "gpt-5.5");
  } finally {
    restore();
    await fs.rm(repoDir, { recursive: true, force: true });
  }
});
