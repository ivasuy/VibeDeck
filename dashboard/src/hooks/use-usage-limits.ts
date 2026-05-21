import { useCallback, useEffect, useRef, useState } from "react";
import { getUsageLimits } from "../lib/api";
import { readLastGood, writeLastGood } from "../lib/last-good-cache";

interface ProviderStatusState {
  configured: boolean;
  error?: string | null;
  status?: string | null;
  raw_error?: string | null;
  retry_after_seconds?: number | null;
}

interface UsageLimitsData {
  fetched_at: string;
  claude: ProviderStatusState & { five_hour?: { utilization: number; resets_at?: string }; seven_day?: { utilization: number; resets_at?: string }; seven_day_opus?: { utilization: number; resets_at?: string } | null; extra_usage?: { is_enabled: boolean; monthly_limit?: number | null; used_credits?: number | null; currency?: string | null } | null };
  codex: ProviderStatusState & { primary_window?: { used_percent: number; reset_at?: number; limit_window_seconds?: number } | null; secondary_window?: { used_percent: number; reset_at?: number; limit_window_seconds?: number } | null };
  cursor: ProviderStatusState & { membership_type?: string | null; primary_window?: { used_percent: number; reset_at?: string | null } | null; secondary_window?: { used_percent: number; reset_at?: string | null } | null; tertiary_window?: { used_percent: number; reset_at?: string | null } | null };
  gemini: ProviderStatusState & { account_email?: string | null; account_plan?: string | null; primary_window?: { used_percent: number; reset_at?: string | null } | null; secondary_window?: { used_percent: number; reset_at?: string | null } | null; tertiary_window?: { used_percent: number; reset_at?: string | null } | null };
  kimi: ProviderStatusState & { membership_level?: string | null; subscription_type?: string | null; parallel_limit?: number | null; primary_window?: { used_percent: number; reset_at?: string | null } | null; secondary_window?: { used_percent: number; reset_at?: string | null } | null; tertiary_window?: { used_percent: number; reset_at?: string | null } | null };
  kiro: ProviderStatusState & { plan_name?: string | null; primary_window?: { used_percent: number; reset_at?: string | null } | null; secondary_window?: { used_percent: number; reset_at?: string | null } | null };
  antigravity: ProviderStatusState & { account_email?: string | null; account_plan?: string | null; primary_window?: { used_percent: number; reset_at?: string | null } | null; secondary_window?: { used_percent: number; reset_at?: string | null } | null; tertiary_window?: { used_percent: number; reset_at?: string | null } | null };
}

function hasProviderCooldown(snapshot: UsageLimitsData | null) {
  if (!snapshot?.fetched_at) return false;
  const fetchedAtMs = Date.parse(snapshot.fetched_at);
  if (!Number.isFinite(fetchedAtMs)) return false;
  const providers = Object.values(snapshot) as Array<ProviderStatusState | string>;
  return providers.some((provider) => {
    if (!provider || typeof provider !== "object") return false;
    if (provider.status !== "cooldown") return false;
    const retryAfterSeconds = Number(provider.retry_after_seconds);
    if (!Number.isFinite(retryAfterSeconds) || retryAfterSeconds < 0) return false;
    return fetchedAtMs + retryAfterSeconds * 1000 > Date.now();
  });
}

const USAGE_LIMITS_CACHE_KEY = "usage.limits";

export function useUsageLimits(options?: { initialRefresh?: boolean }) {
  const [data, setData] = useState<UsageLimitsData | null>(() =>
    readLastGood<UsageLimitsData>(USAGE_LIMITS_CACHE_KEY),
  );
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(() =>
    !readLastGood<UsageLimitsData>(USAGE_LIMITS_CACHE_KEY),
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [stale, setStale] = useState(() =>
    Boolean(readLastGood<UsageLimitsData>(USAGE_LIMITS_CACHE_KEY)),
  );
  const initialRefresh = Boolean(options?.initialRefresh);
  const dataRef = useRef<UsageLimitsData | null>(null);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const refresh = useCallback(async (refreshOptions?: { force?: boolean }) => {
    const hasCurrentData = Boolean(dataRef.current);
    setIsLoading(!hasCurrentData);
    setIsRefreshing(hasCurrentData);
    try {
      const shouldForceRefresh =
        (refreshOptions?.force ?? true) && !hasProviderCooldown(dataRef.current);
      const res = await getUsageLimits(shouldForceRefresh ? { refresh: true } : {});
      const nextData = res && typeof res === "object" ? res as UsageLimitsData : null;
      setData(nextData);
      if (nextData) writeLastGood(USAGE_LIMITS_CACHE_KEY, nextData);
      setError(null);
      setStale(false);
    } catch (err) {
      setError((err as Error)?.message || String(err));
      if (hasCurrentData) setStale(true);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const hasCurrentData = Boolean(dataRef.current);
      if (!hasCurrentData) setIsLoading(true);
      else setIsRefreshing(true);
      try {
        const shouldForceRefresh = initialRefresh && !hasProviderCooldown(dataRef.current);
        const res = await getUsageLimits(shouldForceRefresh ? { refresh: true } : {});
        if (cancelled) return;
        const nextData = res && typeof res === "object" ? res as UsageLimitsData : null;
        setData(nextData);
        if (nextData) writeLastGood(USAGE_LIMITS_CACHE_KEY, nextData);
        setError(null);
        setStale(false);
      } catch (err) {
        if (cancelled) return;
        setError((err as Error)?.message || String(err));
        if (hasCurrentData) setStale(true);
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialRefresh]);

  return {
    data,
    error,
    isLoading,
    isRefreshing,
    hasData: Boolean(data),
    stale,
    refresh,
  };
}
