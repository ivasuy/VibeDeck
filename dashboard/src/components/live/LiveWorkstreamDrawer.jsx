import React from "react";
import {
  Activity,
  CalendarClock,
  CircleDollarSign,
  CirclePlay,
  Clock3,
  Cpu,
  GitBranch,
  Layers3,
  PauseCircle,
  Radio,
  X,
} from "lucide-react";
import { Button } from "../../ui/openai/components";
import { SlidePanel } from "../../ui/foundation";
import { cn } from "../../lib/cn";
import { formatUsdCurrency, toDisplayNumber } from "../../lib/format";
import { ProviderIcon } from "../../ui/matrix-a/components/ProviderIcon.jsx";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { isActiveLiveSession, liveBranchLabel, liveSessionCost, liveSessionKey } from "../../lib/live-workstreams";

function repoBasename(value) {
  const normalized = String(value || "").replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "Unknown repo";
}

function formatTimestamp(value) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  const day = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: true });
  return `${day} ${time}`;
}

function formatCost(value) {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const formatted = formatUsdCurrency(n.toFixed(2));
  return formatted === "-" ? "—" : formatted;
}

function sortDrawerSessions(sessions) {
  return (Array.isArray(sessions) ? sessions : []).slice().sort((a, b) => {
    const aActive = isActiveLiveSession(a);
    const bActive = isActiveLiveSession(b);
    if (aActive !== bActive) return aActive ? -1 : 1;
    const aIso = String(a?.last_observed_at || a?.observed_at || a?.updated_at || a?.ended_at || a?.started_at || a?.created_at || "");
    const bIso = String(b?.last_observed_at || b?.observed_at || b?.updated_at || b?.ended_at || b?.started_at || b?.created_at || "");
    return bIso.localeCompare(aIso);
  });
}

function sortDrawerBranchGroups(branchGroups) {
  return (Array.isArray(branchGroups) ? branchGroups : []).slice().sort((a, b) => {
    const aHasActive = Number(a?.active_session_count || 0) > 0;
    const bHasActive = Number(b?.active_session_count || 0) > 0;
    if (aHasActive !== bHasActive) return aHasActive ? -1 : 1;
    const aSessions = sortDrawerSessions(a?.sessions);
    const bSessions = sortDrawerSessions(b?.sessions);
    const aActiveNewest = aHasActive
      ? String(aSessions.find((row) => isActiveLiveSession(row))?.last_observed_at
        || aSessions.find((row) => isActiveLiveSession(row))?.observed_at
        || aSessions.find((row) => isActiveLiveSession(row))?.updated_at
        || "")
      : "";
    const bActiveNewest = bHasActive
      ? String(bSessions.find((row) => isActiveLiveSession(row))?.last_observed_at
        || bSessions.find((row) => isActiveLiveSession(row))?.observed_at
        || bSessions.find((row) => isActiveLiveSession(row))?.updated_at
        || "")
      : "";
    if (aActiveNewest !== bActiveNewest) return bActiveNewest.localeCompare(aActiveNewest);
    const aAuditNewest = String(aSessions[0]?.last_observed_at || aSessions[0]?.observed_at || aSessions[0]?.updated_at || aSessions[0]?.ended_at || "");
    const bAuditNewest = String(bSessions[0]?.last_observed_at || bSessions[0]?.observed_at || bSessions[0]?.updated_at || bSessions[0]?.ended_at || "");
    if (aAuditNewest !== bAuditNewest) return bAuditNewest.localeCompare(aAuditNewest);
    return String(a?.branch || "").localeCompare(String(b?.branch || ""));
  });
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="rounded-md border border-oai-gray-200 bg-oai-black/[0.02] px-3 py-2 dark:border-oai-gray-800 dark:bg-white/[0.04]">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-oai-gray-400 dark:text-oai-gray-500">
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-semibold tabular-nums text-oai-black dark:text-white">{value}</div>
    </div>
  );
}

function formatSessionCount(value) {
  const count = Number(value || 0);
  const safe = Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
  return `${toDisplayNumber(safe)} session${safe === 1 ? "" : "s"}`;
}

function breakdownCost(row, prefix) {
  const unknown = Number(row?.[`${prefix}_cost_unknown_count`] ?? 0);
  if (unknown > 0) return null;
  return row?.[`${prefix}_total_cost_usd`] ?? row?.total_cost_usd;
}

function BreakdownCard({ title, rows, labelKey, iconForRow }) {
  const [expanded, setExpanded] = React.useState(false);
  const list = Array.isArray(rows) ? rows : [];
  const visibleRows = expanded ? list : list.slice(0, 6);
  if (list.length === 0) return null;

  return (
    <section className="rounded-md border border-oai-gray-200 bg-oai-black/[0.015] p-3 dark:border-oai-gray-800 dark:bg-white/[0.025]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Layers3 className="h-4 w-4 shrink-0 text-oai-gray-500 dark:text-oai-gray-400" aria-hidden />
          <h3 className="truncate text-sm font-semibold text-oai-black dark:text-white">{title}</h3>
        </div>
        <span className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {toDisplayNumber(list.length)} row{list.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="grid gap-2">
        {visibleRows.map((row, index) => {
          const label = String(row?.[labelKey] || "unknown");
          const activeCost = breakdownCost(row, "active");
          const auditCost = breakdownCost(row, "audit");
          return (
            <div
              key={`${title}:${label}:${index}`}
              className="vd-card-solid grid gap-3 rounded-md border border-oai-gray-200 bg-white px-3 py-2.5 text-xs dark:border-oai-gray-800 dark:bg-oai-gray-950/40 lg:grid-cols-[minmax(150px,1fr)_repeat(5,minmax(84px,auto))]"
            >
              <div className="flex min-w-0 items-center gap-2">
                {iconForRow ? iconForRow(row) : null}
                <div className="min-w-0">
                  <div className="truncate font-semibold text-oai-black dark:text-white">{label}</div>
                  <div className="mt-0.5 text-[11px] text-oai-gray-500 dark:text-oai-gray-400">
                    {formatSessionCount(row?.session_count)}
                  </div>
                </div>
              </div>
              <BreakdownMetric label="Audit tokens" value={toDisplayNumber(row?.audit_total_tokens ?? row?.total_tokens ?? 0)} />
              <BreakdownMetric label="Live tokens" value={toDisplayNumber(row?.active_total_tokens ?? 0)} />
              <BreakdownMetric label="Audit cost" value={formatCost(auditCost)} />
              <BreakdownMetric label="Live cost" value={formatCost(activeCost)} />
              <BreakdownMetric label="Sessions" value={formatSessionCount(row?.session_count)} />
            </div>
          );
        })}
      </div>
      {list.length > visibleRows.length ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-3"
          onClick={() => setExpanded(true)}
        >
          Show all {toDisplayNumber(list.length)} rows
        </Button>
      ) : null}
    </section>
  );
}

function BreakdownMetric({ label, value }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-oai-gray-400 dark:text-oai-gray-500">{label}</div>
      <div className="mt-0.5 font-semibold tabular-nums text-oai-gray-800 dark:text-oai-gray-100">{value}</div>
    </div>
  );
}

function SessionRow({ session, workstream, primary = false, selected = false, onSelectSession }) {
  const key = liveSessionKey(session);
  const active = isActiveLiveSession(session);
  const cost = liveSessionCost(session);
  const StatusIcon = active ? CirclePlay : PauseCircle;

  return (
    <button
      type="button"
      onClick={() => key && onSelectSession?.(key)}
      className={cn(
        "grid w-full gap-3 rounded-md border px-3 py-3 text-left transition-colors",
        "sm:grid-cols-[minmax(130px,0.7fr)_minmax(0,1.1fr)_minmax(90px,0.45fr)_minmax(90px,0.45fr)]",
        selected
          ? "border-oai-brand/50 bg-oai-brand/5 dark:border-oai-brand/40 dark:bg-oai-brand/10"
          : "border-oai-gray-200 bg-white hover:bg-oai-gray-50 dark:border-oai-gray-800 dark:bg-oai-gray-950/40 dark:hover:bg-white/[0.05]",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        <ProviderIcon provider={session?.provider} size={16} className="shrink-0" />
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold text-oai-black dark:text-white">
            {String(session?.provider || "unknown")}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-oai-gray-500 dark:text-oai-gray-400">
            <StatusIcon className={cn("h-3.5 w-3.5", active ? "text-indigo-500" : "text-amber-500")} aria-hidden />
            {active ? "active" : "stale"}
          </div>
        </div>
      </div>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-xs font-medium text-oai-gray-800 dark:text-oai-gray-100">
            {String(session?.model || "—")}
          </span>
          {primary ? (
            <span className="inline-flex h-5 items-center rounded-md bg-oai-black/[0.06] px-1.5 text-[10px] font-medium uppercase tracking-wide text-oai-gray-600 dark:bg-white/[0.1] dark:text-oai-gray-300">
              Primary session
            </span>
          ) : null}
        </div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-[11px] text-oai-gray-500 dark:text-oai-gray-400">
          <span className="inline-flex min-w-0 items-center gap-1">
            <GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{liveBranchLabel(workstream, session)}</span>
          </span>
          <span>Tier {String(session?.branch_resolution_tier || "—")}</span>
          <ConfidenceBadge confidence={session?.confidence} className="h-5 px-1.5 text-[10px]" />
        </div>
      </div>
      <div className="text-left sm:text-right">
        <div className="text-[11px] uppercase tracking-wide text-oai-gray-400 dark:text-oai-gray-500">Tokens</div>
        <div className="mt-1 text-xs font-semibold tabular-nums text-oai-gray-800 dark:text-oai-gray-100">
          {toDisplayNumber(session?.total_tokens ?? 0)}
        </div>
      </div>
      <div className="text-left sm:text-right">
        <div className="text-[11px] uppercase tracking-wide text-oai-gray-400 dark:text-oai-gray-500">Cost</div>
        <div className="mt-1 text-xs font-semibold tabular-nums text-oai-gray-800 dark:text-oai-gray-100">
          {formatCost(cost)}
        </div>
      </div>
      <div className="sm:col-span-4 grid gap-2 text-[11px] text-oai-gray-500 dark:text-oai-gray-400 sm:grid-cols-3">
        <span className="inline-flex items-center gap-1">
          <CalendarClock className="h-3.5 w-3.5" aria-hidden />
          Started {formatTimestamp(session?.started_at)}
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock3 className="h-3.5 w-3.5" aria-hidden />
          Updated {formatTimestamp(session?.updated_at || session?.last_observed_at || session?.observed_at)}
        </span>
        <span className="inline-flex items-center gap-1">
          <PauseCircle className="h-3.5 w-3.5" aria-hidden />
          Ended {formatTimestamp(session?.ended_at)}
        </span>
      </div>
    </button>
  );
}

export function LiveWorkstreamDrawer({ workstream = null, selectedKey = null, onSelectSession, onClose }) {
  const titleId = "live-workstream-breakdown-title";
  const repoRoot = String(workstream?.repo_root || workstream?.cwd || "");
  const primaryKey = workstream ? liveSessionKey(workstream.primary_session) : null;
  const auditCost = workstream && Number(workstream?.audit_cost_unknown_count ?? workstream?.cost_unknown_count ?? 0) > 0
    ? null
    : (workstream?.audit_total_cost_usd ?? workstream?.total_cost_usd);
  const activeCost = workstream && Number(workstream?.active_cost_unknown_count || 0) > 0
    ? null
    : workstream?.active_total_cost_usd;
  const providerRows = Array.isArray(workstream?.providers) ? workstream.providers : [];
  const modelRows = Array.isArray(workstream?.models) ? workstream.models : [];
  const branchGroups = sortDrawerBranchGroups(workstream?.branch_groups).map((group) => ({
    ...group,
    sessions: sortDrawerSessions(group?.sessions),
  }));

  return (
    <SlidePanel
      open={!!workstream}
      onClose={onClose}
      side="right"
      width="w-full max-w-5xl"
      className="vd-drawer border-l border-oai-gray-200 dark:border-oai-gray-800 bg-white dark:bg-[#0f0f14] shadow-oai-lg"
    >
      {workstream && <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex h-full flex-col"
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--vd-border)] px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-semibold text-oai-black dark:text-white">
              Workstream breakdown
            </h2>
            <div className="mt-1 truncate text-sm font-medium text-oai-black dark:text-white">
              {repoBasename(repoRoot)}
            </div>
            <div className="mt-1 truncate text-xs text-oai-gray-500 dark:text-oai-gray-400" title={repoRoot || undefined}>
              {repoRoot || "Unknown repo"}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="vd-control h-11 w-11 shrink-0 rounded-md border border-oai-gray-200 bg-oai-black/[0.02] px-0 text-oai-brand-600 hover:border-oai-brand hover:text-oai-brand dark:border-oai-gray-800 dark:bg-white/[0.04] dark:text-oai-brand-300 dark:hover:border-oai-brand-400 dark:hover:text-oai-brand-200"
            aria-label="Close workstream breakdown"
            onClick={onClose}
          >
            <X className="h-5 w-5" aria-hidden />
          </Button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <Metric icon={Activity} label="Active" value={`${toDisplayNumber(workstream.active_session_count)} active`} />
            <Metric icon={PauseCircle} label="Stale" value={`${toDisplayNumber(workstream.recently_completed_count)} stale`} />
            <Metric icon={Radio} label="Audit tokens" value={toDisplayNumber(workstream.audit_total_tokens ?? workstream.total_tokens ?? 0)} />
            <Metric icon={CircleDollarSign} label="Audit cost" value={formatCost(auditCost)} />
            <Metric icon={Radio} label="Live tokens" value={toDisplayNumber(workstream.active_total_tokens ?? 0)} />
            <Metric icon={CircleDollarSign} label="Live cost" value={formatCost(activeCost)} />
          </div>

          <div className="mb-4 grid gap-4">
            <BreakdownCard
              title="Model breakdown"
              rows={modelRows}
              labelKey="model"
            />
            <BreakdownCard
              title="Provider breakdown"
              rows={providerRows}
              labelKey="provider"
              iconForRow={(row) => (
                <ProviderIcon provider={row?.provider} size={16} className="shrink-0" />
              )}
            />
          </div>

          <div className="grid gap-4">
            {branchGroups.map((group) => (
              <section
                key={group.branch}
                className="rounded-md border border-oai-gray-200 bg-oai-black/[0.015] p-3 dark:border-oai-gray-800 dark:bg-white/[0.025]"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <GitBranch className="h-4 w-4 shrink-0 text-oai-gray-500 dark:text-oai-gray-400" aria-hidden />
                    <h3 className="truncate text-sm font-semibold text-oai-black dark:text-white">
                      {liveBranchLabel(workstream, { branch: group.branch })}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-oai-gray-500 dark:text-oai-gray-400">
                    <span className="inline-flex items-center gap-1">
                      <CirclePlay className="h-3.5 w-3.5 text-indigo-500" aria-hidden />
                      {toDisplayNumber(group.active_session_count)} active
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <PauseCircle className="h-3.5 w-3.5 text-amber-500" aria-hidden />
                      {toDisplayNumber(group.recently_completed_count)} stale
                    </span>
                    <span>{toDisplayNumber(group.audit_total_tokens ?? group.total_tokens ?? 0)} tokens</span>
                    <span>{formatCost(group.audit_total_cost_usd ?? group.total_cost_usd)}</span>
                  </div>
                </div>

                <div className="grid gap-2">
                  {group.sessions.map((session) => (
                    <SessionRow
                      key={liveSessionKey(session)}
                      session={session}
                      workstream={workstream}
                      primary={liveSessionKey(session) === primaryKey}
                      selected={liveSessionKey(session) === selectedKey}
                      onSelectSession={onSelectSession}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>

          {branchGroups.length === 0 ? (
            <div className="rounded-md border border-oai-gray-200 p-6 text-sm text-oai-gray-500 dark:border-oai-gray-800 dark:text-oai-gray-400">
              No session detail available.
            </div>
          ) : null}
        </div>
      </div>}
    </SlidePanel>
  );
}
