const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { test } = require("node:test");

const { ensureSchema } = require("../src/lib/db");
const { getRepoState, upsertEntireState } = require("../src/lib/db/repos");

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

test("vibedeck-entire-status reports cached state when persistent row exists", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedeck-local-api-repo-state-"));
  const repoDir = path.join(root, "repo");
  const trackerDir = path.join(root, ".vibedeck", "tracker");
  const queuePath = path.join(trackerDir, "queue.jsonl");
  const dbPath = path.join(trackerDir, "vibedeck.sqlite3");

  await fs.mkdir(repoDir, { recursive: true });
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, "", "utf8");

  const resolvedRepoRoot = await fs.realpath(repoDir);
  ensureSchema(dbPath);
  upsertEntireState(dbPath, {
    repoRoot: resolvedRepoRoot,
    entire_state: "active",
    entire_version: "0.42.0",
  });

  const mod = require("../src/lib/local-api");
  const handler = mod.createLocalApiHandler({ queuePath });

  const req = createRequest({ method: "GET" });
  const res = createResponse();
  const handled = await handler(
    req,
    res,
    new URL(
      `http://127.0.0.1/functions/vibedeck-entire-status?repo=${encodeURIComponent(repoDir)}&cached=1`,
    ),
  );

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body.toString("utf8"));
  assert.equal(payload.cached_state, "active");
  assert.equal(payload.cached_version, "0.42.0");
});

test("vibedeck-entire-status resolves cached state through symlink aliases", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedeck-local-api-repo-state-alias-"));
  const repoDir = path.join(root, "repo");
  const repoAlias = path.join(root, "repo-alias");
  const trackerDir = path.join(root, ".vibedeck", "tracker");
  const queuePath = path.join(trackerDir, "queue.jsonl");
  const dbPath = path.join(trackerDir, "vibedeck.sqlite3");

  await fs.mkdir(repoDir, { recursive: true });
  await fs.symlink(repoDir, repoAlias, "dir");
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, "", "utf8");

  ensureSchema(dbPath);
  upsertEntireState(dbPath, {
    repoRoot: repoAlias,
    entire_state: "active",
    entire_version: "raw-alias-version",
  });
  upsertEntireState(dbPath, {
    repoRoot: await fs.realpath(repoDir),
    entire_state: "active",
    entire_version: "realpath-version",
  });

  const row = getRepoState(dbPath, repoAlias);
  assert.equal(row?.entire_state, "active");
  assert.equal(row?.entire_version, "raw-alias-version");

  const mod = require("../src/lib/local-api");
  const handler = mod.createLocalApiHandler({ queuePath });

  const req = createRequest({ method: "GET" });
  const res = createResponse();
  const handled = await handler(
    req,
    res,
    new URL(
      `http://127.0.0.1/functions/vibedeck-entire-status?repo=${encodeURIComponent(repoAlias)}&cached=1`,
    ),
  );

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body.toString("utf8"));
  assert.equal(payload.cached_state, "active");
  assert.equal(payload.cached_version, "realpath-version");
});
