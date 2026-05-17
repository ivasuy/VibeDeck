'use strict';

const { readBootstrapState } = require('./state');
const { readReadmeSyncConfig, readGitHubToken } = require('../readme-sync/config');
const { isInteractiveInstall } = require('./platform');
const { promptMenu } = require('../cli-ui');

const DEFAULT_PLATFORM = process.platform;

function isTruthy(value) {
  return Boolean(value);
}

function formatMissingPrimitives(missing) {
  return (missing || []).filter(Boolean);
}

function deriveMissingFromState({ state, readmeSyncConfig, githubToken }) {
  const missing = [];

  if (!state?.native_app?.installed) {
    missing.push("native_app");
  }

  if (!state?.entire?.installed) {
    missing.push("entire_install");
  } else if (!state?.entire?.logged_in) {
    missing.push("entire_login");
  }

  if (!readmeSyncConfig?.enabled || !isTruthy(githubToken)) {
    missing.push("readme_sync");
  }

  return formatMissingPrimitives(missing);
}

async function collectMissingPrerequisites({
  bootstrapState = null,
  readmeSyncConfig,
  githubToken,
  platform = DEFAULT_PLATFORM,
} = {}) {
  if (platform !== 'darwin') return [];

  const state = bootstrapState || (await readBootstrapState());
  const config = readmeSyncConfig === undefined ? await readReadmeSyncConfig() : readmeSyncConfig;
  const token = githubToken === undefined ? await readGitHubToken() : githubToken;

  return deriveMissingFromState({
    state,
    readmeSyncConfig: config,
    githubToken: token,
  });
}

function buildBootstrapPromptMessage(missing) {
  return [
    "The following VibeDeck prerequisites are not fully configured:",
    ...missing.map((item) => `  - ${item}`),
    "",
    "Would you like to fix these missing prerequisites now?",
  ].join("\n");
}

async function defaultPrompt(message) {
  const choice = await promptMenu({
    message,
    options: [
      "Continue without setup",
      "Fix missing prerequisites now",
    ],
    defaultIndex: 0,
  });
  return choice === "Fix missing prerequisites now";
}

async function runFirstRunBootstrapIfNeeded({
  promptImpl = defaultPrompt,
  isInteractive = null,
  fixers = {},
  missing = null,
  platform = DEFAULT_PLATFORM,
} = {}) {
  const missingItems = Array.isArray(missing)
    ? formatMissingPrimitives(missing)
    : await collectMissingPrerequisites({ platform });
  if (missingItems.length === 0) {
    return { prompted: false, missing: [] };
  }

  const interactive = isInteractive === null ? isInteractiveInstall() : Boolean(isInteractive);
  if (!interactive) {
    return { prompted: false, missing: missingItems };
  }

  const promptMessage = buildBootstrapPromptMessage(missingItems);
  const response = await promptImpl(promptMessage);
  if (!response) {
    return {
      prompted: true,
      accepted: false,
      missing: missingItems,
      response,
    };
  }

  for (const item of missingItems) {
    if (typeof fixers[item] === "function") {
      await fixers[item]();
    }
  }

  return {
    prompted: true,
    accepted: true,
    missing: missingItems,
    response,
  };
}

module.exports = {
  collectMissingPrerequisites,
  runFirstRunBootstrapIfNeeded,
};
