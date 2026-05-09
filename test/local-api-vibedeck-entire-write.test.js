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
  let jsonBody = null;
  try {
    jsonBody = buf ? JSON.parse(buf) : null;
  } catch {
    jsonBody = null;
  }
  return { status: res.statusCode, body: jsonBody };
}

let tmpRoot;
let queuePath;
let repoRoot;
let token;
let srv;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vibedeck-entire-write-"));
  const vibedeckRoot = path.join(tmpRoot, ".vibedeck");
  const trackerDir = path.join(vibedeckRoot, "tracker");
  await fs.mkdir(trackerDir, { recursive: true });
  queuePath = path.join(trackerDir, "queue.jsonl");
  await fs.writeFile(queuePath, "", "utf8");

  repoRoot = path.join(tmpRoot, "repo");
  await fs.mkdir(repoRoot, { recursive: true });

  const tokenPath = path.join(vibedeckRoot, "auth.token");
  token = auth.ensureToken(tokenPath);

  // Stub entire-bridge so tests never shell out.
  const bridgePath = require.resolve("../src/lib/entire-bridge");
  require.cache[bridgePath] = {
    id: bridgePath,
    filename: bridgePath,
    loaded: true,
    exports: {
      enableEntire: async () => ({ ok: true, cmd: "enable" }),
      disableEntire: async () => ({ ok: true, cmd: "disable" }),
      entireConfigure: async () => ({ ok: true, cmd: "configure" }),
      entireDoctor: async () => ({ ok: true, cmd: "doctor" }),
      entireStatus: async () => ({ ok: true, cmd: "status" }),
      entireAgentAdd: async (...args) => ({ ok: true, cmd: "agent-add", args }),
      entireAgentRemove: async () => ({ ok: true, cmd: "agent-remove" }),
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

test("vibedeck-entire/:cmd rejects without auth", async () => {
  const res = await postJson(srv.baseUrl, "/functions/vibedeck-entire/status", { repo: repoRoot });
  assert.equal(res.status, 401);
  assert.equal(res.body?.error, "missing_auth");
});

test("vibedeck-entire/:cmd rejects unknown commands with 400", async () => {
  const res = await postJson(
    srv.baseUrl,
    "/functions/vibedeck-entire/not-a-real-cmd",
    { repo: repoRoot },
    { authorization: `Bearer ${token}` },
  );
  assert.equal(res.status, 400);
  assert.equal(res.body?.error, "unknown_command");
});

test("vibedeck-entire/:cmd requires repo in body", async () => {
  const res = await postJson(
    srv.baseUrl,
    "/functions/vibedeck-entire/status",
    {},
    { authorization: `Bearer ${token}` },
  );
  assert.equal(res.status, 400);
  assert.equal(res.body?.error, "missing_repo");
});

test("vibedeck-entire/:cmd validates repo path via realpathSync", async () => {
  const missing = path.join(tmpRoot, "does-not-exist");
  const res = await postJson(
    srv.baseUrl,
    "/functions/vibedeck-entire/status",
    { repo: missing },
    { authorization: `Bearer ${token}` },
  );
  assert.equal(res.status, 400);
  assert.equal(res.body?.error, "missing_repo");
});

test("vibedeck-entire/:cmd forwards agent-add to entire bridge wrapper", async () => {
  const res = await postJson(
    srv.baseUrl,
    "/functions/vibedeck-entire/agent-add",
    { repo: repoRoot, agent: "demo-agent" },
    { authorization: `Bearer ${token}` },
  );
  assert.equal(res.status, 200);
  assert.equal(res.body?.ok, true);
  assert.equal(res.body?.cmd, "agent-add");
  assert.equal(res.body?.args?.[0], await fs.realpath(repoRoot));
  assert.equal(res.body?.args?.[1], "demo-agent");
});

