import { useCallback, useEffect, useMemo, useState } from "react";
import { isAccessTokenReady, resolveAuthAccessToken } from "../lib/auth-token";
import { isMockEnabled } from "../lib/mock-data";
import { getProjectUsageSummary } from "../lib/api";
import { getTimeZoneCacheKey } from "../lib/timezone";
import { readLastGood, writeLastGood } from "../lib/last-good-cache";

export function useProjectUsageSummary({
  baseUrl,
  accessToken,
  limit = 3,
  sort = "recent",
  from,
  to,
  source,
  timeZone,
  tzOffsetMinutes,
}: any = {}) {
  const storageKey = useMemo(() => {
    const host = safeHost(baseUrl) || "default";
    const tzKey = getTimeZoneCacheKey({ timeZone, offsetMinutes: tzOffsetMinutes });
    const sourceKey = source || "all";
    return `projectUsage.${host}.${from || ""}.${to || ""}.${sourceKey}.${limit}.${sort}.${tzKey}`;
  }, [baseUrl, from, limit, sort, source, timeZone, to, tzOffsetMinutes]);
  const [entries, setEntries] = useState<any[]>(() => {
    const cached = readLastGood<{ entries?: any[] }>(storageKey);
    return Array.isArray(cached?.entries) ? cached.entries : [];
  });
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(() => {
    const cached = readLastGood<{ entries?: any[] }>(storageKey);
    return Array.isArray(cached?.entries) && cached.entries.length > 0;
  });
  const [error, setError] = useState<string | null>(null);
  const mockEnabled = isMockEnabled();
  const tokenReady = isAccessTokenReady(accessToken);

  const isLocalMode = typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

  const refresh = useCallback(async () => {
    const resolvedToken = await resolveAuthAccessToken(accessToken);

    if (!resolvedToken && !mockEnabled && !isLocalMode) {
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await getProjectUsageSummary({
        baseUrl,
        accessToken: resolvedToken,
        limit,
        sort,
        from,
        to,
        source,
        timeZone,
        tzOffsetMinutes,
      });
      const nextEntries = Array.isArray(res?.entries) ? res.entries : [];
      setEntries(nextEntries);
      writeLastGood(storageKey, { entries: nextEntries });
      setStale(false);
    } catch (err) {
      const message = (err as any)?.message || String(err);
      setError(message);
      const cached = readLastGood<{ entries?: any[] }>(storageKey);
      if (Array.isArray(cached?.entries)) {
        setEntries(cached.entries);
        setStale(true);
      }
    } finally {
      setLoading(false);
    }
  }, [accessToken, baseUrl, from, limit, mockEnabled, sort, source, storageKey, timeZone, to, tzOffsetMinutes, isLocalMode]);

  useEffect(() => {

    if (!tokenReady && !mockEnabled && !isLocalMode) {
      setError(null);
      setLoading(false);
      return;
    }
    const cached = readLastGood<{ entries?: any[] }>(storageKey);
    if (Array.isArray(cached?.entries)) {
      setEntries(cached.entries);
      setStale(true);
    }
    refresh();
  }, [mockEnabled, refresh, tokenReady, isLocalMode, storageKey]);

  const hasData = entries.length > 0;

  return {
    entries,
    loading,
    error,
    refresh,
    hasData,
    initialLoading: loading && !hasData,
    refreshing: loading && hasData,
    stale,
  };
}

function safeHost(baseUrl: any) {
  try {
    const url = new URL(baseUrl);
    return url.host;
  } catch (_e) {
    return null;
  }
}
