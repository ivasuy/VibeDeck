import { useEffect, useMemo, useState } from "react";

type LiveSession = Record<string, any>;
type LiveSessionEvent = Record<string, any> & { type?: string };
type LiveSessionStatus = "idle" | "connecting" | "connected" | "degraded";

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

function eventPayload(event: LiveSessionEvent): LiveSession {
  if (isRecord(event.session)) return event.session;
  if (isRecord(event.payload)) return event.payload;
  return event;
}

function sortByRecent(rows: LiveSession[]): LiveSession[] {
  return rows.slice().sort((a, b) =>
    String(b.updated_at || b.last_observed_at || b.observed_at || b.started_at || "").localeCompare(
      String(a.updated_at || a.last_observed_at || a.observed_at || a.started_at || ""),
    ),
  );
}

export function reduceLiveSessionEvent(prev: LiveSession[], event: LiveSessionEvent): LiveSession[] {
  if (!isRecord(event)) return prev;
  if (event.type === "snapshot") {
    const snapshotRows = Array.isArray(event.sessions)
      ? event.sessions
      : (isRecord(event.data) && Array.isArray(event.data.sessions) ? event.data.sessions : []);
    return snapshotRows.filter(isRecord).map((row) => normalizeSessionState({ ...row }));
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
  const merged = normalizeSessionState({
    ...current,
    ...incoming,
    state: event.type === "session:end" ? "ended" : "live",
  });

  keyed.set(key, merged);
  return sortByRecent([...passthrough, ...keyed.values()]);
}

export function useVibeDeckLiveSessions({ enabled = true }: { enabled?: boolean } = {}) {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
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
        setSessions((prev) => reduceLiveSessionEvent(prev, parsed));
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

  return useMemo(() => ({ sessions, status, error }), [sessions, status, error]);
}
