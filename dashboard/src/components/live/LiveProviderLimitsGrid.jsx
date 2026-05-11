import React, { useMemo } from "react";
import { AlertTriangle, Clock3, Gauge } from "lucide-react";
import { ProviderIcon } from "../../ui/matrix-a/components/ProviderIcon.jsx";
import { copy } from "../../lib/copy";

const PROVIDERS = [
  { id: "claude", name: "Claude" },
  { id: "codex", name: "Codex" },
  { id: "cursor", name: "Cursor" },
  { id: "gemini", name: "Gemini" },
  { id: "kimi", name: "Kimi" },
  { id: "kiro", name: "Kiro" },
  { id: "copilot", name: "GitHub Copilot" },
  { id: "antigravity", name: "Antigravity" },
];

function providerId(value) {
  return String(value || "").trim().toLowerCase();
}

function isActiveSession(row) {
  if (!row?.provider || row.ended_at) return false;
  return String(row.state || "").trim().toLowerCase() !== "ended";
}

function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

function formatDurationSeconds(value) {
  const totalSeconds = Math.max(0, Math.ceil(Number(value) || 0));
  if (totalSeconds <= 0) return copy("shared.time.now");
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.ceil(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.ceil(hours / 24)}d`;
}

function formatReset(value) {
  if (!value) return null;
  const numericValue = Number(value);
  const ts = typeof value === "number" || Number.isFinite(numericValue)
    ? (numericValue > 1000000000000 ? numericValue : numericValue * 1000)
    : Date.parse(String(value));
  if (!Number.isFinite(ts)) return null;
  const diffMs = ts - Date.now();
  if (diffMs <= 0) return copy("shared.time.now");
  const minutes = Math.ceil(diffMs / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.ceil(hours / 24)}d`;
}

function windowFrom(label, window) {
  if (!window) return null;
  const pct = clampPercent(window.utilization ?? window.used_percent);
  if (pct == null) return null;
  return {
    label,
    pct,
    reset: formatReset(window.resets_at ?? window.reset_at),
  };
}

function resolveWindows(id, data) {
  if (!data || data.error || data.status === "setup_required" || data.status === "cooldown") return [];
  if (id === "claude") {
    return [
      windowFrom("5h", data.five_hour),
      windowFrom("7d", data.seven_day),
      windowFrom("Opus", data.seven_day_opus),
    ].filter(Boolean);
  }
  if (id === "codex") {
    return [
      windowFrom("5h", data.primary_window),
      windowFrom("7d", data.secondary_window),
    ].filter(Boolean);
  }
  if (id === "cursor") {
    return [
      windowFrom(copy("limits.label.cursor_plan"), data.primary_window),
      windowFrom(copy("limits.label.cursor_auto"), data.secondary_window),
      windowFrom(copy("limits.label.cursor_api"), data.tertiary_window),
    ].filter(Boolean);
  }
  if (id === "gemini") {
    return [
      windowFrom("Pro", data.primary_window),
      windowFrom("Flash", data.secondary_window),
      windowFrom("Lite", data.tertiary_window),
    ].filter(Boolean);
  }
  if (id === "kimi") {
    return [
      windowFrom(copy("limits.label.kimi_weekly"), data.primary_window),
      windowFrom(copy("limits.label.kimi_5h"), data.secondary_window),
      windowFrom(copy("limits.label.kimi_total"), data.tertiary_window),
    ].filter(Boolean);
  }
  if (id === "kiro") {
    return [
      windowFrom(copy("limits.label.kiro_month"), data.primary_window),
      windowFrom(copy("limits.label.kiro_bonus"), data.secondary_window),
    ].filter(Boolean);
  }
  if (id === "copilot") {
    return [
      windowFrom(copy("limits.label.copilot_premium"), data.primary_window),
      windowFrom(copy("limits.label.copilot_chat"), data.secondary_window),
    ].filter(Boolean);
  }
  if (id === "antigravity") {
    return [
      windowFrom("Claude", data.primary_window),
      windowFrom("G Pro", data.secondary_window),
      windowFrom("Flash", data.tertiary_window),
    ].filter(Boolean);
  }
  return [];
}

function resolveProviderState(id, data) {
  if (!data?.configured) {
    return { tone: "muted", label: copy("limits.status.not_connected") };
  }
  if (data.status === "cooldown") {
    return {
      tone: "warning",
      label: copy("limits.status.cooldown", {
        duration: formatDurationSeconds(data.retry_after_seconds),
      }),
    };
  }
  if (data.status === "setup_required") {
    return { tone: "warning", label: copy("limits.status.setup_required") };
  }
  if (data.error) {
    return { tone: "danger", label: copy("shared.error.prefix", { error: data.error }) };
  }
  return { tone: "ok", label: "Recording" };
}

function barColor(pct) {
  if (pct >= 90) return "bg-red-500";
  if (pct >= 70) return "bg-amber-500";
  return "bg-indigo-500";
}

function statusClass(tone) {
  if (tone === "ok") return "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300";
  if (tone === "warning") return "bg-amber-500/10 text-amber-700 dark:text-amber-300";
  if (tone === "danger") return "bg-red-500/10 text-red-700 dark:text-red-300";
  return "bg-oai-black/[0.04] text-oai-gray-600 dark:bg-white/[0.08] dark:text-oai-gray-300";
}

function WindowMeter({ item }) {
  const rounded = Math.round(item.pct);
  const width = item.pct > 0 && rounded === 0 ? Math.max(item.pct, 0.35) : item.pct;
  const labelPct = item.pct > 0 && rounded === 0 ? "<1" : String(rounded);

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="min-w-0 truncate font-medium text-oai-gray-700 dark:text-oai-gray-200">
          {item.label}
        </span>
        <span className="shrink-0 tabular-nums text-oai-gray-500 dark:text-oai-gray-400">
          {labelPct}%
          {item.reset ? <span className="ml-2 text-oai-gray-400 dark:text-oai-gray-500">{item.reset}</span> : null}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-oai-black/[0.06] dark:bg-white/[0.08]">
        <div
          className={`h-full rounded-full ${barColor(rounded)}`}
          style={{ width: `${width}%`, minWidth: item.pct > 0 ? 3 : 0 }}
          aria-hidden
        />
      </div>
    </div>
  );
}

function ProviderLimitRow({ provider }) {
  const { id, name, active, windows, state } = provider;

  return (
    <article className="vd-card-solid grid min-h-[112px] gap-3 rounded-lg border border-oai-gray-200 bg-white p-3.5 dark:border-oai-gray-800 dark:bg-oai-gray-900 lg:grid-cols-[168px_minmax(0,1fr)]">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <ProviderIcon provider={id} size={18} className="shrink-0" />
          <h3 className="truncate text-sm font-semibold text-oai-black dark:text-white">{name}</h3>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className={`inline-flex h-6 max-w-full items-center rounded-md px-2 text-[11px] font-medium ${statusClass(state.tone)}`}>
            <span className="truncate">{state.label}</span>
          </span>
          {active ? (
            <span className="inline-flex h-6 items-center rounded-md bg-indigo-500/10 px-2 text-[11px] font-medium text-indigo-700 dark:text-indigo-300">
              Active
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid content-center gap-3">
        {windows.map((item) => <WindowMeter key={item.label} item={item} />)}
      </div>
    </article>
  );
}

export function LiveProviderLimitsGrid({ sessions = [], limits = null, loading = false, error = null, className = "", embedded = false }) {
  const activeProviders = useMemo(() => {
    return new Set(
      (Array.isArray(sessions) ? sessions : [])
        .filter(isActiveSession)
        .map((row) => providerId(row.provider))
        .filter(Boolean),
    );
  }, [sessions]);

  const providers = useMemo(() => {
    return PROVIDERS.map((provider) => {
      const data = limits?.[provider.id] || null;
      const windows = resolveWindows(provider.id, data);
      return {
        ...provider,
        active: activeProviders.has(provider.id),
        configured: Boolean(data?.configured),
        windows,
        state: resolveProviderState(provider.id, data),
      };
    }).filter((provider) => provider.windows.length > 0);
  }, [activeProviders, limits]);

  return (
    <section className={`flex min-h-0 flex-col overflow-hidden ${embedded ? "" : "vd-card h-[520px] rounded-xl border border-oai-gray-200 bg-white dark:border-oai-gray-800 dark:bg-oai-gray-900"} ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--vd-border)] px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-oai-gray-500 dark:text-oai-gray-400" aria-hidden />
            <h2 className="text-sm font-semibold text-oai-black dark:text-white">Provider limits</h2>
          </div>
        </div>
        <span className="vd-chip inline-flex h-8 items-center rounded-md bg-oai-black/[0.04] px-2.5 text-xs font-medium text-oai-gray-700 dark:bg-white/[0.08] dark:text-oai-gray-200">
          {providers.length} recording
        </span>
      </div>

      {loading ? (
        <div className="m-5 flex min-h-[92px] items-center gap-2 rounded-lg border border-dashed border-oai-gray-200 px-4 text-sm text-oai-gray-500 dark:border-oai-gray-800 dark:text-oai-gray-400">
          <Clock3 className="h-4 w-4 animate-pulse" aria-hidden />
          Loading provider limit windows...
        </div>
      ) : error ? (
        <div className="m-5 flex min-h-[92px] items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          {copy("shared.error.prefix", { error })}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {providers.length > 0 ? (
            <div className="grid gap-3">
              {providers.map((provider) => (
                <ProviderLimitRow key={provider.id} provider={provider} />
              ))}
            </div>
          ) : (
            <div className="flex min-h-[84px] items-center rounded-lg border border-dashed border-oai-gray-200 px-4 text-sm text-oai-gray-500 dark:border-oai-gray-800 dark:text-oai-gray-400">
              {copy("limits.status.no_data")}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
