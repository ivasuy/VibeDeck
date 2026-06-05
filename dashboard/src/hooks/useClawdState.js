import { useMemo } from "react";

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function isRecent(timestamp, windowMs) {
  if (!timestamp) return false;
  const ts = typeof timestamp === "number" ? timestamp : Date.parse(String(timestamp));
  return Number.isFinite(ts) && Date.now() - ts >= 0 && Date.now() - ts <= windowMs;
}

export function resolveClawdState({
  activeSessionCount = 0,
  activeOperation = "",
  isSyncing = false,
  hasError = false,
  isDisconnected = false,
  hasLowConfidence = false,
  syncFailed = false,
  syncSucceededAt = null,
  idleMinutes = 0,
} = {}) {
  const sessions = toCount(activeSessionCount);
  const operation = String(activeOperation || "").toLowerCase();
  const idle = toCount(idleMinutes);

  if (hasError || syncFailed) return "error";
  if (isDisconnected) return "disconnected";
  if (isRecent(syncSucceededAt, 3000)) return "mini-happy";
  if (hasLowConfidence) return "working-confused";
  if (isSyncing) return "working-typing";
  if (operation.includes("rebuild") || operation.includes("build")) return "working-building";
  if (operation.includes("optimize") || operation.includes("scan")) return "working-thinking";
  if (operation.includes("subscription") || operation.includes("plan") || operation.includes("forecast")) return "working-wizard";
  if (operation.includes("heavy") || operation.includes("ultrathink")) return "working-ultrathink";

  if (sessions >= 4) return "working-overheated";
  if (sessions >= 2) return "working-juggling";
  if (sessions === 1) return "working-typing";

  if (idle >= 30) return "sleeping";
  if (idle >= 10) return "idle-doze";

  return "idle-living";
}

/**
 * Resolves the appropriate Clawd animation state based on product state.
 *
 * Priority chain (high → low):
 * 1. Status overrides: error/disconnected/sync result
 * 2. Active operations and attribution confidence
 * 3. Active session count
 * 4. Idle duration
 *
 * @param {object} opts
 * @param {number} opts.activeSessionCount - Number of live sessions.
 * @param {string} opts.activeOperation - Current operation label.
 * @param {number} opts.todayTokens - Today's total token count, retained for legacy callers.
 * @param {boolean} opts.isSyncing - Whether data is currently syncing
 * @param {boolean} opts.hasError - Whether there's an error state
 * @param {boolean} opts.isDisconnected - Whether server is disconnected
 * @param {boolean} opts.hasLowConfidence - Whether attribution is confused.
 * @param {boolean} opts.syncFailed - Whether the latest sync failed.
 * @param {string|number|null} opts.syncSucceededAt - Timestamp of the last successful sync.
 * @param {number} opts.idleMinutes - Minutes since local work was observed.
 * @returns {string} Clawd animation state name
 */
export function useClawdState(opts = {}) {
  const {
    activeSessionCount,
    activeOperation,
    todayTokens,
    isSyncing,
    hasError,
    isDisconnected,
    hasLowConfidence,
    syncFailed,
    syncSucceededAt,
    idleMinutes,
  } = opts;

  return useMemo(() => resolveClawdState({
    activeSessionCount,
    activeOperation,
    todayTokens,
    isSyncing,
    hasError,
    isDisconnected,
    hasLowConfidence,
    syncFailed,
    syncSucceededAt,
    idleMinutes,
  }), [
    activeSessionCount,
    activeOperation,
    todayTokens,
    isSyncing,
    hasError,
    isDisconnected,
    hasLowConfidence,
    syncFailed,
    syncSucceededAt,
    idleMinutes,
  ]);
}
