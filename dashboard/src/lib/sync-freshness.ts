import type { SyncStatus } from "./vibedeck-api";

const STALE_PARSE_MS = 15 * 60 * 1000;

function formatAgeMs(ms: number) {
  const safeMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const seconds = Math.floor(safeMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function getSyncFreshnessWarning(status: SyncStatus | null | undefined) {
  if (!status) return null;
  if (status.sync_enabled === false) {
    return "Local sync is disabled. Live data may be stale.";
  }
  const lastParseAt = typeof status.last_parse_at === "string" ? status.last_parse_at : "";
  if (!lastParseAt) return null;
  const parsed = Date.parse(lastParseAt);
  if (!Number.isFinite(parsed)) return null;
  const ageMs = Date.now() - parsed;
  if (ageMs <= STALE_PARSE_MS) return null;
  return `Local sync looks stale. Last parse was ${formatAgeMs(ageMs)} ago.`;
}
