const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { createLocalApiHandler } = require("../src/lib/local-api");

async function writeJsonLines(filePath, rows) {
  await fs.promises.writeFile(
    filePath,
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    "utf8",
  );
}

async function callEndpoint(queuePath, endpoint) {
  const handler = createLocalApiHandler({ queuePath });
  const url = new URL(`http://localhost${endpoint}`);
  const req = {
    method: "GET",
    url: url.pathname + url.search,
    headers: { host: "localhost" },
  };
  const chunks = [];
  const res = {
    statusCode: 200,
    setHeader() {},
    writeHead() {},
    write(chunk) {
      chunks.push(chunk);
    },
    end(body) {
      if (body) chunks.push(body);
    },
  };
  const handled = await handler(req, res, url);
  assert.ok(handled, `endpoint must be handled: ${endpoint}`);
  return JSON.parse(chunks.join(""));
}

test("vibedeck project usage alias matches the legacy response shape", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vibedeck-project-usage-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const projectQueuePath = path.join(tmp, "project.queue.jsonl");

    await writeJsonLines(queuePath, []);
    await writeJsonLines(projectQueuePath, [
      {
        project_key: "acme/alpha",
        project_ref: "https://github.com/acme/alpha",
        source: "codex",
        hour_start: "2026-05-03T12:00:00.000Z",
        total_tokens: 100,
        billable_total_tokens: 100,
      },
    ]);

    const legacy = await callEndpoint(queuePath, "/functions/tokentracker-project-usage-summary");
    const alias = await callEndpoint(queuePath, "/functions/vibedeck-project-usage-summary");

    assert.deepEqual(Object.keys(alias).sort(), Object.keys(legacy).sort());
    assert.deepEqual(alias.entries, legacy.entries);
    assert.deepEqual(
      Object.keys(alias.entries[0] || {}).sort(),
      Object.keys(legacy.entries[0] || {}).sort(),
    );
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});

test("project usage supports recent sorting, limit, and last_seen_at metadata", async () => {
  const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "vibedeck-project-usage-"));
  try {
    const queuePath = path.join(tmp, "queue.jsonl");
    const projectQueuePath = path.join(tmp, "project.queue.jsonl");

    await writeJsonLines(queuePath, []);
    await writeJsonLines(projectQueuePath, [
      {
        project_key: "acme/alpha",
        project_ref: "https://github.com/acme/alpha",
        source: "codex",
        hour_start: "2026-05-01T09:00:00.000Z",
        total_tokens: 90,
        billable_total_tokens: 90,
      },
      {
        project_key: "acme/alpha",
        project_ref: "https://github.com/acme/alpha",
        source: "codex",
        hour_start: "2026-05-03T12:00:00.000Z",
        total_tokens: 10,
        billable_total_tokens: 10,
      },
      {
        project_key: "acme/beta",
        project_ref: "https://github.com/acme/beta",
        source: "codex",
        hour_start: "2026-05-02T11:00:00.000Z",
        timestamp: "2026-05-10T11:45:00.000Z",
        total_tokens: 60,
        billable_total_tokens: 60,
      },
      {
        project_key: "acme/gamma",
        project_ref: "https://github.com/acme/gamma",
        source: "codex",
        hour_start: "2026-05-09T08:00:00.000Z",
        total_tokens: 50,
        billable_total_tokens: 50,
      },
    ]);

    const body = await callEndpoint(
      queuePath,
      "/functions/vibedeck-project-usage-summary?sort=recent&limit=2",
    );

    assert.equal(body.entries.length, 2);
    assert.deepEqual(
      body.entries.map((entry) => entry.project_key),
      ["acme/beta", "acme/gamma"],
    );
    assert.equal(body.entries[0].last_seen_at, "2026-05-10T11:45:00.000Z");
    assert.equal(body.entries[1].last_seen_at, "2026-05-09T08:00:00.000Z");
    for (const entry of body.entries) {
      assert.ok(entry.last_seen_at, "each entry must include last_seen_at");
    }
  } finally {
    await fs.promises.rm(tmp, { recursive: true, force: true });
  }
});
