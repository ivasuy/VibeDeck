import React from "react";
import { Card } from "../../ui/openai/components";
import { copy } from "../../lib/copy";
import { formatUsdCurrency, toDisplayNumber } from "../../lib/format";
import { ConfidenceBar, MetricStrip, ProjectIdentity, ProviderModelChips } from "../../ui/ops";

function formatCostLabel(totalCost, estimated) {
  if (totalCost == null) return copy("branches.value.unknown_cost");
  const formatted = formatUsdCurrency(String(totalCost));
  return estimated ? `${formatted} ${copy("live.cost.estimated_suffix")}` : formatted;
}

export function BranchProjectSummary({
  repoRoot = "",
  branchCount = 0,
  totals = {},
  providerModels = [],
  confidence = {},
  lastSeenLabel = "—",
}) {
  return (
    <Card bodyClassName="space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="mb-3 text-sm font-semibold text-oai-black dark:text-white">
            {copy("branches.summary.title")}
          </h2>
          <ProjectIdentity repoRoot={repoRoot || "—"} />
        </div>

        <div className="text-right">
          <div className="text-[11px] font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
            {copy("branches.summary.updated_label")}
          </div>
          <div className="mt-1 text-sm text-oai-gray-700 dark:text-oai-gray-200">{lastSeenLabel}</div>
        </div>
      </div>

      <MetricStrip
        className="border-none bg-transparent shadow-none"
        contentClassName="p-0"
        items={[
          {
            key: "branches",
            label: copy("branches.summary.metric.branches"),
            value: toDisplayNumber(branchCount),
            detail: copy("branches.summary.counts", {
              branches: toDisplayNumber(branchCount),
              sessions: toDisplayNumber(totals.sessions ?? 0),
            }),
            accent: "branch",
          },
          {
            key: "tokens",
            label: copy("branches.summary.metric.tokens"),
            value: toDisplayNumber(totals.tokens ?? 0),
            accent: "live",
          },
          {
            key: "cost",
            label: copy("branches.summary.metric.cost"),
            value: formatCostLabel(totals.cost, totals.costEstimated),
            accent: "cost",
          },
          {
            key: "sessions",
            label: copy("branches.summary.metric.sessions"),
            value: toDisplayNumber(totals.sessions ?? 0),
            accent: "project",
          },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="rounded-lg border border-oai-gray-200/70 bg-oai-black/[0.02] px-4 py-3 dark:border-oai-gray-800/70 dark:bg-white/[0.03]">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
            {copy("branches.summary.provider_mix")}
          </h3>
          {providerModels.length ? (
            <ProviderModelChips items={providerModels} />
          ) : (
            <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">
              {copy("branches.project.empty")}
            </p>
          )}
        </div>

        <div className="rounded-lg border border-oai-gray-200/70 bg-oai-black/[0.02] px-4 py-3 dark:border-oai-gray-800/70 dark:bg-white/[0.03]">
          <h3 className="mb-3 text-xs font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
            {copy("branches.summary.confidence")}
          </h3>
          <ConfidenceBar
            ariaLabel={copy("branches.summary.confidence_aria", {
              project: repoRoot || "—",
            })}
            confidence={confidence}
          />
        </div>
      </div>
    </Card>
  );
}
