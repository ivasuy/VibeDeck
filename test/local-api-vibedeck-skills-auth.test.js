const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { test, beforeEach, afterEach } = require("node:test");

const auth = require("../src/lib/local-auth");
const LOOPBACK_REFERER = "http://127.0.0.1:7690/dashboard";
const LOOPBACK_ORIGIN = "http://127.0.0.1:7690";
const NON_LOOPBACK_ORIGIN = "http://example.com";

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

async function getJson(baseUrl, pathname, headers = {}) {
  const req = http.request(`${baseUrl}${pathname}`, {
    method: "GET",
    headers,
  });
  req.end();
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
let localAuthToken;
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
  const localAuthRes = await getJson(srv.baseUrl, "/api/local-auth", {
    referer: LOOPBACK_REFERER,
  });
  localAuthToken = localAuthRes.body?.token;
});

afterEach(async () => {
  if (srv) await srv.close();
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
  srv = null;
  tmpRoot = null;
});

test("GET /api/local-auth requires loopback browser headers", async () => {
  const missingContext = await getJson(srv.baseUrl, "/api/local-auth");
  assert.equal(missingContext.status, 401);
  assert.equal(missingContext.body?.error, "missing_auth");

  const wrongOrigin = await getJson(srv.baseUrl, "/api/local-auth", {
    origin: NON_LOOPBACK_ORIGIN,
  });
  assert.equal(wrongOrigin.status, 401);
  assert.equal(wrongOrigin.body?.error, "missing_auth");

  const loopbackContext = await getJson(srv.baseUrl, "/api/local-auth", {
    referer: LOOPBACK_REFERER,
  });
  assert.equal(loopbackContext.status, 200);
  assert.ok(loopbackContext.body?.token);
});

test("POST /functions/vibedeck-skills/uninstall accepts local dashboard auth from loopback origin", async () => {
  const res = await postJson(
    srv.baseUrl,
    "/functions/vibedeck-skills/uninstall",
    { id: "skill-id" },
    {
      origin: LOOPBACK_ORIGIN,
      "x-tokentracker-local-auth": localAuthToken,
    },
  );

  assert.notEqual(res.status, 401);
  assert.equal(res.body?.ok, true);
  assert.deepEqual(calls, [{ fn: "uninstallSkill", args: ["skill-id"] }]);
});

test("POST /functions/vibedeck-skills/uninstall rejects local dashboard auth without loopback origin", async () => {
  const res = await postJson(
    srv.baseUrl,
    "/functions/vibedeck-skills/uninstall",
    { id: "skill-id" },
    {
      origin: NON_LOOPBACK_ORIGIN,
      "x-tokentracker-local-auth": localAuthToken,
    },
  );

  assert.equal(res.status, 401);
  assert.equal(res.body?.error, "missing_auth");
  assert.equal(calls.length, 0);
});

test("POST /functions/vibedeck-skills/uninstall rejects local dashboard auth without origin or referer", async () => {
  const res = await postJson(
    srv.baseUrl,
    "/functions/vibedeck-skills/uninstall",
    { id: "skill-id" },
    {
      "x-tokentracker-local-auth": localAuthToken,
    },
  );

  assert.equal(res.status, 401);
  assert.equal(res.body?.error, "missing_auth");
  assert.equal(calls.length, 0);
});

const localMutationCases = [
  {
    name: "confirm-destructive",
    pathname: "/functions/vibedeck-confirm-destructive",
    body: {},
    expectedAuthPassStatus: 400,
    expectedAuthPassError: "missing_op",
  },
  {
    name: "entire unknown command",
    pathname: "/functions/vibedeck-entire/not-a-command",
    body: {},
    expectedAuthPassStatus: 400,
    expectedAuthPassError: "unknown_command",
  },
  {
    name: "entire rewind",
    pathname: "/functions/vibedeck-entire/rewind",
    body: {},
    expectedAuthPassStatus: 400,
    expectedAuthPassError: "missing_params",
  },
  {
    name: "entire clean",
    pathname: "/functions/vibedeck-entire/clean",
    body: {},
    expectedAuthPassStatus: 400,
    expectedAuthPassError: "missing_params",
  },
  {
    name: "attribute",
    pathname: "/functions/vibedeck-attribute",
    body: {},
    expectedAuthPassStatus: 400,
    expectedAuthPassError: "missing_params",
  },
];

for (const routeCase of localMutationCases) {
  test(`local dashboard auth reaches ${routeCase.name} validation from loopback`, async () => {
    const res = await postJson(
      srv.baseUrl,
      routeCase.pathname,
      routeCase.body,
      {
        origin: LOOPBACK_ORIGIN,
        "x-tokentracker-local-auth": localAuthToken,
      },
    );

    assert.equal(res.status, routeCase.expectedAuthPassStatus);
    assert.equal(res.body?.error, routeCase.expectedAuthPassError);
  });

  test(`local dashboard auth rejects ${routeCase.name} without loopback browser headers`, async () => {
    const res = await postJson(
      srv.baseUrl,
      routeCase.pathname,
      routeCase.body,
      {
        "x-tokentracker-local-auth": localAuthToken,
      },
    );

    assert.equal(res.status, 401);
    assert.equal(res.body?.error, "missing_auth");
  });

  test(`local dashboard auth rejects ${routeCase.name} with non-loopback origin`, async () => {
    const res = await postJson(
      srv.baseUrl,
      routeCase.pathname,
      routeCase.body,
      {
        origin: NON_LOOPBACK_ORIGIN,
        "x-tokentracker-local-auth": localAuthToken,
      },
    );

    assert.equal(res.status, 401);
    assert.equal(res.body?.error, "missing_auth");
  });
}

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
