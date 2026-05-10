import { useCallback, useEffect, useRef, useState } from "react";
import { getUsageLimits } from "../lib/api";

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

export function useUsageLimits(options?: { initialRefresh?: boolean }) {
  const [data, setData] = useState<UsageLimitsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const initialRefresh = Boolean(options?.initialRefresh);
  const dataRef = useRef<UsageLimitsData | null>(null);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const refresh = useCallback(async (refreshOptions?: { force?: boolean }) => {
    try {
      const shouldForceRefresh =
        (refreshOptions?.force ?? true) && !hasProviderCooldown(dataRef.current);
      const res = await getUsageLimits(shouldForceRefresh ? { refresh: true } : {});
      setData(res && typeof res === "object" ? res as UsageLimitsData : null);
      setError(null);
    } catch (err) {
      setError((err as Error)?.message || String(err));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const shouldForceRefresh = initialRefresh && !hasProviderCooldown(dataRef.current);
        const res = await getUsageLimits(shouldForceRefresh ? { refresh: true } : {});
        if (cancelled) return;
        setData(res && typeof res === "object" ? res as UsageLimitsData : null);
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError((err as Error)?.message || String(err));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialRefresh]);

  return { data, error, isLoading, refresh };
}
