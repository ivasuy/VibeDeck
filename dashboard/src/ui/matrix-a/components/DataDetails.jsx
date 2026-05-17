import React, { useState } from "react";
import { CircleDollarSign, Cpu, GitBranch, Layers3 } from "lucide-react";
import { Card } from "../../openai/components";
import { formatUsdCurrency, toDisplayNumber } from "../../../lib/format";
import { ProviderIcon } from "./ProviderIcon.jsx";

function toKnownNumber(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatCompact(value) {
  const n = toKnownNumber(value);
  if (n == null) return "—";
  return n.toLocaleString();
}

function resolveProjectTokens(entry) {
  return entry?.billable_total_tokens ?? entry?.total_tokens ?? null;
}

function resolveProjectCost(entry) {
  const exact = toKnownNumber(entry?.total_cost_usd);
  const estimated = toKnownNumber(entry?.estimated_total_cost_usd);
  const value = exact ?? estimated;
  if (value == null) return "—";
  const formatted = formatUsdCurrency(String(value));
  if (formatted === "-") return "—";
  return formatted;
}

function projectDisplayName(entry) {
  const key = typeof entry?.project_key === "string" ? entry.project_key.trim() : "";
  const ref = typeof entry?.project_ref === "string" ? entry.project_ref.trim() : "";
  const value = key || ref;
  if (!value) return "—";
  return value.split("/").filter(Boolean).pop() || value;
}

function projectInitial(entry) {
  const name = projectDisplayName(entry);
  return (name[0] || "?").toUpperCase();
}

function isDecommissionedProject(entry) {
  return entry?.archived === true || ["git_missing", "cwd_missing"].includes(String(entry?.project_state || ""));
}

function resolveBranchCount(entry) {
  const explicit = toKnownNumber(entry?.git_branch_count ?? entry?.worktree_count ?? entry?.branch_count);
  if (explicit != null) return Math.max(0, Math.round(explicit));
  if (Array.isArray(entry?.git_branches)) return entry.git_branches.length;
  return Array.isArray(entry?.branches) ? entry.branches.length : null;
}

function providerRows(entry) {
  return Array.isArray(entry?.providers) ? entry.providers : [];
}

function maxModelTokens(providers) {
  let max = 0;
  for (const provider of providers) {
    const models = Array.isArray(provider?.models) ? provider.models : [];
    for (const model of models) {
      max = Math.max(max, toKnownNumber(model?.total_tokens) || 0);
    }
  }
  return max;
}

function modelCostLabel(model) {
  const exact = toKnownNumber(model?.total_cost_usd);
  const estimated = toKnownNumber(model?.estimated_total_cost_usd);
  const value = exact ?? estimated;
  if (value == null) return "—";
  const formatted = formatUsdCurrency(String(value));
  if (formatted === "-") return "—";
  return formatted;
}

function percentLabel(value, total) {
  const n = toKnownNumber(value) || 0;
  const denominator = toKnownNumber(total) || 0;
  if (denominator <= 0) return "0%";
  const percent = (n / denominator) * 100;
  if (percent < 0.1 && percent > 0) return "0.1%";
  return `${Number(percent.toFixed(1)).toString()}%`;
}

function ProjectUsageCard({ entry, copy }) {
  const providers = providerRows(entry);
  const maxTokens = maxModelTokens(providers);
  const projectTokens = toKnownNumber(resolveProjectTokens(entry)) || 0;
  const decommissioned = isDecommissionedProject(entry);
  const href = typeof entry?.project_ref === "string" && /^https?:\/\//.test(entry.project_ref)
    ? entry.project_ref
    : null;
  const content = (
    <div className="vd-card-solid rounded-xl border border-oai-gray-200 bg-white p-4 transition-colors hover:bg-oai-brand-50/60 dark:border-oai-gray-800 dark:bg-oai-gray-900 dark:hover:bg-oai-brand-950/35">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-oai-brand-100 text-sm font-medium text-oai-brand-700 dark:bg-oai-brand-950/60 dark:text-oai-brand-300">
          {projectInitial(entry)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="truncate oai-text-body-sm font-medium text-oai-black dark:text-oai-white">
                  {projectDisplayName(entry)}
                </span>
                {decommissioned ? (
                  <span className="vd-chip inline-flex shrink-0 items-center rounded-md border border-amber-300/60 bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:border-amber-700/50 dark:bg-amber-900/20 dark:text-amber-200">
                    {copy("shared.badge.decommissioned")}
                  </span>
                ) : null}
              </div>
              {entry?.project_ref ? (
                <div className="mt-0.5 truncate text-[11px] text-oai-gray-500 dark:text-oai-gray-400">
                  {entry.project_ref}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            <ProjectStat
              icon={GitBranch}
              label={copy("dashboard.projects.worktrees_label")}
              value={resolveBranchCount(entry) ?? "—"}
            />
            <ProjectStat
              icon={Cpu}
              label={copy("dashboard.projects.tokens_label")}
              value={formatCompact(resolveProjectTokens(entry))}
            />
            <ProjectStat
              icon={CircleDollarSign}
              label={copy("dashboard.projects.cost_label")}
              value={resolveProjectCost(entry)}
            />
            <ProjectStat
              icon={Layers3}
              label={copy("dashboard.projects.providers_label")}
              value={providers.length || "—"}
            />
          </div>

          {providers.length ? (
            <div className="mt-4 space-y-5">
              {providers.map((provider) => {
                const providerName = String(provider?.provider || "unknown");
                const models = Array.isArray(provider?.models) ? provider.models : [];
                return (
                  <div key={providerName}>
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-oai-gray-700 dark:text-oai-gray-200">
                      <ProviderIcon provider={providerName} size={16} className="shrink-0" />
                      <span>{providerName}</span>
                    </div>
                    <div>
                      {models.map((model) => {
                        const tokens = toKnownNumber(model?.total_tokens) || 0;
                        const width = maxTokens > 0 ? Math.max(6, Math.round((tokens / maxTokens) * 100)) : 0;
                        const modelName = String(model?.model || "unknown");
                        return (
                          <div
                            key={`${providerName}-${modelName}`}
                            className="border-b border-oai-gray-100 py-2 last:border-b-0 dark:border-oai-gray-800"
                          >
                            <div className="mb-1.5 grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-baseline gap-4 text-sm">
                              <span className="truncate text-oai-gray-700 dark:text-oai-gray-200">{modelName}</span>
                              <span className="text-right tabular-nums text-oai-gray-500 dark:text-oai-gray-400">
                                {formatCompact(tokens)}
                              </span>
                              <span className="w-20 text-right tabular-nums text-oai-gray-500 dark:text-oai-gray-400">
                                {modelCostLabel(model)}
                              </span>
                              <span className="w-12 text-right tabular-nums font-medium text-oai-black dark:text-oai-white">
                                {percentLabel(tokens, projectTokens)}
                              </span>
                            </div>
                            <div className="h-0.5 overflow-hidden rounded-full bg-oai-gray-100 dark:bg-oai-gray-800">
                              <div
                                className="h-full rounded-full bg-oai-brand dark:bg-oai-brand-400"
                                style={{ width: `${width}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );

  if (!href) return content;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="block">
      {content}
    </a>
  );
}

function ProjectStat({ icon: Icon, label, value }) {
  return (
    <div className="vd-subcard rounded-lg border border-oai-gray-200 bg-oai-gray-50 px-3 py-2 dark:border-oai-gray-800 dark:bg-oai-gray-950/40">
      <div className="flex min-w-0 items-center gap-1.5 text-[10px] uppercase tracking-wide text-oai-brand-500 dark:text-oai-brand-300">
        {Icon ? <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 truncate text-sm font-medium tabular-nums text-oai-black dark:text-oai-white">
        {toDisplayNumber(value)}
      </div>
    </div>
  );
}

export function DataDetails({
  // Project props
  projectEntries = [],
  projectLimit = 3,
  onProjectLimitChange,
  projectLoading = false,
  projectError = null,
  // Daily breakdown props
  copy,
  dailyLoading = false,
  dailyError = null,
  hasDetailsActual,
  dailyEmptyPrefix,
  installSyncCmd,
  dailyEmptySuffix,
  detailsColumns,
  ariaSortFor,
  toggleSort,
  sortIconFor,
  pagedDetails,
  dailyBreakdownRows = [],
  dailyBreakdownColumns = [],
  dailyBreakdownAriaSortFor,
  dailyBreakdownSortIconFor,
  dailyBreakdownDateKey = "day",
  detailsDateKey,
  renderDetailDate,
  renderDailyBreakdownDate,
  renderDetailCell,
  DETAILS_PAGED_PERIODS,
  period,
  detailsPageCount,
  detailsPage,
  setDetailsPage,
}) {
  const [activeTab, setActiveTab] = useState("daily");

  return (
    <Card>
      {/* Tab Switcher + Controls */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div role="tablist" aria-label="Data view" className="flex gap-1 rounded-lg border border-[var(--vd-border)] bg-[var(--vd-tint)] p-1">
          <button
            role="tab"
            aria-selected={activeTab === "daily"}
            type="button"
            onClick={() => setActiveTab("daily")}
            className={`vd-tab text-xs font-medium px-3 py-1.5 rounded transition-colors ${
              activeTab === "daily"
                ? "vd-tab-active text-oai-black dark:text-oai-white bg-oai-gray-100 dark:bg-oai-gray-800"
                : "text-oai-gray-500 dark:text-oai-gray-300 hover:text-oai-black dark:hover:text-oai-white hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/50"
            }`}
          >
            {copy("dashboard.daily.title")}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "projects"}
            type="button"
            onClick={() => setActiveTab("projects")}
            className={`vd-tab text-xs font-medium px-3 py-1.5 rounded transition-colors ${
              activeTab === "projects"
                ? "vd-tab-active text-oai-black dark:text-oai-white bg-oai-gray-100 dark:bg-oai-gray-800"
                : "text-oai-gray-500 dark:text-oai-gray-300 hover:text-oai-black dark:hover:text-oai-white hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800/50"
            }`}
          >
            {copy("dashboard.projects.title")}
          </button>
        </div>
        {activeTab === "projects" && (
          <select
            aria-label="Number of projects to display"
            value={projectLimit}
            onChange={(e) => onProjectLimitChange?.(Number(e.target.value))}
            className="vd-control text-xs text-oai-gray-600 dark:text-oai-gray-300 bg-white dark:bg-oai-gray-900 border border-oai-gray-200 dark:border-oai-gray-700 rounded px-2 py-1 hover:border-oai-gray-300 dark:hover:border-oai-gray-600 focus:border-oai-brand dark:focus:border-oai-brand focus:outline-none transition-colors"
          >
            <option value={3}>{copy("dashboard.projects.limit_top_3")}</option>
            <option value={6}>{copy("dashboard.projects.limit_top_6")}</option>
            <option value={10}>{copy("dashboard.projects.limit_top_10")}</option>
          </select>
        )}
      </div>

      {/* Projects Tab */}
      {activeTab === "projects" && (
        <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1 oai-scrollbar">
          {projectLoading && projectEntries.length === 0 ? (
            <InlineProjectSkeleton />
          ) : projectError && projectEntries.length === 0 ? (
            <div className="oai-text-body-sm text-red-700 dark:text-red-300">{projectError}</div>
          ) : projectEntries.length === 0 ? (
            <div className="oai-text-body-sm text-oai-gray-500 dark:text-oai-gray-300">
              {copy("dashboard.projects.empty")}
            </div>
          ) : (
            <>
              {projectLoading ? (
                <div className="oai-text-caption text-oai-gray-500 dark:text-oai-gray-400">
                  Refreshing project usage...
                </div>
              ) : null}
              {projectEntries.slice(0, projectLimit).map((entry) => (
                <ProjectUsageCard
                  key={entry?.project_key || entry?.project_ref}
                  entry={entry}
                  copy={copy}
                />
              ))}
            </>
          )}
        </div>
      )}

      {/* Daily Tab */}
      {activeTab === "daily" && (
        <div>
          {dailyLoading && dailyBreakdownRows?.length === 0 ? (
            <InlineDailySkeleton />
          ) : dailyError && dailyBreakdownRows?.length === 0 ? (
            <div className="oai-text-body-sm text-red-700 dark:text-red-300 mb-4">{dailyError}</div>
          ) : dailyBreakdownRows?.length === 0 ? (
            <div className="oai-text-body-sm text-oai-gray-500 dark:text-oai-gray-300 mb-4">
              {dailyEmptyPrefix}
              <code className="mx-1 rounded border border-oai-gray-300 dark:border-oai-gray-700 oai-bg-elevated px-1.5 py-0.5 font-mono oai-text-caption">
                {installSyncCmd}
              </code>
              {dailyEmptySuffix}
            </div>
          ) : (
          <div className="overflow-auto max-h-[384px] -mx-4 oai-scrollbar">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="vd-table-head border-b border-oai-gray-200 dark:border-oai-gray-700">
                  {dailyBreakdownColumns.map((column) => (
                    <th
                      key={column.key}
                      aria-sort={dailyBreakdownAriaSortFor?.(column.key) || "none"}
                      className="text-left p-0 bg-transparent"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className="flex w-full items-center justify-start px-4 py-2 text-left oai-text-caption font-semibold text-oai-gray-600 dark:text-oai-gray-300 hover:text-oai-black dark:hover:text-oai-white transition-colors"
                      >
                        <span className="inline-flex items-center gap-1">
                          <span>{column.label}</span>
                          <span className="text-oai-gray-400 dark:text-oai-gray-400">
                            {dailyBreakdownSortIconFor?.(column.key) || ""}
                          </span>
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dailyBreakdownRows.map((row) => (
                  <tr
                    key={String(
                      row?.[dailyBreakdownDateKey] || row?.day || row?.hour || row?.month || "",
                    )}
                    className={`vd-row-hover border-b border-oai-gray-100 dark:border-oai-gray-800 last:border-b-0 hover:bg-oai-gray-50/50 dark:hover:bg-oai-gray-800/50 transition-colors ${
                      row.missing ? "text-oai-gray-400 dark:text-oai-gray-400" : row.future ? "text-oai-gray-300 dark:text-oai-gray-600" : "text-oai-black dark:text-oai-white"
                    }`}
                  >
                    <td className="px-4 py-2 oai-text-body-sm text-oai-gray-500 dark:text-oai-gray-300">
                      {renderDailyBreakdownDate ? renderDailyBreakdownDate(row) : renderDetailDate(row)}
                    </td>
                    <td className="px-4 py-2 oai-text-body-sm font-medium text-oai-black dark:text-oai-white tabular-nums">
                      {renderDetailCell(row, "total_tokens")}
                    </td>
                    <td className="px-4 py-2 oai-text-body-sm text-oai-gray-600 dark:text-oai-gray-300 tabular-nums">
                      {renderDetailCell(row, "input_tokens")}
                    </td>
                    <td className="px-4 py-2 oai-text-body-sm text-oai-gray-600 dark:text-oai-gray-300 tabular-nums">
                      {renderDetailCell(row, "output_tokens")}
                    </td>
                    <td className="px-4 py-2 oai-text-body-sm text-oai-gray-600 dark:text-oai-gray-300 tabular-nums">
                      {renderDetailCell(row, "cached_input_tokens")}
                    </td>
                    <td className="px-4 py-2 oai-text-body-sm text-oai-gray-600 dark:text-oai-gray-300 tabular-nums">
                      {renderDetailCell(row, "reasoning_output_tokens")}
                    </td>
                    <td className="px-4 py-2 oai-text-body-sm text-oai-gray-600 dark:text-oai-gray-300 tabular-nums">
                      {renderDetailCell(row, "conversation_count")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}

          {activeTab !== "daily" && DETAILS_PAGED_PERIODS.has(period) && detailsPageCount > 1 ? (
            <div className="mt-3 flex items-center justify-between oai-text-caption">
              <button
                type="button"
                onClick={() => setDetailsPage((prev) => Math.max(0, prev - 1))}
                disabled={detailsPage === 0}
                className="px-3 py-1.5 text-oai-gray-600 dark:text-oai-gray-300 hover:bg-oai-gray-100 dark:hover:bg-oai-gray-800 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {copy("details.pagination.prev")}
              </button>
              <span className="oai-text-muted">
                {detailsPage + 1} / {detailsPageCount}
              </span>
              <button
                type="button"
                onClick={() => setDetailsPage((prev) => Math.min(detailsPageCount - 1, prev + 1))}
                disabled={detailsPage + 1 >= detailsPageCount}
                className="px-3 py-1.5 text-oai-gray-600 dark:text-oai-gray-300 hover:bg-oai-gray-100 dark:hover:bg-oai-gray-800 rounded-md disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {copy("details.pagination.next")}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function InlineDailySkeleton() {
  return (
    <div aria-busy="true">
      <div className="oai-text-body-sm text-oai-gray-500 dark:text-oai-gray-300 mb-4">
        Loading usage details...
      </div>
      <div className="grid gap-2">
        {[0, 1, 2, 3, 4].map((index) => (
          <div
            key={index}
            className="shimmer h-9 rounded-md bg-oai-gray-100 dark:bg-oai-gray-800"
          />
        ))}
      </div>
    </div>
  );
}

function InlineProjectSkeleton() {
  return (
    <div aria-busy="true" className="space-y-3">
      <div className="oai-text-body-sm text-oai-gray-500 dark:text-oai-gray-300">
        Loading project usage...
      </div>
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="vd-card-solid rounded-xl border border-oai-gray-200 bg-white p-4 dark:border-oai-gray-800 dark:bg-oai-gray-900"
        >
          <div className="flex items-center gap-3">
            <div className="shimmer h-9 w-9 rounded-lg bg-oai-gray-100 dark:bg-oai-gray-800" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="shimmer h-3 w-36 rounded bg-oai-gray-100 dark:bg-oai-gray-800" />
              <div className="shimmer h-3 w-48 rounded bg-oai-gray-100 dark:bg-oai-gray-800" />
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
            {[0, 1, 2, 3].map((slot) => (
              <div key={slot} className="shimmer h-12 rounded-lg bg-oai-gray-100 dark:bg-oai-gray-800" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
