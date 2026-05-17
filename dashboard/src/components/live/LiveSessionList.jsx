import React from "react";
import { Activity, AlertTriangle, CircleDollarSign, CirclePlay, GitBranch, Layers3, PauseCircle, Radio } from "lucide-react";
import { Card } from "../../ui/openai/components";
import { StaggerContainer, StaggerItem } from "../../ui/foundation/FadeIn.jsx";
import { ProviderIcon } from "../../ui/matrix-a/components/ProviderIcon.jsx";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";
import { formatUsdCurrency, toDisplayNumber } from "../../lib/format";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { buildLiveWorkstreams, isActiveLiveSession, liveBranchLabel, liveScopeLabel, liveSessionKey } from "../../lib/live-workstreams";
import { LiveWorkstreamDrawer } from "./LiveWorkstreamDrawer";

function getSessionKey(row) {
  return liveSessionKey(row);
}

function repoBasename(value) {
  const normalized = String(value || "").replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : copy("live.value.unknown_repo");
}

function isActiveRow(row) {
  return isActiveLiveSession(row);
}

function streamNote(status, { initialLoading = false } = {}) {
  if (status === "reconnecting") return "Reconnecting live stream; showing last data.";
  if (status === "degraded") return copy("live.stream.degraded");
  if (status === "connecting") {
    return initialLoading ? copy("live.stream.connecting") : "Refreshing live stream; showing last data.";
  }
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
  const unknown = Number(workstream?.audit_cost_unknown_count ?? workstream?.cost_unknown_count ?? 0);
  if (unknown > 0) return "—";
  const n = Number(workstream?.audit_total_cost_usd ?? workstream?.total_cost_usd);
  if (!Number.isFinite(n)) return "—";
  const formatted = formatUsdCurrency(n.toFixed(2));
  return formatted === "-" ? "—" : formatted;
}

function workstreamTokens(workstream) {
  return Number(workstream?.audit_total_tokens ?? workstream?.total_tokens ?? 0) || 0;
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

function activateWorkstream(workstream, onSelectSession) {
  const primary = workstream?.primary_session || workstream?.sessions?.[0] || null;
  const key = getSessionKey(primary);
  if (key && typeof onSelectSession === "function") onSelectSession(key);
}

export function LiveSessionList({
  sessions = [],
  workstreams: backendWorkstreams = [],
  totals = null,
  selectedKey = null,
  onSelectSession,
  streamStatus = "idle",
  streamError = null,
  initialLoading = false,
  className = "",
  embedded = false,
}) {
  const hint = streamNote(streamStatus, { initialLoading });
  const emptyState = emptyStateCopy(streamStatus);
  const fallbackWorkstreams = React.useMemo(() => buildLiveWorkstreams(sessions), [sessions]);
  const workstreams = Array.isArray(backendWorkstreams) && backendWorkstreams.length > 0
    ? backendWorkstreams
    : fallbackWorkstreams;
  const visibleWorkstreams = workstreams.filter((workstream) => Number(workstream.active_session_count || 0) > 0);
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
      <div className="flex min-h-[57px] flex-wrap items-center justify-between gap-3 border-b border-[var(--vd-border)] px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-oai-gray-500 dark:text-oai-gray-400" aria-hidden />
            <h2 className="text-sm font-semibold text-oai-black dark:text-white">Active workstreams</h2>
          </div>
        </div>
        <span className="vd-chip inline-flex h-8 items-center rounded-md bg-oai-black/[0.04] px-2.5 text-xs font-medium text-oai-gray-700 dark:bg-white/[0.08] dark:text-oai-gray-200">
          {`${visibleWorkstreams.length} ${visibleWorkstreams.length === 1 ? "workstream" : "workstreams"}`}
        </span>
      </div>

      {streamError && streamStatus !== "reconnecting" ? (
        <div className="flex items-start gap-2 border-b border-red-200/60 bg-red-500/5 px-5 py-3 text-xs text-red-700 dark:border-red-900/40 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{copy("live.stream.error", { error: streamError })}</span>
        </div>
      ) : hint ? (
        <div className="border-b border-oai-gray-200/70 px-5 py-2 text-xs text-oai-gray-500 dark:border-oai-gray-800/70 dark:text-oai-gray-400">
          {hint}
        </div>
      ) : null}

      {initialLoading ? (
        <LiveSessionListSkeleton />
      ) : visibleWorkstreams.length === 0 ? (
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
            const scopeLabel = liveScopeLabel(workstream);
            const branchValue = liveBranchLabel(workstream, primary);
            const handleSelectWorkstream = () => activateWorkstream(workstream, onSelectSession);
            return (
              <StaggerItem key={workstream.id || primaryKey}>
                <div
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  aria-label={`Select ${repoName} workstream`}
                  onClick={handleSelectWorkstream}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    handleSelectWorkstream();
                  }}
                  className={cn(
                    "grid min-h-[132px] w-full cursor-pointer gap-3 border-l-2 px-5 py-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500/60 focus-visible:ring-inset",
                    selected
                      ? "border-oai-brand-500 bg-oai-brand-50/70 ring-1 ring-inset ring-oai-brand-500/20 dark:bg-oai-brand-500/10"
                        : "border-transparent hover:border-oai-brand-300 hover:bg-oai-brand-50/60 dark:hover:border-oai-brand-500 dark:hover:bg-oai-brand-950/35",
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
                          <span className="vd-chip inline-flex h-5 items-center rounded-md bg-oai-black/[0.06] px-1.5 text-[10px] font-medium uppercase tracking-wide text-oai-gray-600 dark:bg-white/[0.1] dark:text-oai-gray-300">
                            {copy("live.row.selected")}
                          </span>
                        ) : null}
                      </div>
                      <div
                        className="mt-1 truncate text-sm text-oai-gray-600 dark:text-oai-gray-300"
                        title={repoRoot || undefined}
                      >
                        Primary session · {String(primary?.provider || copy("live.value.unknown_provider"))} · {String(primary?.model || "—")}
                        {scopeLabel ? ` · ${scopeLabel}` : ""}
                      </div>
                    </div>
                    <ConfidenceBadge confidence={primary?.confidence} className="shrink-0" />
                  </div>

                  <div className="grid gap-3 text-xs sm:grid-cols-3 xl:grid-cols-4">
                    <MetaItem icon={GitBranch} label="Branches" value={scopeLabel === "No Git repo" ? branchValue : (branchLabel || branchValue)} />
                    <MetaItem icon={Layers3} label="Related sessions" value={toDisplayNumber(relatedCount)} />
                    <MetaItem icon={Radio} label="Tokens" value={toDisplayNumber(workstreamTokens(workstream))} />
                    <MetaItem icon={CircleDollarSign} label="Cost" value={formatWorkstreamCost(workstream)} />
                    <MetaItem icon={CirclePlay} label="Live now" value={toDisplayNumber(workstream.active_total_tokens ?? 0)} />
                    <MetaItem icon={PauseCircle} label="Stale" value={`${toDisplayNumber(workstream.recently_completed_count)} stale`} />
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 truncate text-xs text-oai-gray-500 dark:text-oai-gray-400">
                      {toDisplayNumber(workstream.active_session_count)} active · {toDisplayNumber(workstream.recently_completed_count)} stale · {String(primary?.model || "—")}
                    </div>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setOpenWorkstreamId(workstream.id);
                      }}
                      className="vd-control inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-oai-gray-200 bg-white px-2.5 text-xs font-medium text-oai-gray-700 transition-colors hover:border-oai-brand-300 hover:text-oai-brand focus:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500/60 dark:border-oai-gray-800 dark:bg-oai-gray-950/40 dark:text-oai-gray-200 dark:hover:border-oai-brand-500 dark:hover:text-oai-brand-300"
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

function LiveSessionListSkeleton() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" aria-busy="true">
      <div className="mb-3 text-sm text-oai-gray-500 dark:text-oai-gray-400">
        Loading live workstreams...
      </div>
      <div className="grid gap-3">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className="grid min-h-[132px] gap-3 rounded-md border border-oai-gray-200 bg-white px-5 py-4 dark:border-oai-gray-800 dark:bg-oai-gray-950/40"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2">
                <div className="shimmer h-4 w-36 rounded bg-oai-gray-100 dark:bg-oai-gray-800" />
                <div className="shimmer h-3 w-56 rounded bg-oai-gray-100 dark:bg-oai-gray-800" />
              </div>
              <div className="shimmer h-6 w-20 rounded bg-oai-gray-100 dark:bg-oai-gray-800" />
            </div>
            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-4">
              {[0, 1, 2, 3].map((slot) => (
                <div key={slot} className="shimmer h-10 rounded bg-oai-gray-100 dark:bg-oai-gray-800" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
