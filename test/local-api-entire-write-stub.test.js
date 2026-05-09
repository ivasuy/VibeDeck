const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

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

test("POST /functions/vibedeck-entire/:cmd is reserved and returns 403 (auth pending)", async () => {
  const mod = require("../src/lib/local-api");
  const handler = mod.createLocalApiHandler({ queuePath: path.join(os.tmpdir(), "queue.jsonl") });

  const req = createRequest({ method: "POST", body: "{}" });
  const res = createResponse();

  const handled = await handler(
    req,
    res,
    new URL("http://127.0.0.1/functions/vibedeck-entire/enable"),
  );

  assert.equal(handled, true);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(JSON.parse(res.body.toString("utf8")), {
    error: "auth_pending",
    message: "This endpoint will be enabled in Plan 4 (local-auth tokens).",
    cmd: "enable",
  });
});

