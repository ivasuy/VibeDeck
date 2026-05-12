import { useEffect, useMemo, useState } from "react";

type LiveSession = Record<string, any>;
type LiveSessionEvent = Record<string, any> & { type?: string };
type LiveSessionStatus = "idle" | "connecting" | "connected" | "degraded";
type LivePayloadState = {
  sessions: LiveSession[];
  workstreams: Record<string, any>[];
  totals: Record<string, any>;
  generatedAt: string | null;
  lastSyncAt: string | null;
  canonicalIncomplete: boolean;
  liveCanonical: Record<string, any> | null;
};

const EMPTY_TOTALS: Record<string, any> = {};
const EMPTY_STATE: LivePayloadState = {
  sessions: [],
  workstreams: [],
  totals: EMPTY_TOTALS,
  generatedAt: null,
  lastSyncAt: null,
  canonicalIncomplete: false,
  liveCanonical: null,
};

function isRecord(value: unknown): value is Record<string, any> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function sessionKey(row: LiveSession): string | null {
  const provider = row?.provider;
  const sessionId = row?.session_id;
  if (provider == null || sessionId == null) return null;
  return `${String(provider)}:${String(sessionId)}`;
}

function normalizeSessionState(row: LiveSession): LiveSession {
  if (typeof row.state === "string") return row;
  return { ...row, state: row.ended_at ? "ended" : "live" };
}

function isEndedSession(row: LiveSession): boolean {
  if (!isRecord(row)) return false;
  if (row.ended_at) return true;
  return typeof row.state === "string" && row.state.trim().toLowerCase() === "ended";
}

function eventPayload(event: LiveSessionEvent): LiveSession {
  if (isRecord(event.session)) return event.session;
  if (isRecord(event.payload)) return event.payload;
  const { type: _type, dropped: _dropped, ...payload } = event;
  return payload;
}

function sortKey(row: LiveSession): string {
  return String(row.last_observed_at || row.observed_at || row.ended_at || row.started_at || row.created_at || row.updated_at || "");
}

function sortByRecent(rows: LiveSession[]): LiveSession[] {
  return rows.slice().sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
}

export function reduceLiveSessionEvent(prev: LiveSession[], event: LiveSessionEvent): LiveSession[] {
  if (!isRecord(event)) return prev;
  if (event.type === "snapshot") {
    const snapshotRows = Array.isArray(event.sessions)
      ? event.sessions
      : (isRecord(event.data) && Array.isArray(event.data.sessions) ? event.data.sessions : []);
    return sortByRecent(
      snapshotRows
        .filter(isRecord)
        .map((row) => normalizeSessionState({ ...row }))
    );
  }

  if (
    event.type !== "session:start" &&
    event.type !== "session:update" &&
    event.type !== "session:end"
  ) {
    return prev;
  }

  const incoming = eventPayload(event);
  if (!isRecord(incoming)) return prev;
  const key = sessionKey(incoming);
  if (!key) return prev;

  const keyed = new Map<string, LiveSession>();
  const passthrough: LiveSession[] = [];
  for (const row of prev) {
    const rowKey = sessionKey(row);
    if (rowKey) keyed.set(rowKey, row);
    else passthrough.push(row);
  }

  const current = keyed.get(key) || {};
  if (event.type === "session:end") {
    const ended = normalizeSessionState({ ...current, ...incoming, state: "ended" });
    keyed.set(key, ended);
    return sortByRecent([...passthrough, ...keyed.values()]);
  }

  const merged = normalizeSessionState({ ...current, ...incoming, state: "live" });
  if (isEndedSession(merged)) keyed.delete(key);
  else keyed.set(key, merged);
  return sortByRecent([...passthrough, ...keyed.values()]);
}

export function reduceLivePayloadEvent(prev: LivePayloadState, event: LiveSessionEvent): LivePayloadState {
  if (!isRecord(event)) return prev;
  if (event.type === "snapshot" || event.type === "rollup:update") {
    return {
      sessions: reduceLiveSessionEvent(prev.sessions, { ...event, type: "snapshot" }),
      workstreams: Array.isArray(event.workstreams) ? event.workstreams.filter(isRecord) : prev.workstreams,
      totals: isRecord(event.totals) ? { ...event.totals } : prev.totals,
      generatedAt: typeof event.generated_at === "string" ? event.generated_at : prev.generatedAt,
      lastSyncAt: typeof event.last_sync_at === "string" ? event.last_sync_at : prev.lastSyncAt,
      canonicalIncomplete: Boolean(event.canonical_incomplete ?? prev.canonicalIncomplete),
      liveCanonical: isRecord(event.live_canonical) ? { ...event.live_canonical } : prev.liveCanonical,
    };
  }
  if (event.type === "rollup:error") return prev;
  return {
    ...prev,
    sessions: reduceLiveSessionEvent(prev.sessions, event),
  };
}

export function useVibeDeckLiveSessions({ enabled = true }: { enabled?: boolean } = {}) {
  const [payload, setPayload] = useState<LivePayloadState>(EMPTY_STATE);
  const [status, setStatus] = useState<LiveSessionStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      setError(null);
      return;
    }
    if (typeof EventSource === "undefined") return;

    setStatus("connecting");
    setError(null);
    const source = new EventSource("/functions/vibedeck-sessions-live");

    source.onopen = () => {
      setStatus("connected");
      setError(null);
    };

    source.onmessage = (event) => {
      try {
        const parsed = JSON.parse(String(event?.data ?? ""));
        setPayload((prev) => reduceLivePayloadEvent(prev, parsed));
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Invalid live session event";
        setStatus("degraded");
        setError(message);
      }
    };

    source.onerror = () => {
      setStatus("degraded");
      setError("Live session stream disconnected");
    };

    return () => {
      source.close();
    };
  }, [enabled]);

  return useMemo(() => ({
    ...payload,
    status,
    error,
  }), [payload, status, error]);
}
