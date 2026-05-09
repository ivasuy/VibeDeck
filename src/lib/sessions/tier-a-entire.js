'use strict';

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

function toIsoOrNull(v) {
  if (v == null) return null;
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

function parseTimeMs(iso) {
  if (!isNonEmptyString(iso)) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function windowsOverlap(aStartMs, aEndMs, bStartMs, bEndMs) {
  if (aStartMs == null || aEndMs == null || bStartMs == null || bEndMs == null) return false;
  return aStartMs <= bEndMs && bStartMs <= aEndMs;
}

const PROVIDER_TO_ENTIRE_AGENT = {
  claude: 'claude-code',
  codex: 'codex',
  gemini: 'gemini',
  opencode: 'opencode',
  cursor: 'cursor',
};

function checkpointIdFrom(checkpoint, filePath) {
  if (checkpoint && isNonEmptyString(checkpoint.checkpoint_id)) return checkpoint.checkpoint_id;
  if (isNonEmptyString(filePath)) {
    const m = filePath.match(/[a-f0-9]{12}/);
    if (m) return m[0];
  }
  return null;
}

async function resolveBranchTierA({ repoRoot, provider, started_at, ended_at, bridge } = {}) {
  if (!isNonEmptyString(repoRoot)) throw new TypeError('resolveBranchTierA: repoRoot must be a non-empty string');
  if (!isNonEmptyString(provider)) throw new TypeError('resolveBranchTierA: provider must be a non-empty string');

  const startIso = toIsoOrNull(started_at);
  const endIso = toIsoOrNull(ended_at) || startIso;
  if (!startIso) throw new TypeError('resolveBranchTierA: started_at must be a non-empty ISO string');
  if (!endIso) throw new TypeError('resolveBranchTierA: ended_at must be a non-empty ISO string or null');

  const agent = PROVIDER_TO_ENTIRE_AGENT[provider] || provider;
  const impl = bridge || require('../entire-bridge');

  let detect;
  try {
    detect = await impl.detectEntire();
  } catch (err) {
    console.warn(
      `[vibedeck] WARN: tierA_entire_detect_error repoRoot=${repoRoot} provider=${provider} err=${String(
        err && (err.shortMessage || err.message) ? err.shortMessage || err.message : err,
      )}`,
    );
    return null;
  }
  if (!detect || detect.present !== true) return null;

  let list;
  try {
    list = await impl.listCheckpointsCached(repoRoot);
  } catch (err) {
    console.warn(
      `[vibedeck] WARN: tierA_entire_list_error repoRoot=${repoRoot} err=${String(
        err && (err.shortMessage || err.message) ? err.shortMessage || err.message : err,
      )}`,
    );
    return null;
  }
  if (!list || list.available !== true) return null;

  const ourStartMs = parseTimeMs(startIso);
  const ourEndMs = parseTimeMs(endIso);
  if (ourStartMs == null || ourEndMs == null) return null;

  const candidates = [];
  for (const filePath of list.files || []) {
    let checkpoint;
    try {
      checkpoint = await impl.readCheckpoint(repoRoot, filePath);
    } catch (err) {
      console.warn(
        `[vibedeck] WARN: tierA_entire_read_error repoRoot=${repoRoot} file=${filePath} err=${String(
          err && (err.shortMessage || err.message) ? err.shortMessage || err.message : err,
        )}`,
      );
      continue;
    }

    if (!checkpoint || checkpoint.agent !== agent) continue;
    if (!isNonEmptyString(checkpoint.branch) || !isNonEmptyString(checkpoint.entire_session_id)) continue;

    const theirStartMs = parseTimeMs(checkpoint.started_at);
    const theirEndMs = parseTimeMs(checkpoint.ended_at) || theirStartMs;
    if (!windowsOverlap(ourStartMs, ourEndMs, theirStartMs, theirEndMs)) continue;

    candidates.push({
      branch: checkpoint.branch,
      entire_session_id: checkpoint.entire_session_id,
      checkpoint_id: checkpointIdFrom(checkpoint, filePath),
      started_ms: theirStartMs,
    });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    const da = a.started_ms == null ? Number.POSITIVE_INFINITY : Math.abs(a.started_ms - ourStartMs);
    const db = b.started_ms == null ? Number.POSITIVE_INFINITY : Math.abs(b.started_ms - ourStartMs);
    if (da !== db) return da - db;
    return String(a.entire_session_id).localeCompare(String(b.entire_session_id));
  });

  const primary = candidates[0];
  const checkpoint_ids = candidates.map((c) => c.checkpoint_id).filter((v) => v != null);

  return {
    branch: primary.branch,
    entire_session_id: primary.entire_session_id,
    checkpoint_ids,
    confidence: candidates.length === 1 ? 'high' : 'medium',
  };
}

module.exports = { resolveBranchTierA };

