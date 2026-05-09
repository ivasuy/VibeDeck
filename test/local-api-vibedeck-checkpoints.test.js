const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
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

function loadLocalApiWithEntireBridgeStub(stub) {
  const entireBridgePath = path.join(__dirname, "..", "src", "lib", "entire-bridge.js");
  delete require.cache[entireBridgePath];
  require.cache[entireBridgePath] = {
    id: entireBridgePath,
    filename: entireBridgePath,
    loaded: true,
    exports: stub,
  };

  delete require.cache[require.resolve("../src/lib/local-api")];
  const mod = require("../src/lib/local-api");
  return {
    mod,
    restore() {
      delete require.cache[entireBridgePath];
      delete require.cache[require.resolve("../src/lib/local-api")];
    },
  };
}

test("local API exposes vibedeck Entire read-only endpoints", async () => {
  const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "vibedeck-repo-"));
  const { mod, restore } = loadLocalApiWithEntireBridgeStub({
    listCheckpointsCached: async () => ({ available: true, files: ["a.json"] }),
    readCheckpoint: async () => ({ ok: true, hello: "world" }),
    getEntireRepoStatus: async () => ({ state: "not_enabled", version: "1.2.3" }),
  });

  try {
    const handler = mod.createLocalApiHandler({ queuePath: path.join(repoDir, "queue.jsonl") });

    {
      const req = createRequest({ method: "GET" });
      const res = createResponse();
      const handled = await handler(
        req,
        res,
        new URL(
          `http://127.0.0.1/functions/vibedeck-checkpoints?repo=${encodeURIComponent(repoDir)}`,
        ),
      );
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(JSON.parse(res.body.toString("utf8")), { available: true, files: ["a.json"] });
    }

    {
      const req = createRequest({ method: "GET" });
      const res = createResponse();
      const handled = await handler(
        req,
        res,
        new URL(
          `http://127.0.0.1/functions/vibedeck-checkpoint?repo=${encodeURIComponent(repoDir)}&path=${encodeURIComponent("a.json")}`,
        ),
      );
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(JSON.parse(res.body.toString("utf8")), { ok: true, hello: "world" });
    }

    {
      const req = createRequest({ method: "GET" });
      const res = createResponse();
      const handled = await handler(
        req,
        res,
        new URL(
          `http://127.0.0.1/functions/vibedeck-entire-status?repo=${encodeURIComponent(repoDir)}`,
        ),
      );
      assert.equal(handled, true);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(JSON.parse(res.body.toString("utf8")), {
        state: "not_enabled",
        version: "1.2.3",
      });
    }
  } finally {
    restore();
    await fs.rm(repoDir, { recursive: true, force: true });
  }
});

test("vibedeck Entire endpoints reject invalid repo paths", async () => {
  const { mod, restore } = loadLocalApiWithEntireBridgeStub({
    listCheckpointsCached: async () => ({ available: true, files: [] }),
    readCheckpoint: async () => ({ ok: true }),
    getEntireRepoStatus: async () => ({ state: "not_installed" }),
  });

  try {
    const handler = mod.createLocalApiHandler({ queuePath: path.join(os.tmpdir(), "queue.jsonl") });
    const req = createRequest({ method: "GET" });
    const res = createResponse();
    const handled = await handler(
      req,
      res,
      new URL("http://127.0.0.1/functions/vibedeck-checkpoints?repo=/path/does/not/exist"),
    );
    assert.equal(handled, true);
    assert.equal(res.statusCode, 400);
  } finally {
    restore();
  }
});

