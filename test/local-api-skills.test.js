const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { before, describe, it } = require("node:test");
const { DatabaseSync } = require("node:sqlite");

const { ensureSchema } = require("../src/lib/db");

const THEME_ROUTE = "/functions/vibedeck-skills";
const LEGACY_ROUTE = THEME_ROUTE.replace("vibedeck", ["token", "tracker"].join(""));
const LOCAL_AUTH_HEADER_PRIMARY = "x-vibedeck-local-auth";
const LOCAL_AUTH_HEADER_LEGACY = LOCAL_AUTH_HEADER_PRIMARY.replace("vibedeck", ["token", "tracker"].join(""));

// Sandbox HOME so the handler's local-auth + skills registry stay under tmp.
const sandboxHome = fs.mkdtempSync(path.join(os.tmpdir(), "tt-localapi-skills-"));
process.env.HOME = sandboxHome;
process.env.USERPROFILE = sandboxHome;

const { createLocalApiHandler } = require("../src/lib/local-api");

const queuePath = path.join(sandboxHome, "queue.jsonl");
fs.writeFileSync(queuePath, "");
const dbPath = path.join(sandboxHome, "vibedeck.sqlite3");
ensureSchema(dbPath);
const handler = createLocalApiHandler({ queuePath });

function makeReq({ method = "GET", pathname = THEME_ROUTE, search = "", headers = {}, body }) {
  const url = new URL(`http://localhost${pathname}${search}`);
  let listeners = {};
  const req = {
    method,
    url: url.pathname + url.search,
    headers: { host: "localhost", ...headers },
    on(event, fn) { listeners[event] = fn; return req; },
  };
  if (body !== undefined) {
    // Simulate IncomingMessage event stream for readJsonBody.
    process.nextTick(() => {
      listeners.data?.(Buffer.from(typeof body === "string" ? body : JSON.stringify(body)));
      listeners.end?.();
    });
  } else {
    process.nextTick(() => listeners.end?.());
  }
  return { req, url };
}

function makeRes() {
  const chunks = [];
  let statusCode = 200;
  return {
    chunks,
    get body() { return chunks.join(""); },
    get status() { return statusCode; },
    setHeader() {},
    writeHead(code) { statusCode = code; },
    write(chunk) { chunks.push(chunk); },
    end(chunk) { if (chunk) chunks.push(chunk); },
  };
}

async function call({ method, pathname, search = "", headers = {}, body } = {}) {
  const { req, url } = makeReq({ method, pathname, search, headers, body });
  const res = makeRes();
  const handled = await handler(req, res, url);
  return { handled, status: res.status, body: res.body ? JSON.parse(res.body) : null };
}

describe("/functions/vibedeck-skills auth + input", () => {
  let token;

  before(async () => {
    const result = await call({
      method: "GET",
      pathname: "/api/local-auth",
      headers: { referer: "http://localhost:7690/dashboard" },
    });
    assert.ok(result.handled);
    token = result.body.token;
    assert.ok(token && typeof token === "string");
  });

  it("rejects POST without the local-auth header with 401", async () => {
    const { status, body } = await call({
      method: "POST",
      pathname: LEGACY_ROUTE,
      headers: { origin: "http://localhost:7690" },
      body: { action: "add_repo", repo: { owner: "anthropics", name: "skills" } },
    });
    assert.equal(status, 401);
    assert.equal(body.ok, false);
  });

  it("rejects POST with mismatched token with 401", async () => {
    const { status } = await call({
      method: "POST",
      pathname: LEGACY_ROUTE,
      headers: {
        origin: "http://localhost:7690",
        [LOCAL_AUTH_HEADER_PRIMARY]: "not-the-right-token",
      },
      body: { action: "add_repo", repo: { owner: "anthropics", name: "skills" } },
    });
    assert.equal(status, 401);
  });

  it("returns 400 for unknown action with valid auth", async () => {
    const { status, body } = await call({
      method: "POST",
      pathname: LEGACY_ROUTE,
      headers: {
        origin: "http://localhost:7690",
        [LOCAL_AUTH_HEADER_PRIMARY]: token,
      },
      body: { action: "not-a-real-action" },
    });
    assert.equal(status, 400);
    assert.equal(body.ok, false);
  });

  it("returns 400 for unknown GET mode", async () => {
    const { status, body } = await call({
      method: "GET",
      search: "?mode=nonsense",
    });
    assert.equal(status, 400);
    assert.ok(body.error);
  });

  it("returns 405 for PUT", async () => {
    const { status } = await call({
      method: "PUT",
      headers: {
        origin: "http://localhost:7690",
        [LOCAL_AUTH_HEADER_PRIMARY]: token,
      },
    });
    assert.equal(status, 405);
  });

  it("GET mode=installed returns {targets, skills} shape", async () => {
    const { status, body } = await call({ method: "GET", search: "?mode=installed" });
    assert.equal(status, 200);
    assert.ok(Array.isArray(body.targets));
    assert.ok(Array.isArray(body.skills));
  });

  it("GET mode=usage returns skill invocation counts and apportioned cost", async () => {
    const now = "2026-05-23T00:00:00.000Z";
    const db = new DatabaseSync(dbPath);
    try {
      db.exec("DELETE FROM vibedeck_sessions");
      db.prepare(`
        INSERT INTO vibedeck_sessions (
          provider, session_id, started_at, ended_at, end_reason,
          cwd, repo_root, repo_common_dir, parent_repo,
          branch, branch_resolution_tier, confidence, override_user,
          model, total_tokens, total_cost_usd, skills_json,
          created_at, updated_at
        ) VALUES (
          'codex', 'skills-usage-1', ?, ?, NULL,
          '/tmp', '/tmp/repo', NULL, NULL,
          'main', 'A', 'high', NULL,
          'gpt-5.5', 1000, 0.30, ?,
          ?, ?
        )
      `).run(now, now, JSON.stringify({ review: 2, implement: 1 }), now, now);
    } finally {
      db.close();
    }

    const { status, body } = await call({ method: "GET", search: "?mode=usage&limit=2" });
    assert.equal(status, 200);
    assert.equal(body.totalInvocationCount, 3);
    assert.equal(body.totalCostUsd, "0.300000");
    assert.deepEqual(body.skills, [
      { name: "review", invocation_count: 2, cost_usd: "0.200000" },
      { name: "implement", invocation_count: 1, cost_usd: "0.100000" },
    ]);
  });

  it("surfaces addRepo validation error via 500 with message", async () => {
    const { status, body } = await call({
      method: "POST",
      pathname: LEGACY_ROUTE,
      headers: {
        origin: "http://localhost:7690",
        [LOCAL_AUTH_HEADER_PRIMARY]: token,
      },
      body: { action: "add_repo", repo: { owner: "..", name: "skills" } },
    });
    assert.equal(status, 500);
    assert.match(body.error, /owner and name/);
  });

  it("accepts legacy header on legacy route before action validation", async () => {
    const { status, body } = await call({
      method: "POST",
      pathname: LEGACY_ROUTE,
      headers: {
        origin: "http://localhost:7690",
        [LOCAL_AUTH_HEADER_LEGACY]: token,
      },
      body: { action: "not-a-real-action" },
    });
    assert.equal(status, 400);
    assert.equal(body.ok, false);
  });
});
