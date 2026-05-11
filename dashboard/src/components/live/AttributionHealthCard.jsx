import React from "react";
import { HeartPulse } from "lucide-react";
import { copy } from "../../lib/copy";
import { ConfidenceBadge } from "./ConfidenceBadge";

function toCount(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

const CONFIDENCE_KEYS = ["high", "medium", "low", "unattributed"];

function normalizeConfidence(value) {
  const confidence = String(value || "").trim().toLowerCase();
  if (confidence === "high" || confidence === "medium" || confidence === "low") return confidence;
  return "unattributed";
}

function activeStatsFromSessions(sessions) {
  const out = { high: 0, medium: 0, low: 0, unattributed: 0, total: 0 };
  if (!Array.isArray(sessions)) return out;
  for (const row of sessions) {
    if (row?.ended_at || String(row?.state || "").trim().toLowerCase() === "ended") continue;
    const confidence = normalizeConfidence(row?.confidence);
    out[confidence] += 1;
    out.total += 1;
  }
  return out;
}

export function AttributionHealthCard({ stats, sessions = [], loading = false, error = null, className = "" }) {
  const liveStats = activeStatsFromSessions(sessions);
  const displayStats = liveStats.total > 0 ? liveStats : stats;
  const total = toCount(displayStats?.total);

  return (
    <section
      className={`h-fit self-start rounded-xl border border-oai-gray-200 bg-white p-5 transition-colors duration-200 dark:border-oai-gray-800 dark:bg-oai-gray-900 ${className}`}
      style={{ blockSize: "fit-content" }}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-oai-black dark:text-white">{copy("live.attribution.title")}</h2>
        <span
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-indigo-600 dark:text-indigo-300"
          aria-hidden
        >
          <HeartPulse className="h-4 w-4 animate-pulse" />
        </span>
      </div>

      {loading && liveStats.total === 0 ? (
        <p className="mt-2 text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("live.attribution.loading")}</p>
      ) : error && liveStats.total === 0 ? (
        <p className="mt-2 text-sm text-red-700 dark:text-red-300">{copy("live.attribution.error", { error })}</p>
      ) : (
        <div className="mt-3 space-y-2.5">
          <div className="flex items-center justify-between rounded-md bg-oai-black/[0.03] px-2.5 py-2 text-xs text-oai-gray-600 dark:bg-white/[0.08] dark:text-oai-gray-300">
            <span>{liveStats.total > 0 ? "Live sessions" : copy("live.attribution.total")}</span>
            <span className="font-semibold text-oai-black dark:text-white">{total}</span>
          </div>
          {CONFIDENCE_KEYS.map((confidence) => {
            const count = toCount(displayStats?.[confidence]);
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            return (
              <div key={confidence} className="grid gap-1">
                <div className="flex items-center justify-between gap-3">
                  <ConfidenceBadge confidence={confidence} />
                  <span className="text-sm font-semibold tabular-nums text-oai-black dark:text-white">
                    {count}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-oai-black/[0.06] dark:bg-white/[0.08]">
                  <div
                    className="h-full rounded-full bg-oai-brand"
                    style={{ width: `${pct}%` }}
                    aria-hidden
                  />
                </div>
              </div>
            );
          })}
          {liveStats.total > 0 && stats?.total != null ? (
            <div className="pt-1 text-[11px] text-oai-gray-500 dark:text-oai-gray-400">
              All-time tracked: {toCount(stats.total)}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
