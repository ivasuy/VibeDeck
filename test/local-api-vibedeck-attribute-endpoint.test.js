const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { test, beforeEach, afterEach } = require("node:test");

const auth = require("../src/lib/local-auth");
const { ensureSchema } = require("../src/lib/db");
const { DatabaseSync } = require("node:sqlite");
const { resolveBranchForSession } = require("../src/lib/sessions/resolve-branch");

async function startLocalApiServer({ queuePath }) {
  const { createLocalApiHandler } = require("../src/lib/local-api");
  const handler = createLocalApiHandler({ queuePath });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const handled = await handler(req, res, url);
    if (handled) return;
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : null;
  if (!port) throw new Error("failed to bind test server");
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      server.close();
      await once(server, "close");
    },
  };
}

async function postJson(baseUrl, pathname, body, headers = {}) {
  const payload = JSON.stringify(body ?? {});
  const req = http.request(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(payload),
      ...headers,
    },
  });
  req.end(payload);
  const [res] = await once(req, "response");
  res.setEncoding("utf8");
  let buf = "";
  for await (const chunk of res) buf += chunk;
  let jsonBody = null;
  try {
    jsonBody = buf ? JSON.parse(buf) : null;
  } catch {
    jsonBody = null;
  }
  return { status: res.statusCode, body: jsonBody };
}

let tmpRoot;
let vibedeckRoot;
let trackerDir;
let queuePath;
let dbPath;
let token;
let srv;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vibedeck-attribute-"));
  vibedeckRoot = path.join(tmpRoot, ".vibedeck");
  trackerDir = path.join(vibedeckRoot, "tracker");
  await fs.mkdir(trackerDir, { recursive: true });
  queuePath = path.join(trackerDir, "queue.jsonl");
  await fs.writeFile(queuePath, "", "utf8");

  dbPath = path.join(trackerDir, "vibedeck.sqlite3");
  ensureSchema(dbPath);
  const db = new DatabaseSync(dbPath);
  db.exec(
    `INSERT INTO vibedeck_sessions (
      provider, session_id, started_at, ended_at, end_reason,
      cwd, repo_root, repo_common_dir, parent_repo,
      branch, branch_resolution_tier, confidence, override_user,
      model, total_tokens, total_cost_usd,
      created_at, updated_at
    ) VALUES (
      'codex', 's-attr-1', '2026-05-09T00:00:00.000Z', NULL, NULL,
      '/tmp', NULL, NULL, NULL,
      NULL, 'D', 'unattributed', NULL,
      NULL, 3, 0.0,
      '2026-05-09T00:00:00.000Z', '2026-05-09T00:00:00.000Z'
    );`,
  );
  db.close();

  token = auth.ensureToken(path.join(vibedeckRoot, "auth.token"));
  delete require.cache[require.resolve("../src/lib/local-api")];
  srv = await startLocalApiServer({ queuePath });
});

afterEach(async () => {
  if (srv) await srv.close();
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
  srv = null;
  tmpRoot = null;
});

test("POST /functions/vibedeck-attribute upserts override; resolver returns OVERRIDE tier", async () => {
  const res = await postJson(
    srv.baseUrl,
    "/functions/vibedeck-attribute",
    { provider: "codex", session_id: "s-attr-1", branch: "main" },
    { authorization: `Bearer ${token}` },
  );
  assert.equal(res.status, 200);
  assert.equal(res.body?.ok, true);
  const resolved = await resolveBranchForSession({
    provider: "codex",
    session_id: "s-attr-1",
    repo_root: null,
    started_at: "2026-05-09T00:00:00.000Z",
    ended_at: null,
    dbPath,
  });
  assert.equal(resolved.tier, "OVERRIDE");
  assert.equal(resolved.branch, "main");
});

test("POST /functions/vibedeck-attribute with branch=null deletes override", async () => {
  await postJson(
    srv.baseUrl,
    "/functions/vibedeck-attribute",
    { provider: "codex", session_id: "s-attr-1", branch: "dev" },
    { authorization: `Bearer ${token}` },
  );
  const cleared = await postJson(
    srv.baseUrl,
    "/functions/vibedeck-attribute",
    { provider: "codex", session_id: "s-attr-1", branch: null },
    { authorization: `Bearer ${token}` },
  );
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body?.cleared, true);
  const resolved = await resolveBranchForSession({
    provider: "codex",
    session_id: "s-attr-1",
    repo_root: null,
    started_at: "2026-05-09T00:00:00.000Z",
    ended_at: null,
    dbPath,
  });
  assert.equal(resolved.tier, "D");
});

test("POST /functions/vibedeck-attribute without Bearer returns 401", async () => {
  const res = await postJson(srv.baseUrl, "/functions/vibedeck-attribute", {
    provider: "codex",
    session_id: "s-attr-1",
    branch: "main",
  });
  assert.equal(res.status, 401);
  assert.equal(res.body?.error, "missing_auth");
});

test("POST /functions/vibedeck-attribute with unknown session returns 404", async () => {
  const res = await postJson(
    srv.baseUrl,
    "/functions/vibedeck-attribute",
    { provider: "codex", session_id: "nope", branch: "main" },
    { authorization: `Bearer ${token}` },
  );
  assert.equal(res.status, 404);
  assert.equal(res.body?.error, "session_not_found");
});

