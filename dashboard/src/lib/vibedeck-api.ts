import { getLocalApiAuthHeaders } from "./local-api-auth";
import { copy } from "./copy";

type AnyRecord = Record<string, any>;
type FetchImpl = typeof fetch;

function normalizeApiErrorCode(payload: AnyRecord | null) {
  const raw = payload?.error ?? payload?.code ?? payload?.reason;
  return typeof raw === "string" ? raw.trim() : "";
}

function knownApiErrorMessage(code: string) {
  if (code === "db_unavailable") return copy("vibedeck.api.error.db_unavailable");
  if (code === "too_many_clients") return copy("vibedeck.api.error.too_many_clients");
  if (code === "not_installed") return copy("vibedeck.api.error.not_installed");
  if (code === "not_enabled") return copy("vibedeck.api.error.not_enabled");
  if (code === "enabled_no_commits") return copy("vibedeck.api.error.enabled_no_commits");
  if (code === "active") return copy("vibedeck.api.error.active");
  if (code === "branch_not_fetched") return copy("vibedeck.api.error.branch_not_fetched");
  if (code === "git_error") return copy("vibedeck.api.error.git_error");
  if (code === "invalid_repo") return copy("vibedeck.api.error.invalid_repo");
  if (code === "invalid_path") return copy("vibedeck.api.error.invalid_path");
  if (code === "missing_repo") return copy("vibedeck.api.error.missing_repo");
  if (code === "missing_confirm_token") return copy("vibedeck.api.error.missing_confirm_token");
  if (code === "invalid_confirm_token") return copy("vibedeck.api.error.invalid_confirm_token");
  if (code === "unknown_command") return copy("vibedeck.api.error.unknown_command");
  if (code === "session_not_found") return copy("vibedeck.api.error.session_not_found");
  return "";
}

function resolveApiErrorMessage(payload: AnyRecord | null, status: number) {
  const code = normalizeApiErrorCode(payload);
  const knownMessage = code ? knownApiErrorMessage(code) : "";
  if (knownMessage) return knownMessage;
  const message = typeof payload?.message === "string" ? payload.message.trim() : "";
  if (message) return message;
  if (code) return code;
  return `Request failed with HTTP ${status}`;
}

export type BranchUsageParams = {
  from?: string;
  to?: string;
  repo?: string;
  branch?: string;
  limit?: number;
  includeSessions?: boolean;
  includeArchived?: boolean;
  includeGitBranches?: boolean;
  includeDateBuckets?: boolean;
  sessionDate?: string;
};

export type SyncStatus = {
  last_parse_at?: string | null;
  queue_updated_at?: string | null;
  project_queue_updated_at?: string | null;
  session_count?: number;
  open_session_count?: number;
  sync_enabled?: boolean;
  canonical_db_updated_at?: string | null;
  canonical_event_count?: number;
  canonical_bucket_count?: number;
  session_rows_missing_cost?: number;
  unattributed_session_count?: number;
};

function origin() {
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return "http://127.0.0.1";
}

async function jsonOrThrow<T = any>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    const error: any = new Error(resolveApiErrorMessage(payload, response.status));
    error.code = normalizeApiErrorCode(payload);
    error.status = response.status;
    throw error;
  }
  return payload as T;
}

function query(path: string, params: AnyRecord = {}) {
  const url = new URL(`/functions/${path}`, origin());
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}

const readOptions = {
  headers: { Accept: "application/json" },
  cache: "no-store" as const,
};

export function getAttributionStats(fetchImpl: FetchImpl = fetch) {
  return fetchImpl("/functions/vibedeck-attribution-stats", readOptions).then(jsonOrThrow);
}

export function getSyncStatus(fetchImpl: FetchImpl = fetch) {
  return fetchImpl("/functions/vibedeck-sync-status", readOptions).then(jsonOrThrow<SyncStatus>);
}

export function getBranchUsage(params: BranchUsageParams = {}, fetchImpl: FetchImpl = fetch) {
  const { includeSessions, includeArchived, includeGitBranches, includeDateBuckets, sessionDate, ...rest } = params;
  return fetchImpl(
    query("vibedeck-branch-usage", {
      ...rest,
      include_sessions: includeSessions ? "1" : undefined,
      include_archived: includeArchived ? "1" : undefined,
      include_git_branches: includeGitBranches ? "1" : undefined,
      include_date_buckets: includeDateBuckets ? "1" : undefined,
      session_date: sessionDate,
    }),
    readOptions,
  ).then(jsonOrThrow);
}

export function getKnownRepos(params: { limit?: number } = {}, fetchImpl: FetchImpl = fetch) {
  return fetchImpl(query("vibedeck-known-repos", params), readOptions).then(jsonOrThrow);
}

export function hideKnownRepo(repo: string, fetchImpl: FetchImpl = fetch) {
  return postVibeDeckJson("vibedeck-known-repos/hide", { repo }, fetchImpl);
}

export function getEntireStatus(repo: string, fetchImpl: FetchImpl = fetch) {
  return fetchImpl(query("vibedeck-entire-status", { repo, cached: "1" }), readOptions).then(jsonOrThrow);
}

export function getCheckpoints(repo: string, fetchImpl: FetchImpl = fetch) {
  return fetchImpl(query("vibedeck-checkpoints", { repo }), readOptions).then(jsonOrThrow);
}

export function getCheckpoint(repo: string, path: string, fetchImpl: FetchImpl = fetch) {
  return fetchImpl(query("vibedeck-checkpoint", { repo, path }), readOptions).then(jsonOrThrow);
}

export async function postVibeDeckJson(path: string, body: AnyRecord = {}, fetchImpl: FetchImpl = fetch) {
  const authHeaders = await getLocalApiAuthHeaders(fetchImpl);
  const response = await fetchImpl(`/functions/${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders,
    },
    cache: "no-store",
    body: JSON.stringify(body || {}),
  });
  return jsonOrThrow(response);
}

export function postAttribute(body: AnyRecord, fetchImpl: FetchImpl = fetch) {
  return postVibeDeckJson("vibedeck-attribute", body, fetchImpl);
}

export function postEntireCommand(cmd: string, body: AnyRecord = {}, fetchImpl: FetchImpl = fetch) {
  return postVibeDeckJson(`vibedeck-entire/${cmd}`, body, fetchImpl);
}

export function confirmDestructive(op: string, fetchImpl: FetchImpl = fetch) {
  return postVibeDeckJson("vibedeck-confirm-destructive", { op }, fetchImpl);
}
