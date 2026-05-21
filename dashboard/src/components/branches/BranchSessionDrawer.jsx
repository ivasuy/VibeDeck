import React, { useEffect, useMemo, useState } from "react";
import { CalendarClock, CircleDollarSign, Cpu, Layers3, Tag, X } from "lucide-react";
import { Button } from "../../ui/openai/components";
import { SlidePanel } from "../../ui/foundation";
import { copy } from "../../lib/copy";
import { formatUsdCurrency, toDisplayNumber } from "../../lib/format";
import { ConfidenceBadge } from "../live/ConfidenceBadge";
import { ProviderIcon } from "../../ui/matrix-a/components/ProviderIcon.jsx";

const INITIAL_SESSION_RENDER_LIMIT = 40;

function formatTimestamp(value) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  const day = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const time = date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
  return `${day} ${time}`;
}

function formatCostLabel(value) {
  if (value == null || value === "") return copy("branches.value.unknown_cost");
  const n = Number(value);
  if (!Number.isFinite(n)) return copy("branches.value.unknown_cost");
  return formatUsdCurrency(String(n));
}

function formatEstimatedCostLabel(entry) {
  const formatted = formatCostLabel(entry?.total_cost_usd);
  if (formatted === copy("branches.value.unknown_cost")) return formatted;
  return formatted;
}

function normalizeProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  return provider || "unknown";
}

function timestampDateKey(value) {
  if (!value) return "";
  const raw = String(value).trim();
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (match) return match[1];
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function sessionDateKey(session) {
  return timestampDateKey(session?.ended_at) || timestampDateKey(session?.started_at);
}

function modelProvidersFromSessions(model, sessions) {
  const targetModel = String(model || "").trim();
  const out = [];
  const seen = new Set();
  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (String(session?.model || "").trim() !== targetModel) continue;
    const provider = normalizeProvider(session?.provider);
    if (seen.has(provider)) continue;
    seen.add(provider);
    out.push(provider);
  }
  return out;
}

function SessionMetric({ icon: Icon, label, value }) {
  return (
    <div className="vd-subcard min-w-0 rounded-md border border-oai-gray-200 bg-oai-black/[0.02] px-3 py-2 dark:border-oai-gray-800 dark:bg-white/[0.035]">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-oai-brand-500 dark:text-oai-brand-300">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        <span>{label}</span>
      </div>
      <div className="mt-1 truncate text-sm font-medium tabular-nums text-oai-black dark:text-white">{value}</div>
    </div>
  );
}

export function BranchSessionDrawer({ row = null, loading = false, error = "", onClose, onSelectDate }) {
  const sessions = Array.isArray(row?.sessions) ? row.sessions : [];
  const dateBuckets = Array.isArray(row?.date_buckets) ? row.date_buckets : [];
  const selectedDate = String(row?.selected_date || dateBuckets[0]?.date || "");
  const selectedBucket = dateBuckets.find((bucket) => String(bucket?.date || "") === selectedDate) || dateBuckets[0] || null;
  const models = Array.isArray(selectedBucket?.models)
    ? selectedBucket.models
    : Array.isArray(row?.models)
      ? row.models
      : [];
  const hasModels = models.length !== 0;
  const titleId = "branch-session-drawer-title";
  const [visibleLimit, setVisibleLimit] = useState(INITIAL_SESSION_RENDER_LIMIT);
  const filteredSessions = useMemo(() => {
    if (!selectedDate || dateBuckets.length === 0) return sessions;
    return sessions.filter((session) => {
      const date = sessionDateKey(session);
      return !date || date === selectedDate;
    });
  }, [dateBuckets.length, selectedDate, sessions]);
  const visibleSessions = useMemo(
    () => filteredSessions.slice(0, visibleLimit),
    [filteredSessions, visibleLimit],
  );

  useEffect(() => {
    setVisibleLimit(INITIAL_SESSION_RENDER_LIMIT);
  }, [row?.repo_root, row?.branch, selectedDate]);

  return (
    <SlidePanel
      open={!!row}
      onClose={onClose}
      side="right"
      width="w-full max-w-5xl"
      className="vd-drawer border-l border-oai-gray-200 dark:border-oai-gray-800 bg-white dark:bg-[#0f0f14] shadow-oai-lg"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex h-full flex-col"
      >
        <div className="flex items-center justify-between gap-4 border-b border-[var(--vd-border)] px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-semibold text-oai-black dark:text-white">
              {copy("branches.drawer.title")}
            </h2>
            <div className="mt-2 flex min-w-0 items-center gap-2 text-xs text-oai-gray-500 dark:text-oai-gray-400">
              <span className="vd-chip inline-flex min-w-0 items-center gap-1.5 rounded-md bg-oai-black/[0.035] px-2 py-1 font-medium text-oai-black dark:bg-white/[0.06] dark:text-white">
                <Tag className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="truncate">{String(row?.branch || "—")}</span>
              </span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="vd-control h-11 w-11 shrink-0 rounded-md border border-oai-gray-200 bg-oai-black/[0.02] px-0 text-oai-brand-600 hover:border-oai-brand hover:text-oai-brand dark:border-oai-gray-800 dark:bg-white/[0.04] dark:text-oai-brand-300 dark:hover:border-oai-brand-400 dark:hover:text-oai-brand-200"
            aria-label={copy("branches.drawer.close")}
            onClick={onClose}
          >
            <X className="h-5 w-5" aria-hidden />
          </Button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {dateBuckets.length > 0 ? (
            <div className="vd-subcard mb-4 rounded-md border border-oai-gray-200 bg-oai-black/[0.015] p-3 dark:border-oai-gray-800 dark:bg-white/[0.025]">
              <label
                htmlFor="branch-session-date-select"
                className="mb-2 block text-xs font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400"
              >
                Session date
              </label>
              <select
                id="branch-session-date-select"
                aria-label="Session date"
                value={selectedDate}
                onChange={(event) => onSelectDate?.(event.target.value)}
                className="vd-control h-10 w-full max-w-xs rounded-md border border-oai-gray-300 bg-white px-3 text-sm text-oai-black focus:border-oai-brand focus:outline-none focus:ring-2 focus:ring-oai-brand/20 dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-white"
              >
                {dateBuckets.map((bucket) => (
                  <option key={String(bucket?.date || "")} value={String(bucket?.date || "")}>
                    {String(bucket?.date || "Unknown date")} · {toDisplayNumber(bucket?.session_count ?? 0)} sessions
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {hasModels ? (
            <div className="vd-subcard mb-4 rounded-md border border-oai-gray-200 bg-oai-black/[0.015] p-3 dark:border-oai-gray-800 dark:bg-white/[0.025]">
              <div className="mb-3 flex items-center gap-2 text-xs font-medium text-oai-brand-700 dark:text-oai-brand-300">
                <Layers3 className="h-4 w-4" aria-hidden />
                <span>{copy("branches.drawer.model_summary")}</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {models.map((modelEntry) => (
                  <div
                    key={String(modelEntry?.model || "unknown")}
                    className="vd-card-solid min-w-0 rounded-md border border-oai-gray-200 bg-white px-3 py-2.5 dark:border-oai-gray-700 dark:bg-oai-gray-900"
                  >
                    <div className="max-w-[220px] truncate text-xs font-medium text-oai-black dark:text-white">
                      {String(modelEntry?.model || "—")}
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {(modelEntry?.provider
                        ? [normalizeProvider(modelEntry.provider)]
                        : modelProvidersFromSessions(modelEntry?.model, sessions)
                      ).map((provider) => (
                        <span
                          key={`${String(modelEntry?.model || "unknown")}:${provider}`}
                          className="inline-flex items-center gap-1 rounded-md bg-oai-black/[0.04] px-1.5 py-0.5 text-[10px] font-medium text-oai-gray-600 dark:bg-white/[0.06] dark:text-oai-gray-300"
                          aria-label={`Provider ${provider}`}
                        >
                          <ProviderIcon provider={provider} size={12} className="shrink-0" />
                          <span className="truncate">{provider}</span>
                        </span>
                      ))}
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-oai-gray-500 dark:text-oai-gray-400">
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <Cpu className="h-3 w-3" aria-hidden />
                        {toDisplayNumber(modelEntry?.total_tokens ?? 0)}
                      </span>
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        <CircleDollarSign className="h-3 w-3" aria-hidden />
                        {formatEstimatedCostLabel(modelEntry)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {loading ? (
            <SessionDrawerSkeleton />
          ) : error ? (
            <p className="text-sm text-red-700 dark:text-red-300">{copy("branches.error", { error })}</p>
          ) : filteredSessions.length === 0 ? (
            <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("branches.drawer.empty")}</p>
          ) : (
            <div className="grid gap-3">
              {visibleSessions.map((session, index) => (
                <article
                  key={`${String(session?.provider || "unknown")}:${String(session?.session_id || index)}`}
                  className="vd-card-solid rounded-md border border-oai-gray-200 bg-white p-4 dark:border-oai-gray-800 dark:bg-oai-gray-950/40"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="vd-chip inline-flex items-center gap-1.5 rounded-md bg-oai-black/[0.035] px-2 py-1 text-xs font-medium text-oai-black dark:bg-white/[0.06] dark:text-white"
                          aria-label={`Provider ${normalizeProvider(session?.provider)}`}
                        >
                          <ProviderIcon provider={session?.provider} size={14} className="shrink-0" />
                          {String(session?.provider || "—")}
                        </span>
                        <span className="truncate text-sm font-medium text-oai-black dark:text-white">
                          {String(session?.model || "—")}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <ConfidenceBadge confidence={session?.confidence} className="h-6 px-2 text-[11px]" />
                      <span className="vd-chip inline-flex h-6 items-center rounded-md border border-oai-gray-200 px-2 text-[11px] font-medium text-oai-gray-600 dark:border-oai-gray-800 dark:text-oai-gray-300">
                        {copy("branches.drawer.tier")} {String(session?.branch_resolution_tier || "—")}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <SessionMetric
                      icon={CalendarClock}
                      label={copy("branches.drawer.start")}
                      value={formatTimestamp(session?.started_at)}
                    />
                    <SessionMetric
                      icon={CalendarClock}
                      label={copy("branches.drawer.end")}
                      value={formatTimestamp(session?.ended_at)}
                    />
                    <SessionMetric
                      icon={Cpu}
                      label={copy("branches.drawer.tokens")}
                      value={toDisplayNumber(session?.total_tokens ?? 0)}
                    />
                    <SessionMetric
                      icon={CircleDollarSign}
                      label={copy("branches.drawer.cost")}
                      value={formatEstimatedCostLabel(session)}
                    />
                  </div>
                </article>
              ))}
              {visibleSessions.length < filteredSessions.length ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="justify-self-center"
                  onClick={() => setVisibleLimit((current) => current + INITIAL_SESSION_RENDER_LIMIT)}
                >
                  Show {Math.min(INITIAL_SESSION_RENDER_LIMIT, filteredSessions.length - visibleSessions.length)} more sessions
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </SlidePanel>
  );
}

function SessionDrawerSkeleton() {
  return (
    <div aria-busy="true" className="grid gap-3">
      <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">Loading branch usage...</p>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="vd-card-solid rounded-md border border-oai-gray-200 bg-white p-4 dark:border-oai-gray-800 dark:bg-oai-gray-950/40"
        >
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-2">
              <div className="shimmer h-4 w-32 rounded bg-oai-gray-100 dark:bg-oai-gray-800" />
              <div className="shimmer h-3 w-48 rounded bg-oai-gray-100 dark:bg-oai-gray-800" />
            </div>
            <div className="shimmer h-6 w-20 rounded bg-oai-gray-100 dark:bg-oai-gray-800" />
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((slot) => (
              <div key={slot} className="shimmer h-12 rounded bg-oai-gray-100 dark:bg-oai-gray-800" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
