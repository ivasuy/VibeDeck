'use strict';

const path = require("node:path");
const os = require("node:os");
const { ensureDir, readJsonStrict, writeJson } = require("../fs");

function resolveBootstrapRoot() {
  return process.env.VIBEDECK_HOME || path.join(os.homedir(), ".vibedeck");
}

function resolveBootstrapPaths() {
  const rootDir = resolveBootstrapRoot();
  return {
    rootDir,
    statePath: path.join(rootDir, "bootstrap.json"),
  };
}

async function readBootstrapState() {
  const { statePath } = resolveBootstrapPaths();
  const result = await readJsonStrict(statePath);

  if (result.status !== "ok") {
    return {
      native_app: { installed: false, path: null, version: null },
      entire: { installed: false, logged_in: false },
      pending: [],
    };
  }

  return result.value;
}

async function writeBootstrapState(state) {
  const { rootDir, statePath } = resolveBootstrapPaths();
  await ensureDir(rootDir);
  await writeJson(statePath, state);
}

async function mergeBootstrapState(patch) {
  const current = await readBootstrapState();
  const next = { ...current, ...patch };
  await writeBootstrapState(next);
  return next;
}

module.exports = {
  resolveBootstrapRoot,
  resolveBootstrapPaths,
  readBootstrapState,
  writeBootstrapState,
  mergeBootstrapState,
};
