const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const hookSignature = require("../src/lib/hook-merger/signature");
const { runDoctorChecks } = require("../src/lib/doctor");

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vd-doctor-hooks-"));
}

async function withHome(home, fn) {
  const prev = process.env.HOME;
  process.env.HOME = home;
  try {
    return await fn();
  } finally {
    process.env.HOME = prev;
  }
}

function writeJson(filePath, json) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(json, null, 2));
}

test("runDoctorChecks includes a hook-integrity check per supported provider", async () => {
  const home = tmpDir();
  const checks = await withHome(home, () =>
    runDoctorChecks({ runtime: { baseUrl: null }, paths: {}, fetch: () => Promise.resolve({}), home }),
  );
  const hookChecks = checks.filter((c) => /^hook:\w+/.test(String(c?.id || "")));
  assert.ok(hookChecks.length >= 5);
});

test('hook-integrity check status is "ok" when signature is present in settings', async () => {
  const home = tmpDir();
  const expected = await withHome(home, () => hookSignature.canonicalCommandPath());
  writeJson(path.join(home, ".claude", "settings.json"), {
    hooks: {
      SessionEnd: [{ _vibedeck: "v1", command: `node ${expected}` }],
    },
  });

  const checks = await withHome(home, () =>
    runDoctorChecks({ runtime: { baseUrl: null }, paths: {}, fetch: () => Promise.resolve({}), home }),
  );
  const check = checks.find((c) => c?.id === "hook:claude");
  assert.ok(check);
  assert.equal(check.status, "ok");
});

test('hook-integrity check status is "info" when no signature present (uninstalled)', async () => {
  const home = tmpDir();
  writeJson(path.join(home, ".claude", "settings.json"), {
    hooks: {
      SessionEnd: [{ command: "echo not vibedeck" }],
    },
  });

  const checks = await withHome(home, () =>
    runDoctorChecks({ runtime: { baseUrl: null }, paths: {}, fetch: () => Promise.resolve({}), home }),
  );
  const check = checks.find((c) => c?.id === "hook:claude");
  assert.ok(check);
  assert.equal(check.status, "info");
});

test('hook-integrity check status is "warn" when signature present but command path mismatched', async () => {
  const home = tmpDir();
  writeJson(path.join(home, ".claude", "settings.json"), {
    hooks: {
      SessionEnd: [{ _vibedeck: "v1", command: "node /stale/notify.cjs" }],
    },
  });

  const checks = await withHome(home, () =>
    runDoctorChecks({ runtime: { baseUrl: null }, paths: {}, fetch: () => Promise.resolve({}), home }),
  );
  const check = checks.find((c) => c?.id === "hook:claude");
  assert.ok(check);
  assert.equal(check.status, "warn");
});
