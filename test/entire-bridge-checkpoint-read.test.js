const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const { readCheckpoint } = require("../src/lib/entire-bridge");

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vibedeck-entire-read-"));
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  execFileSync("git", ["add", "README.md"], { cwd: dir });
  execFileSync("git", ["commit", "-m", "base"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["checkout", "-b", "entire/checkpoints/v1"], { cwd: dir, stdio: "ignore" });
  fs.mkdirSync(path.join(dir, "06", "e2abdc1ec6", "0"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "06", "e2abdc1ec6", "metadata.json"),
    JSON.stringify({ cli_version: "0.6.1", branch: "publish-main", checkpoints_count: 0 }, null, 2),
  );
  fs.writeFileSync(path.join(dir, "06", "e2abdc1ec6", "0", "prompt.txt"), "Quality review\nLine two\n");
  fs.writeFileSync(path.join(dir, "06", "e2abdc1ec6", "0", "content_hash.txt"), "sha256:abc123\n");
  fs.writeFileSync(
    path.join(dir, "06", "e2abdc1ec6", "0", "full.jsonl"),
    `${JSON.stringify({ type: "start", id: 1 })}\n${JSON.stringify({ type: "end", id: 2 })}\n`,
  );
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "checkpoints"], { cwd: dir, stdio: "ignore" });
  return dir;
}

test("readCheckpoint returns parsed JSON metadata", async () => {
  const repo = makeRepo();
  try {
    const file = await readCheckpoint(repo, "06/e2abdc1ec6/metadata.json");
    assert.equal(file.kind, "json");
    assert.equal(file.path, "06/e2abdc1ec6/metadata.json");
    assert.equal(file.file_name, "metadata.json");
    assert.equal(file.extension, "json");
    assert.equal(file.parsed.branch, "publish-main");
    assert.equal(file.parse_error, null);
    assert.ok(file.size_bytes > 0);
    assert.match(file.raw, /publish-main/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("readCheckpoint returns plain text prompt files without JSON parse failure", async () => {
  const repo = makeRepo();
  try {
    const file = await readCheckpoint(repo, "06/e2abdc1ec6/0/prompt.txt");
    assert.equal(file.kind, "text");
    assert.equal(file.parsed, null);
    assert.equal(file.line_count, 2);
    assert.match(file.raw, /Quality review/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("readCheckpoint returns content hash files as hash payloads", async () => {
  const repo = makeRepo();
  try {
    const file = await readCheckpoint(repo, "06/e2abdc1ec6/0/content_hash.txt");
    assert.equal(file.kind, "hash");
    assert.equal(file.parsed.algorithm, "sha256");
    assert.equal(file.parsed.value, "abc123");
    assert.equal(file.parse_error, null);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("readCheckpoint returns JSONL summary without parsing the whole file as JSON", async () => {
  const repo = makeRepo();
  try {
    const file = await readCheckpoint(repo, "06/e2abdc1ec6/0/full.jsonl");
    assert.equal(file.kind, "jsonl");
    assert.equal(file.line_count, 2);
    assert.equal(file.parsed.valid_lines, 2);
    assert.equal(file.parsed.invalid_lines, 0);
    assert.deepEqual(file.parsed.preview[0], { line: 1, value: { type: "start", id: 1 } });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("readCheckpoint returns json parse error payload for invalid JSON file without throwing", async () => {
  const repo = makeRepo();
  try {
    const badJsonPath = path.join(repo, "06", "e2abdc1ec6", "bad.json");
    const raw = '{"broken": }';
    fs.writeFileSync(badJsonPath, raw);
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-m", "add bad json"], { cwd: repo, stdio: "ignore" });

    const file = await readCheckpoint(repo, "06/e2abdc1ec6/bad.json");
    assert.equal(file.kind, "json");
    assert.equal(file.parsed, null);
    assert.equal(typeof file.parse_error, "string");
    assert.equal(file.raw, raw);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("readCheckpoint reports mixed-validity JSONL with value and error preview entries", async () => {
  const repo = makeRepo();
  try {
    const mixedJsonlPath = path.join(repo, "06", "e2abdc1ec6", "0", "mixed.jsonl");
    fs.writeFileSync(mixedJsonlPath, `${JSON.stringify({ ok: 1 })}\nnot json\n`);
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-m", "add mixed jsonl"], { cwd: repo, stdio: "ignore" });

    const file = await readCheckpoint(repo, "06/e2abdc1ec6/0/mixed.jsonl");
    assert.equal(file.kind, "jsonl");
    assert.equal(file.parsed.valid_lines, 1);
    assert.equal(file.parsed.invalid_lines, 1);
    assert.equal(file.parsed.preview.length, 2);
    assert.deepEqual(file.parsed.preview[0], { line: 1, value: { ok: 1 } });
    assert.equal(file.parsed.preview[1].line, 2);
    assert.equal(typeof file.parsed.preview[1].error, "string");
    assert.equal(file.parsed.preview[1].raw, "not json");
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("readCheckpoint caps JSONL preview at 50 entries for larger files", async () => {
  const repo = makeRepo();
  try {
    const longJsonlPath = path.join(repo, "06", "e2abdc1ec6", "0", "long.jsonl");
    const lines = Array.from({ length: 55 }, (_, i) => JSON.stringify({ id: i + 1 })).join("\n");
    fs.writeFileSync(longJsonlPath, `${lines}\n`);
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-m", "add long jsonl"], { cwd: repo, stdio: "ignore" });

    const file = await readCheckpoint(repo, "06/e2abdc1ec6/0/long.jsonl");
    assert.equal(file.kind, "jsonl");
    assert.equal(file.parsed.valid_lines, 55);
    assert.equal(file.parsed.invalid_lines, 0);
    assert.equal(file.parsed.preview.length, 50);
    assert.deepEqual(file.parsed.preview[0], { line: 1, value: { id: 1 } });
    assert.deepEqual(file.parsed.preview[49], { line: 50, value: { id: 50 } });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("readCheckpoint parses hash files without colon as value-only payload", async () => {
  const repo = makeRepo();
  try {
    const hashPath = path.join(repo, "06", "e2abdc1ec6", "0", "content_hash.txt");
    fs.writeFileSync(hashPath, "abc123-no-colon\n");
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-m", "hash without colon"], { cwd: repo, stdio: "ignore" });

    const file = await readCheckpoint(repo, "06/e2abdc1ec6/0/content_hash.txt");
    assert.equal(file.kind, "hash");
    assert.deepEqual(file.parsed, { algorithm: null, value: "abc123-no-colon" });
    assert.equal(file.parse_error, null);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test("readCheckpoint returns unknown kind for unsupported extension", async () => {
  const repo = makeRepo();
  try {
    const unknownPath = path.join(repo, "06", "e2abdc1ec6", "0", "blob.bin");
    fs.writeFileSync(unknownPath, "opaque\n");
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-m", "add unknown extension"], { cwd: repo, stdio: "ignore" });

    const file = await readCheckpoint(repo, "06/e2abdc1ec6/0/blob.bin");
    assert.equal(file.kind, "unknown");
    assert.equal(file.parsed, null);
    assert.equal(file.parse_error, null);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
