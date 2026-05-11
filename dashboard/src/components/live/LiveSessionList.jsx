import React from "react";
import { Activity, AlertTriangle, CircleDollarSign, Clock3, Cpu, GitBranch, Radio } from "lucide-react";
import { Card } from "../../ui/openai/components";
import { StaggerContainer, StaggerItem } from "../../ui/foundation/FadeIn.jsx";
import { ProviderIcon } from "../../ui/matrix-a/components/ProviderIcon.jsx";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";
import { formatUsdCurrency, toDisplayNumber } from "../../lib/format";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { buildLiveWorkstreams, isActiveLiveSession, liveSessionKey } from "../../lib/live-workstreams";

function getSessionKey(row) {
  return liveSessionKey(row);
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

function getBranch(row) {
  const branch = String(row?.branch || "").trim();
  return branch || copy("live.value.unattributed_branch");
}

function isActiveRow(row) {
  return isActiveLiveSession(row);
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
  return formatted;
}

function formatWorkstreamCost(workstream) {
  if (Number(workstream?.cost_unknown_count || 0) > 0) return "—";
  const n = Number(workstream?.total_cost_usd);
  if (!Number.isFinite(n)) return "—";
  const formatted = formatUsdCurrency(n.toFixed(2));
  return formatted === "-" ? "—" : formatted;
}

function formatStatus(row) {
  return isActiveRow(row) ? "active" : "stale";
}

function MetaItem({ label, value, icon: Icon }) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-oai-gray-400 dark:text-oai-gray-500">
        {Icon ? <Icon className="h-4 w-4 shrink-0" aria-hidden /> : null}
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-semibold text-oai-gray-700 dark:text-oai-gray-200">{value}</div>
    </div>
  );
}

function SessionDetailRow({ row, selected, label, onSelectSession }) {
  const key = getSessionKey(row);
  return (
    <button
      type="button"
      onClick={() => key && onSelectSession?.(key)}
      className={cn(
        "grid w-full gap-2 rounded-md border px-3 py-2 text-left transition-colors sm:grid-cols-[minmax(110px,0.7fr)_minmax(0,1fr)_auto_auto]",
        selected
          ? "border-oai-brand/50 bg-oai-brand/5 dark:border-oai-brand/40 dark:bg-oai-brand/10"
          : "border-oai-gray-200/70 bg-oai-black/[0.02] hover:bg-oai-gray-50 dark:border-oai-gray-800/70 dark:bg-white/[0.04] dark:hover:bg-white/[0.07]",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <ProviderIcon provider={row?.provider} size={16} className="shrink-0" />
        <span className="truncate text-xs font-semibold text-oai-black dark:text-white">
          {String(row?.provider || copy("live.value.unknown_provider"))}
        </span>
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200">
          {String(row?.model || "—")}
        </div>
        <div className="mt-0.5 text-[11px] text-oai-gray-500 dark:text-oai-gray-400">
          {label} · {formatStatus(row)}
        </div>
      </div>
      <div className="text-right text-xs tabular-nums text-oai-gray-700 dark:text-oai-gray-200">
        {toDisplayNumber(row?.total_tokens ?? 0)}
      </div>
      <div className="text-right text-xs tabular-nums text-oai-gray-700 dark:text-oai-gray-200">
        {formatLiveSessionCost(row)}
      </div>
    </button>
  );
}

export function LiveSessionList({
  sessions = [],
  selectedKey = null,
  onSelectSession,
  streamStatus = "idle",
  streamError = null,
  className = "",
  embedded = false,
}) {
  const hint = streamNote(streamStatus);
  const emptyState = emptyStateCopy(streamStatus);
  const workstreams = React.useMemo(() => buildLiveWorkstreams(sessions), [sessions]);
  const visibleWorkstreams = workstreams.filter((workstream) => workstream.active_session_count > 0);

  const content = (
    <>
      <div className="flex min-h-[57px] flex-wrap items-center justify-between gap-3 border-b border-oai-gray-100 px-5 py-4 dark:border-oai-gray-800">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-oai-gray-500 dark:text-oai-gray-400" aria-hidden />
            <h2 className="text-sm font-semibold text-oai-black dark:text-white">Active workstreams</h2>
          </div>
        </div>
        <span className="inline-flex h-8 items-center rounded-md bg-oai-black/[0.04] px-2.5 text-xs font-medium text-oai-gray-700 dark:bg-white/[0.08] dark:text-oai-gray-200">
          {`${visibleWorkstreams.length} ${visibleWorkstreams.length === 1 ? "workstream" : "workstreams"}`}
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

      {visibleWorkstreams.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-5 py-12 text-center">
          <h3 className="text-sm font-semibold text-oai-black dark:text-white">{emptyState.title}</h3>
          <p className="mt-1 text-sm text-oai-gray-500 dark:text-oai-gray-400">{emptyState.subtitle}</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <StaggerContainer className="divide-y divide-oai-gray-200/70 dark:divide-oai-gray-800/70" staggerDelay={0.035}>
          {visibleWorkstreams.map((workstream, index) => {
            const primary = workstream.primary_session || workstream.sessions[0] || {};
            const primaryKey = getSessionKey(primary) || `${String(primary?.provider || "unknown")}:${String(primary?.session_id || index)}`;
            const selected = workstream.sessions.some((row) => getSessionKey(row) === selectedKey);
            const repoRoot = String(workstream.repo_root || workstream.cwd || primary?.repo_root || primary?.cwd || "");
            const branchLabel = workstream.branches.join(", ");
            const relatedCount = Math.max(0, workstream.sessions.length - 1);
            return (
              <StaggerItem key={workstream.id || primaryKey}>
                <div
                  className={cn(
                    "grid min-h-[132px] w-full gap-3 px-5 py-4 text-left transition-colors",
                    selected
                      ? "bg-oai-black/[0.03] dark:bg-white/[0.06]"
                      : "hover:bg-oai-gray-50 dark:hover:bg-oai-gray-900/80",
                  )}
                >
                  <div className="flex min-w-0 items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <ProviderIcon provider={primary?.provider} size={16} className="shrink-0" />
                        <span className="truncate text-sm font-semibold text-oai-black dark:text-white">
                          {repoBasename(repoRoot)}
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
                        Primary session · {String(primary?.provider || copy("live.value.unknown_provider"))} · {String(primary?.model || "—")}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {workstream.branches.map((branch) => (
                          <span key={branch} className="inline-flex h-6 max-w-full items-center rounded-md bg-oai-black/[0.05] px-2 text-[11px] font-medium text-oai-gray-700 dark:bg-white/[0.08] dark:text-oai-gray-200">
                            <span className="truncate">{branch}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                    <ConfidenceBadge confidence={primary?.confidence} className="shrink-0" />
                  </div>

                  <div className="grid gap-3 text-xs sm:grid-cols-3 xl:grid-cols-4">
                    <MetaItem icon={GitBranch} label="Branches" value={branchLabel || getBranch(primary)} />
                    <MetaItem icon={Activity} label="Related sessions" value={toDisplayNumber(relatedCount)} />
                    <MetaItem icon={Radio} label={copy("live.meta.tokens")} value={toDisplayNumber(workstream.total_tokens ?? 0)} />
                    <MetaItem icon={CircleDollarSign} label={copy("live.meta.cost")} value={formatWorkstreamCost(workstream)} />
                    <MetaItem icon={Clock3} label="Active" value={`${toDisplayNumber(workstream.active_session_count)} active`} />
                    <MetaItem icon={Clock3} label="Stale" value={`${toDisplayNumber(workstream.recently_completed_count)} stale`} />
                  </div>

                  {selected ? (
                    <div className="mt-1 grid gap-3 rounded-lg border border-oai-gray-200/70 bg-white/60 p-3 dark:border-oai-gray-800/70 dark:bg-oai-gray-950/30">
                      <div>
                        <div className="mb-2 text-xs font-semibold text-oai-black dark:text-white">Primary session</div>
                        <SessionDetailRow
                          row={primary}
                          selected={getSessionKey(primary) === selectedKey}
                          label={getBranch(primary)}
                          onSelectSession={onSelectSession}
                        />
                      </div>
                      {relatedCount > 0 ? (
                        <div>
                          <div className="mb-2 text-xs font-semibold text-oai-black dark:text-white">Related sessions</div>
                          <div className="grid gap-2">
                            {workstream.branch_groups.map((group) => (
                              <div key={group.branch} className="grid gap-1.5">
                                <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-oai-gray-400 dark:text-oai-gray-500">
                                  <GitBranch className="h-3.5 w-3.5" aria-hidden />
                                  {group.branch}
                                </div>
                                {group.sessions
                                  .filter((row) => getSessionKey(row) !== getSessionKey(primary))
                                  .map((row) => (
                                    <SessionDetailRow
                                      key={getSessionKey(row)}
                                      row={row}
                                      selected={getSessionKey(row) === selectedKey}
                                      label={group.branch}
                                      onSelectSession={onSelectSession}
                                    />
                                  ))}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </StaggerItem>
            );
          })}
          </StaggerContainer>
        </div>
      )}
    </>
  );

  if (embedded) {
    return (
      <section className={`flex min-h-0 flex-col overflow-hidden ${className}`}>
        {content}
      </section>
    );
  }

  return (
    <Card className={`flex h-[520px] min-h-0 flex-col overflow-hidden ${className}`} bodyClassName="flex min-h-0 flex-1 flex-col p-0">
      {content}
    </Card>
  );
}
