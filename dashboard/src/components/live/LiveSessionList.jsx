import React from "react";
import { AlertTriangle } from "lucide-react";
import { Card } from "../../ui/openai/components";
import { ProviderIcon } from "../../ui/matrix-a/components/ProviderIcon.jsx";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";
import { formatUsdCurrency, toDisplayNumber } from "../../lib/format";
import { ConfidenceBadge } from "./ConfidenceBadge";

function getSessionKey(row) {
  if (!row?.provider || !row?.session_id) return null;
  return `${String(row.provider)}:${String(row.session_id)}`;
}

function repoBasename(value) {
  const normalized = String(value || "").replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : copy("live.value.unknown_repo");
}

function formatTimestamp(value) {
  if (!value) return copy("live.value.unknown_time");
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sessionState(row) {
  const raw = typeof row?.state === "string" ? row.state.trim().toLowerCase() : "";
  if (raw === "active") return copy("live.state.active");
  if (raw === "ended") return copy("live.state.ended");
  if (raw === "live") return copy("live.state.live");
  if (raw) return copy("live.state.unknown");
  return row?.ended_at ? copy("live.state.ended") : copy("live.state.live");
}

function getBranch(row) {
  const branch = String(row?.branch || "").trim();
  return branch || copy("live.value.unattributed_branch");
}

function isActiveRow(row) {
  if (!row) return false;
  if (row.ended_at) return false;
  return String(row.state || "").trim().toLowerCase() !== "ended";
}

function streamNote(status) {
  if (status === "degraded") return copy("live.stream.degraded");
  if (status === "connecting") return copy("live.stream.connecting");
  return null;
}

function emptyStateCopy(status) {
  if (status === "connected") {
    return {
      title: copy("live.empty.connected_title"),
      subtitle: copy("live.empty.connected_subtitle"),
    };
  }
  return {
    title: copy("live.empty.title"),
    subtitle: copy("live.empty.subtitle"),
  };
}

function formatLiveSessionCost(row) {
  if (["pricing_missing", "missing_tokens", "partial_unknown"].includes(String(row?.cost_quality || ""))) {
    return "—";
  }
  const preferredCost = row?.estimated_total_cost_usd ?? row?.total_cost_usd;
  if (preferredCost == null) return "—";
  const formatted = formatUsdCurrency(String(preferredCost));
  if (formatted === "-") return "—";
  return row?.cost_estimated ? `${formatted} ${copy("live.cost.estimated_suffix")}` : formatted;
}

function MetaItem({ label, value }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-oai-gray-400 dark:text-oai-gray-500">
        {label}
      </div>
      <div className="truncate text-xs text-oai-gray-600 dark:text-oai-gray-300">{value}</div>
    </div>
  );
}

export function LiveSessionList({
  sessions = [],
  selectedKey = null,
  onSelectSession,
  streamStatus = "idle",
  streamError = null,
}) {
  const hint = streamNote(streamStatus);
  const emptyState = emptyStateCopy(streamStatus);
  const activeSessions = Array.isArray(sessions) ? sessions.filter(isActiveRow) : [];
  return (
    <Card className="overflow-hidden" bodyClassName="p-0">
      <div className="flex min-h-14 items-center justify-between border-b border-oai-gray-200 px-5 py-3 dark:border-oai-gray-800">
        <h2 className="text-sm font-semibold text-oai-black dark:text-white">{copy("live.sessions.title")}</h2>
        <span className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {copy("live.sessions.count", { count: activeSessions.length })}
        </span>
      </div>

      {streamError ? (
        <div className="flex items-start gap-2 border-b border-red-200/60 bg-red-500/5 px-5 py-3 text-xs text-red-700 dark:border-red-900/40 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{copy("live.stream.error", { error: streamError })}</span>
        </div>
      ) : hint ? (
        <div className="border-b border-oai-gray-200/70 px-5 py-2 text-xs text-oai-gray-500 dark:border-oai-gray-800/70 dark:text-oai-gray-400">
          {hint}
        </div>
      ) : null}

      {activeSessions.length === 0 ? (
        <div className="px-5 py-12 text-center">
          <h3 className="text-sm font-semibold text-oai-black dark:text-white">{emptyState.title}</h3>
          <p className="mt-1 text-sm text-oai-gray-500 dark:text-oai-gray-400">{emptyState.subtitle}</p>
        </div>
      ) : (
        <div className="divide-y divide-oai-gray-200/70 dark:divide-oai-gray-800/70">
          {activeSessions.map((row, index) => {
            const key = getSessionKey(row) || `${String(row?.provider || "unknown")}:${String(row?.session_id || index)}`;
            const selected = key === selectedKey;
            const repoRoot = String(row?.repo_root || row?.cwd || "");
            const tier = String(row?.branch_resolution_tier || "—");
            const startedAt = row?.started_at;
            const updatedAt = row?.updated_at || row?.last_observed_at || row?.observed_at || row?.ended_at;
            return (
              <button
                key={key}
                type="button"
                aria-pressed={selected}
                onClick={() => onSelectSession?.(key)}
                className={cn(
                  "grid min-h-[124px] w-full gap-3 px-5 py-4 text-left transition-colors",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500/60",
                  selected
                    ? "bg-oai-black/[0.03] dark:bg-white/[0.06]"
                    : "hover:bg-oai-gray-50 dark:hover:bg-oai-gray-900/80",
                )}
              >
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <ProviderIcon provider={row?.provider} size={16} className="shrink-0" />
                      <span className="truncate text-sm font-semibold text-oai-black dark:text-white">
                        {String(row?.provider || copy("live.value.unknown_provider"))}
                      </span>
                      {selected ? (
                        <span className="inline-flex h-5 items-center rounded-md bg-oai-black/[0.06] px-1.5 text-[10px] font-medium uppercase tracking-wide text-oai-gray-600 dark:bg-white/[0.1] dark:text-oai-gray-300">
                          {copy("live.row.selected")}
                        </span>
                      ) : null}
                    </div>
                    <div
                      className="mt-1 truncate text-sm text-oai-gray-600 dark:text-oai-gray-300"
                      title={repoRoot || undefined}
                    >
                      {repoBasename(repoRoot)}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-oai-gray-500 dark:text-oai-gray-400">
                      {getBranch(row)}
                    </div>
                  </div>
                  <ConfidenceBadge confidence={row?.confidence} className="shrink-0" />
                </div>

                <div className="grid gap-3 text-xs sm:grid-cols-3 lg:grid-cols-4">
                  <MetaItem label={copy("live.meta.tier")} value={tier} />
                  <MetaItem label={copy("live.meta.model")} value={String(row?.model || "—")} />
                  <MetaItem label={copy("live.meta.tokens")} value={toDisplayNumber(row?.total_tokens ?? 0)} />
                  <MetaItem label={copy("live.meta.cost")} value={formatLiveSessionCost(row)} />
                  <MetaItem label={copy("live.meta.started")} value={formatTimestamp(startedAt)} />
                  <MetaItem label={copy("live.meta.updated")} value={formatTimestamp(updatedAt)} />
                  <MetaItem label={copy("live.meta.state")} value={sessionState(row)} />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}
