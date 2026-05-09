const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { test, beforeEach, afterEach } = require("node:test");

const auth = require("../src/lib/local-auth");

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
  return { status: res.statusCode, body: buf ? JSON.parse(buf) : null };
}

let tmpRoot;
let vibedeckRoot;
let queuePath;
let repoRoot;
let token;
let srv;
let calls;

beforeEach(async () => {
  auth._resetConfirmTokensForTests();
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vibedeck-destructive-"));
  vibedeckRoot = path.join(tmpRoot, ".vibedeck");
  const trackerDir = path.join(vibedeckRoot, "tracker");
  await fs.mkdir(trackerDir, { recursive: true });
  queuePath = path.join(trackerDir, "queue.jsonl");
  await fs.writeFile(queuePath, "", "utf8");

  repoRoot = path.join(tmpRoot, "repo");
  await fs.mkdir(repoRoot, { recursive: true });

  token = auth.ensureToken(path.join(vibedeckRoot, "auth.token"));

  calls = [];
  const bridgePath = require.resolve("../src/lib/entire-bridge");
  require.cache[bridgePath] = {
    id: bridgePath,
    filename: bridgePath,
    loaded: true,
    exports: {
      rewindCheckpoint: async (...args) => {
        calls.push({ fn: "rewindCheckpoint", args });
        return { exitCode: 0, stdout: "ok", stderr: "" };
      },
      cleanEntire: async (...args) => {
        calls.push({ fn: "cleanEntire", args });
        return { exitCode: 0, stdout: "ok", stderr: "" };
      },
    },
  };
  delete require.cache[require.resolve("../src/lib/local-api")];

  srv = await startLocalApiServer({ queuePath });
});

afterEach(async () => {
  if (srv) await srv.close();
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
  srv = null;
  tmpRoot = null;
});

test("POST /functions/vibedeck-confirm-destructive issues a token for given op", async () => {
  const res = await postJson(
    srv.baseUrl,
    "/functions/vibedeck-confirm-destructive",
    { op: "rewindCheckpoint" },
    { authorization: `Bearer ${token}` },
  );
  assert.equal(res.status, 200);
  assert.equal(res.body?.op, "rewindCheckpoint");
  assert.equal(res.body?.expiresInMs, 30000);
  assert.match(res.body?.token, /^[a-f0-9]{32}$/);
});

test("POST /functions/vibedeck-confirm-destructive without Bearer returns 401", async () => {
  const res = await postJson(srv.baseUrl, "/functions/vibedeck-confirm-destructive", {
    op: "rewindCheckpoint",
  });
  assert.equal(res.status, 401);
  assert.equal(res.body?.error, "missing_auth");
});

test("POST /functions/vibedeck-entire/rewind without confirm token returns 400 missing_confirm_token", async () => {
  const res = await postJson(
    srv.baseUrl,
    "/functions/vibedeck-entire/rewind",
    { repo: repoRoot, checkpointId: "abc123def456" },
    { authorization: `Bearer ${token}` },
  );
  assert.equal(res.status, 400);
  assert.equal(res.body?.error, "missing_confirm_token");
});

test("POST /functions/vibedeck-entire/rewind with valid confirm token forwards to bridge.rewindCheckpoint", async () => {
  const issued = await postJson(
    srv.baseUrl,
    "/functions/vibedeck-confirm-destructive",
    { op: "rewindCheckpoint" },
    { authorization: `Bearer ${token}` },
  );
  const confirmToken = issued.body.token;
  const res = await postJson(
    srv.baseUrl,
    "/functions/vibedeck-entire/rewind",
    { repo: repoRoot, checkpointId: "abc123def456", confirm_token: confirmToken },
    { authorization: `Bearer ${token}` },
  );
  assert.equal(res.status, 200);
  assert.equal(res.body?.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].fn, "rewindCheckpoint");
  assert.equal(calls[0].args[0], await fs.realpath(repoRoot));
  assert.equal(calls[0].args[1], "abc123def456");
  assert.equal(calls[0].args[2], confirmToken);
});

test("POST /functions/vibedeck-entire/rewind reusing the same confirm token fails (single-use)", async () => {
  const issued = await postJson(
    srv.baseUrl,
    "/functions/vibedeck-confirm-destructive",
    { op: "rewindCheckpoint" },
    { authorization: `Bearer ${token}` },
  );
  const confirmToken = issued.body.token;
  const a = await postJson(
    srv.baseUrl,
    "/functions/vibedeck-entire/rewind",
    { repo: repoRoot, checkpointId: "abc123def456", confirm_token: confirmToken },
    { authorization: `Bearer ${token}` },
  );
  const b = await postJson(
    srv.baseUrl,
    "/functions/vibedeck-entire/rewind",
    { repo: repoRoot, checkpointId: "abc123def456", confirm_token: confirmToken },
    { authorization: `Bearer ${token}` },
  );
  assert.equal(a.status, 200);
  assert.equal(b.status, 400);
  assert.equal(b.body?.error, "invalid_confirm_token");
});

test("POST /functions/vibedeck-entire/rewind with mismatched op confirm token fails", async () => {
  const issued = await postJson(
    srv.baseUrl,
    "/functions/vibedeck-confirm-destructive",
    { op: "cleanEntire" },
    { authorization: `Bearer ${token}` },
  );
  const res = await postJson(
    srv.baseUrl,
    "/functions/vibedeck-entire/rewind",
    { repo: repoRoot, checkpointId: "abc123def456", confirm_token: issued.body.token },
    { authorization: `Bearer ${token}` },
  );
  assert.equal(res.status, 400);
  assert.equal(res.body?.error, "invalid_confirm_token");
});

test("POST /functions/vibedeck-entire/clean similar contract with op cleanEntire", async () => {
  const issued = await postJson(
    srv.baseUrl,
    "/functions/vibedeck-confirm-destructive",
    { op: "cleanEntire" },
    { authorization: `Bearer ${token}` },
  );
  const res = await postJson(
    srv.baseUrl,
    "/functions/vibedeck-entire/clean",
    { repo: repoRoot, confirm_token: issued.body.token, all: true },
    { authorization: `Bearer ${token}` },
  );
  assert.equal(res.status, 200);
  assert.equal(res.body?.ok, true);
  assert.equal(calls[0].fn, "cleanEntire");
  assert.equal(calls[0].args[0], await fs.realpath(repoRoot));
  assert.equal(calls[0].args[1], issued.body.token);
  assert.deepEqual(calls[0].args[2], { all: true });
});

