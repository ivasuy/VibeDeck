const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { maybeRunPostSyncReadmeUpdate, runReadmeSyncUpdate } = require("../src/lib/readme-sync/service");

const rolloutPath = path.resolve(__dirname, "../src/lib/rollout.js");
const progressPath = path.resolve(__dirname, "../src/lib/progress.js");
const cursorConfigPath = path.resolve(__dirname, "../src/lib/cursor-config.js");
const projectUsagePurgePath = path.resolve(__dirname, "../src/lib/project-usage-purge.js");
const trackerPathsPath = path.resolve(__dirname, "../src/lib/tracker-paths.js");
const dbPath = path.resolve(__dirname, "../src/lib/db.js");
const reaperPath = path.resolve(__dirname, "../src/lib/sessions/reaper.js");
const idleTimeoutPath = path.resolve(__dirname, "../src/lib/sessions/idle-timeout.js");
const pipelinePath = path.resolve(__dirname, "../src/lib/sessions/pipeline.js");
const reconciliationPath = path.resolve(__dirname, "../src/lib/sessions/reconciliation.js");
const readmeSyncServicePath = path.resolve(__dirname, "../src/lib/readme-sync/service.js");
const readmeSyncFsPath = path.resolve(__dirname, "../src/lib/fs.js");

function resetModuleCache(entries) {
  for (const entry of entries) {
    if (entry.original === undefined) {
      delete require.cache[entry.path];
      continue;
    }
    require.cache[entry.path] = entry.original;
  }
}

function stubModule(path, exports) {
  const original = require.cache[path];
  require.cache[path] = {
    exports,
    filename: path,
    id: path,
    loaded: true,
    children: [],
  };
  return { path, original };
}

function buildSyncModuleStubs({ trackerDir, readmeSyncResult, onReadmeSyncRun = async () => readmeSyncResult }) {
  const zeroResult = {
    filesProcessed: 0,
    eventsAggregated: 0,
    bucketsQueued: 0,
  };
  const stubbed = [];

  stubbed.push(stubModule(readmeSyncFsPath, {
    ensureDir: async () => {},
    readJson: async () => ({}),
    writeJson: async () => {},
    openLock: async () => ({ release: async () => {} }),
    readJsonStrict: async () => ({ status: "missing", value: null, error: null }),
    chmod600IfPossible: async () => {},
  }));

  stubbed.push(stubModule(rolloutPath, {
    parseRolloutIncremental: async () => ({ ...zeroResult }),
    parseClaudeIncremental: async () => ({ ...zeroResult }),
    parseGeminiIncremental: async () => ({ ...zeroResult }),
    parseOpencodeIncremental: async () => ({ ...zeroResult }),
    parseOpencodeDbIncremental: async () => ({ ...zeroResult }),
    parseOpenclawIncremental: async () => ({ ...zeroResult }),
    parseCursorApiIncremental: async () => ({ ...zeroResult }),
    parseKiroIncremental: async () => ({ ...zeroResult }),
    parseHermesIncremental: async () => ({ ...zeroResult }),
    parseCopilotIncremental: async () => ({ ...zeroResult }),
    parseKimiIncremental: async () => ({ ...zeroResult }),
    parseOmpIncremental: async () => ({ ...zeroResult }),
    parsePiIncremental: async () => ({ ...zeroResult }),
    parseCraftIncremental: async () => ({ ...zeroResult }),
    parseCodebuddyIncremental: async () => ({ ...zeroResult }),
    parseKiroCliIncremental: async () => ({ ...zeroResult }),
    listRolloutFiles: async () => [],
    listClaudeProjectFiles: async () => [],
    listGeminiSessionFiles: async () => [],
    listOpencodeMessageFiles: async () => [],
    readOpencodeDbMessages: () => [],
    resolveKiroDbPath: () => "",
    resolveKiroJsonlPath: () => "",
    resolveHermesDbPath: () => "",
    resolveCopilotOtelPaths: () => [],
    resolveKimiWireFiles: () => [],
    resolveOmpSessionFiles: () => [],
    piAgentDirCollidesWithOmp: () => false,
    resolvePiSessionFiles: () => [],
    resolveCraftSessionFiles: () => [],
    resolveCodebuddyProjectFiles: () => [],
    resolveKiroCliSessionFiles: () => [],
    resolveKiroCliDbPath: () => "",
  }));

  stubbed.push(stubModule(progressPath, {
    createProgress: () => ({
      start: () => {},
      update: () => {},
      stop: () => {},
      enabled: true,
    }),
    renderBar: () => "[renderBar]",
    formatNumber: (value) => String(value),
    formatBytes: (value) => `${value}`,
  }));

  stubbed.push(stubModule(cursorConfigPath, {
    isCursorInstalled: () => false,
    extractCursorSessionToken: () => null,
    fetchCursorUsageCsv: async () => "",
    parseCursorCsv: () => [],
  }));

  stubbed.push(stubModule(projectUsagePurgePath, {
    purgeProjectUsage: async () => {},
  }));

  stubbed.push(stubModule(trackerPathsPath, {
    resolveTrackerPaths: async () => ({ trackerDir }),
  }));

  stubbed.push(stubModule(dbPath, {
    ensureSchema: async () => {},
  }));

  stubbed.push(stubModule(reaperPath, {
    reapOrphanedSessions: async () => ({ reaped: 0 }),
  }));

  stubbed.push(stubModule(idleTimeoutPath, {
    getIdleTimeoutMin: () => 30,
  }));

  stubbed.push(stubModule(pipelinePath, {
    processSessionEvent: async () => {},
    recoverActiveSessionMetadata: async () => {},
  }));

  stubbed.push(stubModule(reconciliationPath, {
    reconcileCanonicalUsage: () => ({}),
  }));

  stubbed.push(stubModule(readmeSyncServicePath, {
    maybeRunPostSyncReadmeUpdate: async (...args) => {
      const result = await onReadmeSyncRun(...args);
      return { ...readmeSyncResult, ...(result || {}) };
    },
  }));

  return stubbed;
}

test("disabled config skips the updater", async () => {
  const result = await maybeRunPostSyncReadmeUpdate({
    config: { enabled: false },
    token: null,
    updateImpl: async () => {
      throw new Error("should not run");
    },
  });

  assert.deepEqual(result, {
    attempted: false,
    ok: true,
    skipped: "disabled",
    warning: null,
  });
});

test("github failures are downgraded to warnings", async () => {
  const result = await maybeRunPostSyncReadmeUpdate({
    config: { enabled: true },
    token: "ghp_token",
    updateImpl: async () => {
      throw new Error("GitHub PUT failed (401)");
    },
  });

  assert.equal(result.attempted, true);
  assert.equal(result.ok, false);
  assert.equal(result.skipped, null);
  assert.match(result.warning, /GitHub PUT failed/);
});

test("runReadmeSyncUpdate writes banner and pushes README when configured", async () => {
  let bannerPath = null;
  let bannerContent = null;
  let updateArgs = null;
  const result = await runReadmeSyncUpdate({
    config: {
      enabled: true,
      repo_owner: "ivasuy",
      repo_name: "vibedeck",
      branch: "main",
      readme_path: "README.md",
      svg_path: "github-readme-banner.svg",
    },
    token: "ghp_token",
    buildBannerData: async () => ({ test: true }),
    renderSvg: () => "<svg />",
    writeBanner: async (filePath, content) => {
      bannerPath = filePath;
      bannerContent = content;
    },
    pushBannerAndReadmeImpl: async (payload) => {
      updateArgs = payload;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.repo, "ivasuy/vibedeck");
  assert.equal(result.branch, "main");
  assert.equal(result.readme_path, "README.md");
  assert.equal(bannerPath.includes("github-readme-banner.svg"), true);
  assert.equal(bannerContent, "<svg />\n");
  assert.deepEqual(updateArgs.config, {
    enabled: true,
    repo_owner: "ivasuy",
    repo_name: "vibedeck",
    branch: "main",
    readme_path: "README.md",
      svg_path: "github-readme-banner.svg",
  });
  assert.equal(updateArgs.token, "ghp_token");
  assert.equal(updateArgs.svg, "<svg />");
});

test("cmdSync invokes post-sync README updater through sync command path", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "vibedeck-sync-readme-hook-"));
  const prevHome = process.env.HOME;
  const trackerDir = path.join(tmp, ".vibedeck", "tracker");

  let out = "";
  const prevStdout = process.stdout.write;
  let readmeHookCalled = 0;

  const serviceResult = {
    attempted: true,
    ok: true,
    skipped: null,
    warning: null,
  };
  const stubs = buildSyncModuleStubs({
    trackerDir,
    readmeSyncResult: serviceResult,
    onReadmeSyncRun: async () => {
      readmeHookCalled += 1;
      return serviceResult;
    },
  });
  const syncModule = require.resolve("../src/commands/sync");

  try {
    process.env.HOME = tmp;
    process.stdout.write = (chunk) => {
      out += String(chunk || "");
      return true;
    };

    delete require.cache[syncModule];
    const { cmdSync } = require(syncModule);
    await cmdSync([]);
  } finally {
    process.stdout.write = prevStdout;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    resetModuleCache(stubs);
    delete require.cache[syncModule];
    await fs.rm(tmp, { recursive: true, force: true });
  }

  assert.equal(readmeHookCalled, 1);
  assert.match(out, /- README banner updated on GitHub/);
});

test("cmdSync keeps sync success when readme update returns warning", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "vibedeck-sync-readme-fail-"));
  const prevHome = process.env.HOME;
  const trackerDir = path.join(tmp, ".vibedeck", "tracker");

  let err = "";
  const prevStderr = process.stderr.write;
  const stubs = buildSyncModuleStubs({
    trackerDir,
    readmeSyncResult: {
      attempted: true,
      ok: false,
      skipped: null,
      warning: "GitHub PUT failed (401)",
    },
  });

  const syncModule = require.resolve("../src/commands/sync");

  try {
    process.env.HOME = tmp;
    process.stderr.write = (chunk) => {
      err += String(chunk || "");
      return true;
    };
    delete require.cache[syncModule];
    const { cmdSync } = require(syncModule);
    await assert.doesNotReject(() => cmdSync([]));
  } finally {
    process.stderr.write = prevStderr;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    resetModuleCache(stubs);
    delete require.cache[syncModule];
    await fs.rm(tmp, { recursive: true, force: true });
  }

  assert.match(err, /README sync warning: GitHub PUT failed \(401\)/);
});
