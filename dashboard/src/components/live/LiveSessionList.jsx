import React from "react";
import { Activity, AlertTriangle, CircleDollarSign, CirclePlay, GitBranch, Layers3, PauseCircle, Radio } from "lucide-react";
import { Card } from "../../ui/openai/components";
import { StaggerContainer, StaggerItem } from "../../ui/foundation/FadeIn.jsx";
import { ProviderIcon } from "../../ui/matrix-a/components/ProviderIcon.jsx";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";
import { formatUsdCurrency, toDisplayNumber } from "../../lib/format";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { buildLiveWorkstreams, isActiveLiveSession, liveSessionKey } from "../../lib/live-workstreams";
import { LiveWorkstreamDrawer } from "./LiveWorkstreamDrawer";

function getSessionKey(row) {
  return liveSessionKey(row);
}

function repoBasename(value) {
  const normalized = String(value || "").replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : copy("live.value.unknown_repo");
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

function formatWorkstreamCost(workstream) {
  if (Number(workstream?.cost_unknown_count || 0) > 0) return "—";
  const n = Number(workstream?.total_cost_usd);
  if (!Number.isFinite(n)) return "—";
  const formatted = formatUsdCurrency(n.toFixed(2));
  return formatted === "-" ? "—" : formatted;
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
  const [openWorkstreamId, setOpenWorkstreamId] = React.useState(null);
  const selectedWorkstream = React.useMemo(
    () => visibleWorkstreams.find((workstream) => workstream.id === openWorkstreamId) || null,
    [openWorkstreamId, visibleWorkstreams],
  );

  React.useEffect(() => {
    if (openWorkstreamId && !selectedWorkstream) setOpenWorkstreamId(null);
  }, [openWorkstreamId, selectedWorkstream]);

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
            const repoName = repoBasename(repoRoot);
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
                          {repoName}
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
                    <MetaItem icon={Layers3} label="Related sessions" value={toDisplayNumber(relatedCount)} />
                    <MetaItem icon={Radio} label={copy("live.meta.tokens")} value={toDisplayNumber(workstream.total_tokens ?? 0)} />
                    <MetaItem icon={CircleDollarSign} label={copy("live.meta.cost")} value={formatWorkstreamCost(workstream)} />
                    <MetaItem icon={CirclePlay} label="Active" value={`${toDisplayNumber(workstream.active_session_count)} active`} />
                    <MetaItem icon={PauseCircle} label="Stale" value={`${toDisplayNumber(workstream.recently_completed_count)} stale`} />
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 truncate text-xs text-oai-gray-500 dark:text-oai-gray-400">
                      {toDisplayNumber(workstream.active_session_count)} active · {toDisplayNumber(workstream.recently_completed_count)} stale · {String(primary?.model || "—")}
                    </div>
                    <button
                      type="button"
                      onClick={() => setOpenWorkstreamId(workstream.id)}
                      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-oai-gray-200 bg-white px-2.5 text-xs font-medium text-oai-gray-700 transition-colors hover:border-oai-gray-300 hover:text-oai-black focus:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500/60 dark:border-oai-gray-800 dark:bg-oai-gray-950/40 dark:text-oai-gray-200 dark:hover:border-oai-gray-700 dark:hover:text-white"
                      aria-label={`View breakdown for ${repoName}`}
                    >
                      <Activity className="h-3.5 w-3.5" aria-hidden />
                      View breakdown
                    </button>
                  </div>
                </div>
              </StaggerItem>
            );
          })}
          </StaggerContainer>
        </div>
      )}
      <LiveWorkstreamDrawer
        workstream={selectedWorkstream}
        selectedKey={selectedKey}
        onSelectSession={onSelectSession}
        onClose={() => setOpenWorkstreamId(null)}
      />
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
