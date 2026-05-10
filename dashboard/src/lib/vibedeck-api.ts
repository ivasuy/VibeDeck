import { getLocalApiAuthHeaders } from "./local-api-auth";

type AnyRecord = Record<string, any>;
type FetchImpl = typeof fetch;

export type BranchUsageParams = {
  from?: string;
  to?: string;
  repo?: string;
  branch?: string;
  limit?: number;
  includeSessions?: boolean;
};

function origin() {
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return "http://127.0.0.1";
}

async function jsonOrThrow<T = any>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.ok === false) {
    const error: any = new Error(
      payload?.error || payload?.message || `Request failed with HTTP ${response.status}`,
    );
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

export function getBranchUsage(params: BranchUsageParams = {}, fetchImpl: FetchImpl = fetch) {
  const { includeSessions, ...rest } = params;
  return fetchImpl(
    query("vibedeck-branch-usage", {
      ...rest,
      include_sessions: includeSessions ? "1" : undefined,
    }),
    readOptions,
  ).then(jsonOrThrow);
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
