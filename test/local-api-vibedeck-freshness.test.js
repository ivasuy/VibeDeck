const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const { ensureSchema } = require("../src/lib/db");
const { createLocalApiHandler } = require("../src/lib/local-api");

async function writeJsonLines(filePath, rows) {
  await fs.promises.writeFile(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""),
    "utf8",
  );
}

async function callEndpoint(queuePath, endpoint, options = {}) {
  const handler = createLocalApiHandler({ queuePath, ...options });
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

test("vibedeck sync status reports parse freshness, queue mtimes, and session counts", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vibedeck-freshness-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const projectQueuePath = path.join(tmp, "project.queue.jsonl");
    const cursorsPath = path.join(tmp, "cursors.json");
    const dbPath = path.join(tmp, "vibedeck.sqlite3");

    await writeJsonLines(queuePath, [{ source: "codex", total_tokens: 10 }]);
    await writeJsonLines(projectQueuePath, [{ project_key: "acme/alpha", total_tokens: 5 }]);
    await fs.promises.writeFile(
      cursorsPath,
      JSON.stringify({ updatedAt: "2026-05-10T10:00:00.000Z" }) + "\n",
      "utf8",
    );

    const queueMtime = new Date("2026-05-10T10:03:00.000Z");
    const projectQueueMtime = new Date("2026-05-10T10:04:00.000Z");
    await fs.promises.utimes(queuePath, queueMtime, queueMtime);
    await fs.promises.utimes(projectQueuePath, projectQueueMtime, projectQueueMtime);

    ensureSchema(dbPath);
    const db = new DatabaseSync(dbPath);
    try {
      db.exec(`
        INSERT INTO vibedeck_sessions (
          provider, session_id, started_at, ended_at, end_reason,
          cwd, repo_root, repo_common_dir, parent_repo,
          branch, branch_resolution_tier, confidence, override_user,
          model, total_tokens, total_cost_usd, created_at, updated_at
        ) VALUES
        (
          'codex', 's1', '2026-05-10T09:00:00.000Z', NULL, NULL,
          '/repo', '/repo', NULL, NULL,
          'main', 'A', 'high', NULL,
          'gpt-5.2', 100, 0.1, '2026-05-10T09:00:00.000Z', '2026-05-10T09:00:00.000Z'
        ),
        (
          'claude', 's2', '2026-05-10T08:00:00.000Z', '2026-05-10T08:30:00.000Z', 'stop',
          '/repo', '/repo', NULL, NULL,
          'feature/live', 'B', 'medium', NULL,
          'claude-sonnet-4-6', 200, 0.2, '2026-05-10T08:00:00.000Z', '2026-05-10T08:30:00.000Z'
        );
      `);
    } finally {
      db.close();
    }

    const body = await callEndpoint(
      queuePath,
      "/functions/vibedeck-sync-status",
      { syncEnabled: false },
    );

    assert.deepEqual(body, {
      last_parse_at: "2026-05-10T10:00:00.000Z",
      queue_updated_at: "2026-05-10T10:03:00.000Z",
      project_queue_updated_at: "2026-05-10T10:04:00.000Z",
      session_count: 2,
      open_session_count: 1,
      sync_enabled: false,
    });
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("vibedeck sync status tolerates missing files and database", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vibedeck-freshness-missing-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");

    const body = await callEndpoint(queuePath, "/functions/vibedeck-sync-status");

    assert.deepEqual(body, {
      last_parse_at: null,
      queue_updated_at: null,
      project_queue_updated_at: null,
      session_count: 0,
      open_session_count: 0,
      sync_enabled: true,
    });
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});
