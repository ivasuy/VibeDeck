import React from "react";
import { Clock3 } from "lucide-react";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";
import { formatUsdCurrency, toDisplayNumber } from "../../lib/format";
import {
  ConfidenceBar,
  CostTokenPair,
  IconBadge,
  ProviderModelChips,
} from "../../ui/ops";
import { ProviderIcon } from "../../ui/matrix-a/components/ProviderIcon.jsx";
import { ConfidenceBadge } from "./ConfidenceBadge";

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

function sessionCostValue(row) {
  const costQuality = String(row?.cost_quality || "");
  if (["pricing_missing", "missing_tokens", "partial_unknown"].includes(costQuality)) return null;
  const preferredCost = row?.estimated_total_cost_usd ?? row?.total_cost_usd;
  if (preferredCost == null || preferredCost === "") return null;
  const numeric = Number(preferredCost);
  return Number.isFinite(numeric) ? numeric : null;
}

function sessionUpdatedAt(row) {
  return row?.updated_at || row?.last_observed_at || row?.observed_at || row?.started_at || row?.ended_at || null;
}

function formatSessionCost(row) {
  const cost = sessionCostValue(row);
  if (cost == null) return "—";
  const formatted = formatUsdCurrency(String(cost));
  if (formatted === "-") return "—";
  return row?.cost_estimated ? `${formatted} ${copy("live.cost.estimated_suffix")}` : formatted;
}

function SessionRow({ session, selected, onSelectSession }) {
  const branch = String(session?.branch || "").trim() || copy("live.value.unattributed_branch");
  const provider = String(session?.provider || copy("live.value.unknown_provider"));
  const sessionId = String(session?.session_id || "—");
  const model = String(session?.model || "—");
  const updatedAt = formatTimestamp(sessionUpdatedAt(session));
  const tokens = toDisplayNumber(session?.total_tokens ?? 0);
  const costLabel = formatSessionCost(session);

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={copy("live.workbench.branch.select_session", {
        provider,
        branch,
        session: sessionId,
      })}
      onClick={() => onSelectSession?.(session.key)}
      className={cn(
        "grid min-h-[84px] gap-3 rounded-lg border px-3 py-3 text-left transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500/60",
        selected
          ? "border-oai-black/15 bg-oai-black/[0.04] dark:border-white/20 dark:bg-white/[0.08]"
          : "border-oai-gray-200/80 bg-oai-black/[0.02] hover:bg-oai-gray-50 dark:border-oai-gray-800/80 dark:bg-white/[0.03] dark:hover:bg-oai-gray-900/80",
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ProviderIcon provider={provider} size={16} className="shrink-0" />
            <span className="truncate text-sm font-semibold text-oai-black dark:text-oai-white">
              {provider}
            </span>
            {selected ? (
              <span className="inline-flex h-5 items-center rounded-md bg-oai-black/[0.06] px-1.5 text-[10px] font-medium uppercase tracking-wide text-oai-gray-600 dark:bg-white/[0.1] dark:text-oai-gray-300">
                {copy("live.row.selected")}
              </span>
            ) : null}
          </div>
          <div className="mt-1 truncate text-xs text-oai-gray-500 dark:text-oai-gray-400">
            {copy("live.workbench.branch.session_meta", {
              model,
              session: sessionId,
            })}
          </div>
        </div>
        <ConfidenceBadge confidence={session?.confidence} className="shrink-0" />
      </div>

      <div className="grid gap-2 text-xs text-oai-gray-500 dark:text-oai-gray-400 sm:grid-cols-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide">{copy("live.meta.updated")}</div>
          <div className="truncate text-oai-gray-700 dark:text-oai-gray-200">{updatedAt}</div>
        </div>
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide">{copy("live.meta.tokens")}</div>
          <div className="truncate text-oai-gray-700 dark:text-oai-gray-200">{tokens}</div>
        </div>
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide">{copy("live.meta.cost")}</div>
          <div className="truncate text-oai-gray-700 dark:text-oai-gray-200">{costLabel}</div>
        </div>
      </div>
    </button>
  );
}

export function LiveBranchGroup({
  branchGroup,
  selectedKey = null,
  onSelectSession,
}) {
  const sessions = Array.isArray(branchGroup?.sessions) ? branchGroup.sessions : [];
  if (!sessions.length) return null;

  return (
    <div className="space-y-4 rounded-xl border border-oai-gray-200/80 bg-white p-4 dark:border-oai-gray-800/80 dark:bg-oai-gray-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <IconBadge accent="branch" label={copy("live.workbench.branch.badge")} decorative />
            <h3 className="truncate text-sm font-semibold text-oai-black dark:text-oai-white">
              {branchGroup.branch}
            </h3>
          </div>
          <div className="mt-1 inline-flex items-center gap-1.5 text-xs text-oai-gray-500 dark:text-oai-gray-400">
            <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{copy("live.workbench.branch.updated", { updatedAt: branchGroup.updatedAtLabel })}</span>
          </div>
        </div>
        <CostTokenPair
          cost={branchGroup.totalCost}
          tokens={branchGroup.totalTokens}
          estimated={branchGroup.costEstimated}
          className="justify-end"
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="space-y-3">
          <div className="rounded-lg border border-oai-gray-200/70 bg-oai-black/[0.02] px-3 py-3 dark:border-oai-gray-800/70 dark:bg-white/[0.03]">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
                {copy("live.workbench.branch.provider_mix")}
              </span>
              <span className="text-[11px] text-oai-gray-500 dark:text-oai-gray-400">
                {copy("live.workbench.branch.session_count", { count: sessions.length })}
              </span>
            </div>
            <ProviderModelChips items={branchGroup.providerModels} />
          </div>
          <div className="rounded-lg border border-oai-gray-200/70 bg-oai-black/[0.02] px-3 py-3 dark:border-oai-gray-800/70 dark:bg-white/[0.03]">
            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
              {copy("live.workbench.branch.confidence")}
            </div>
            <ConfidenceBar
              confidence={branchGroup.confidence}
              ariaLabel={copy("live.workbench.branch.confidence_aria", { branch: branchGroup.branch })}
            />
          </div>
        </div>

        <div className="grid auto-rows-max gap-3">
          {sessions.map((session) => (
            <SessionRow
              key={session.key}
              session={session}
              selected={session.key === selectedKey}
              onSelectSession={onSelectSession}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
