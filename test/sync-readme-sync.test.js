const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { runReadmeSyncUpdate } = require("../src/lib/readme-sync/service");

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

function stubModule(modulePath, exports) {
  const original = require.cache[modulePath];
  require.cache[modulePath] = {
    exports,
    filename: modulePath,
    id: modulePath,
    loaded: true,
    children: [],
  };
  return { path: modulePath, original };
}

function buildSyncModuleStubs({ trackerDir }) {
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

  return stubbed;
}

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

test("cmdSync does not import or invoke the readme-sync service", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "vibedeck-sync-readme-decoupled-"));
  const prevHome = process.env.HOME;
  const trackerDir = path.join(tmp, ".vibedeck", "tracker");

  let out = "";
  let err = "";
  const prevStdout = process.stdout.write;
  const prevStderr = process.stderr.write;
  const stubs = buildSyncModuleStubs({ trackerDir });
  const syncModule = require.resolve("../src/commands/sync");

  try {
    process.env.HOME = tmp;
    process.stdout.write = (chunk) => {
      out += String(chunk || "");
      return true;
    };
    process.stderr.write = (chunk) => {
      err += String(chunk || "");
      return true;
    };

    delete require.cache[syncModule];
    const { cmdSync } = require(syncModule);
    await cmdSync([]);
  } finally {
    process.stdout.write = prevStdout;
    process.stderr.write = prevStderr;
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    resetModuleCache(stubs);
    delete require.cache[syncModule];
    await fs.rm(tmp, { recursive: true, force: true });
  }

  assert.doesNotMatch(out, /README banner updated on GitHub/);
  assert.doesNotMatch(err, /README sync warning/);
});
