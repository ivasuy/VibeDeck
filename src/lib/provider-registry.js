"use strict";

const PROVIDERS = Object.freeze({
  claude: { id: "claude", displayName: "Claude Code", sourceScope: "local", phase: 1 },
  codex: { id: "codex", displayName: "Codex", sourceScope: "local", phase: 1 },
  "every-code": { id: "every-code", displayName: "EveryCode", sourceScope: "local", phase: 1 },
  opencode: { id: "opencode", displayName: "OpenCode", sourceScope: "local", phase: 2, attribution: "cwd_proven" },
  goose: { id: "goose", displayName: "Goose", sourceScope: "local", phase: 2, attribution: "cwd_proven" },
  crush: { id: "crush", displayName: "Crush", sourceScope: "local", phase: 2, attribution: "cwd_proven" },
  pi: { id: "pi", displayName: "Pi", sourceScope: "local", phase: 2, attribution: "cwd_proven" },
  omp: { id: "omp", displayName: "OMP", sourceScope: "local", phase: 2, attribution: "cwd_proven" },
  cursor: { id: "cursor", displayName: "Cursor", sourceScope: "account", phase: 2, attribution: "account_level" },
  copilot: {
    id: "copilot",
    displayName: "GitHub Copilot",
    sourceScope: "local",
    phase: 2,
    attribution: "workspace_mapped",
  },
  kiro: { id: "kiro", displayName: "Kiro", sourceScope: "local", phase: 2, attribution: "workspace_mapped" },
  gemini: { id: "gemini", displayName: "Gemini", sourceScope: "local", phase: 3, attribution: "provider_only" },
  openclaw: { id: "openclaw", displayName: "OpenClaw", sourceScope: "local", phase: 3, attribution: "provider_only" },
  droid: { id: "droid", displayName: "Droid", sourceScope: "local", phase: 3, attribution: "cwd_proven" },
  qwen: { id: "qwen", displayName: "Qwen", sourceScope: "local", phase: 3, attribution: "cwd_optional" },
  "cursor-agent": {
    id: "cursor-agent",
    displayName: "Cursor Agent",
    sourceScope: "local",
    phase: 3,
    attribution: "provider_only",
  },
  antigravity: {
    id: "antigravity",
    displayName: "Antigravity",
    sourceScope: "local",
    phase: 3,
    attribution: "provider_only",
  },
  "ibm-bob": { id: "ibm-bob", displayName: "IBM Bob", sourceScope: "local", phase: 3, attribution: "cwd_optional" },
  roo: { id: "roo", displayName: "Roo Code", sourceScope: "local", phase: 3, attribution: "cwd_optional" },
  kilocode: { id: "kilocode", displayName: "KiloCode", sourceScope: "local", phase: 3, attribution: "cwd_optional" },
  hermes: { id: "hermes", displayName: "Hermes", sourceScope: "local", phase: 3, attribution: "provider_only" },
  kimi: { id: "kimi", displayName: "Kimi", sourceScope: "local", phase: 3, attribution: "provider_only" },
  codebuddy: { id: "codebuddy", displayName: "CodeBuddy", sourceScope: "local", phase: 3, attribution: "provider_only" },
  craft: { id: "craft", displayName: "Craft", sourceScope: "local", phase: 3, attribution: "workspace_mapped" },
});

function normalizeProviderId(value) {
  return String(value || "").trim().toLowerCase();
}

function getProviderMetadata(value) {
  const id = normalizeProviderId(value);
  return (
    PROVIDERS[id] || {
      id: id || "unknown",
      displayName: id || "Unknown",
      sourceScope: "local",
      phase: null,
      attribution: "provider_only",
    }
  );
}

function listProviders() {
  return Object.values(PROVIDERS).map((provider) => ({ ...provider }));
}

function isAbsoluteLocalPath(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return false;
  if (text.startsWith("file://")) return true;
  if (text.startsWith("/")) return true;
  return /^[A-Za-z]:[\\/]/.test(text);
}

function attributionQualityForCwd(cwd) {
  return isAbsoluteLocalPath(cwd) ? "cwd_proven" : "provider_only";
}

module.exports = {
  PROVIDERS,
  normalizeProviderId,
  getProviderMetadata,
  listProviders,
  isAbsoluteLocalPath,
  attributionQualityForCwd,
};
