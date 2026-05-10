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
let vibedeckRoot;
let queuePath;
let token;
let srv;
let calls;

beforeEach(async () => {
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vibedeck-skills-auth-"));
  vibedeckRoot = path.join(tmpRoot, ".vibedeck");
  const trackerDir = path.join(vibedeckRoot, "tracker");
  await fs.mkdir(trackerDir, { recursive: true });
  queuePath = path.join(trackerDir, "queue.jsonl");
  await fs.writeFile(queuePath, "", "utf8");
  token = auth.ensureToken(path.join(vibedeckRoot, "auth.token"));

  calls = [];
  const skillsPath = require.resolve("../src/lib/skills-manager");
  require.cache[skillsPath] = {
    id: skillsPath,
    filename: skillsPath,
    loaded: true,
    exports: {
      installSkill: async (...args) => {
        calls.push({ fn: "installSkill", args });
        return { id: "s1" };
      },
      uninstallSkill: (...args) => {
        calls.push({ fn: "uninstallSkill", args });
        return { ok: true };
      },
      restoreSkill: (...args) => {
        calls.push({ fn: "restoreSkill", args });
        return { id: "s2" };
      },
      setSkillTargets: (...args) => {
        calls.push({ fn: "setSkillTargets", args });
        return { id: "s2", targets: args[1] || [] };
      },
      importLocalSkill: (...args) => {
        calls.push({ fn: "importLocalSkill", args });
        return { id: "s3" };
      },
      deleteLocalSkill: (...args) => {
        calls.push({ fn: "deleteLocalSkill", args });
        return { ok: true };
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

for (const cmd of ["install", "uninstall", "restore", "setTargets", "importLocal", "deleteLocal"]) {
  test(`POST /functions/vibedeck-skills/${cmd} without Bearer returns 401`, async () => {
    const res = await postJson(srv.baseUrl, `/functions/vibedeck-skills/${cmd}`, {});
    assert.equal(res.status, 401);
    assert.equal(res.body?.error, "missing_auth");
  });

  test(`POST /functions/vibedeck-skills/${cmd} with valid Bearer dispatches to skills-manager`, async () => {
    const res = await postJson(
      srv.baseUrl,
      `/functions/vibedeck-skills/${cmd}`,
      { skill: "x", id: "y", directory: "/tmp/skills", targets: ["claude"] },
      { authorization: `Bearer ${token}` },
    );
    assert.equal(res.status, 200);
    assert.equal(res.body?.ok, true);
    assert.equal(calls.length, 1);
  });
}
