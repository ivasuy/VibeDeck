const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { test } = require("node:test");
const auth = require("../src/lib/local-auth");

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

test("POST /functions/vibedeck-entire/:cmd is auth-gated and returns 401 without Authorization header", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedeck-entire-gate-"));
  const mod = require("../src/lib/local-api");
  const trackerDir = path.join(root, "tracker");
  const queuePath = path.join(trackerDir, "queue.jsonl");
  await fs.mkdir(trackerDir, { recursive: true });
  await fs.writeFile(queuePath, "", "utf8");
  auth.ensureToken(path.join(root, "auth.token"));
  const handler = mod.createLocalApiHandler({ queuePath });

  const req = createRequest({ method: "POST", body: "{}" });
  const res = createResponse();

  const handled = await handler(
    req,
    res,
    new URL("http://127.0.0.1/functions/vibedeck-entire/enable"),
  );

  assert.equal(handled, true);
  assert.equal(res.statusCode, 401);
  assert.equal(JSON.parse(res.body.toString("utf8")).error, "missing_auth");
  await fs.rm(root, { recursive: true, force: true });
});
