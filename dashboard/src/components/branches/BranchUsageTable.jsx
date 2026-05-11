import React from "react";
import { Button, Card } from "../../ui/openai/components";
import { copy } from "../../lib/copy";
import { formatUsdCurrency, toDisplayNumber } from "../../lib/format";
import { ConfidenceBadge } from "../live/ConfidenceBadge";

function toCount(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function formatTimestamp(value) {
  if (!value) return copy("branches.value.unknown_time");
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

function confidenceMix(confidence) {
  return {
    high: toCount(confidence?.high),
    medium: toCount(confidence?.medium),
    low: toCount(confidence?.low),
    unattributed: toCount(confidence?.unattributed),
  };
}

function confidenceMixText(confidence) {
  const mix = confidenceMix(confidence);
  return copy("branches.confidence.mix", {
    high_label: copy("shared.confidence.high"),
    high: mix.high,
    medium_label: copy("shared.confidence.medium"),
    medium: mix.medium,
    low_label: copy("shared.confidence.low"),
    low: mix.low,
    unattributed_label: copy("shared.confidence.unattributed"),
    unattributed: mix.unattributed,
  });
}

function formatCostLabel(value) {
  if (value == null || value === "") return copy("branches.value.unknown_cost");
  const n = Number(value);
  if (!Number.isFinite(n)) return copy("branches.value.unknown_cost");
  return formatUsdCurrency(String(n));
}

function formatBranchCostLabel(row) {
  const formatted = formatCostLabel(row?.total_cost_usd);
  if (formatted === copy("branches.value.unknown_cost")) return formatted;
  return formatted;
}

function modelSummary(models) {
  const list = Array.isArray(models) ? models : [];
  if (list.length === 0) return null;
  const topModel = String(list[0]?.model || "—");
  const extraModels = Math.max(0, list.length - 1);
  return {
    label: extraModels > 0 ? `${topModel} +${extraModels}` : topModel,
  };
}

function ConfidenceMix({ confidence }) {
  const mix = confidenceMix(confidence);
  return (
    <div className="min-w-0">
      <span className="sr-only">{confidenceMixText(confidence)}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px]" aria-hidden>
        <span className="inline-flex items-center gap-1">
          <ConfidenceBadge confidence="high" className="h-5 px-1.5 text-[10px]" />
          <span className="text-oai-gray-600 dark:text-oai-gray-300">{mix.high}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <ConfidenceBadge confidence="medium" className="h-5 px-1.5 text-[10px]" />
          <span className="text-oai-gray-600 dark:text-oai-gray-300">{mix.medium}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <ConfidenceBadge confidence="low" className="h-5 px-1.5 text-[10px]" />
          <span className="text-oai-gray-600 dark:text-oai-gray-300">{mix.low}</span>
        </span>
        <span className="inline-flex items-center gap-1">
          <ConfidenceBadge confidence="unattributed" className="h-5 px-1.5 text-[10px]" />
          <span className="text-oai-gray-600 dark:text-oai-gray-300">{mix.unattributed}</span>
        </span>
      </div>
    </div>
  );
}

function PaginationControls({ page, pageCount, pageSize, totalRows, onPageChange }) {
  const safePageCount = Number.isFinite(pageCount) ? Math.max(0, pageCount) : 0;
  const currentPage = safePageCount > 0 ? Math.min(Math.max(0, page), safePageCount - 1) : 0;
  const start = currentPage * pageSize + 1;
  const end = Math.min(totalRows, (currentPage + 1) * pageSize);
  const showPagination = safePageCount > 1;

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-oai-gray-200/70 px-0 py-0 text-sm text-oai-gray-500 dark:border-oai-gray-800/70 dark:text-oai-gray-400">
      <div className="grid gap-2 px-5 py-3">
        {showPagination ? (
          <span className="shrink-0 text-xs tabular-nums text-oai-gray-400 dark:text-oai-gray-500">
            {start}-{end} of {totalRows}
          </span>
        ) : null}
        <span className="leading-5">{copy("branches.confidence.note")}</span>
      </div>
      {showPagination ? (
        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-oai-gray-200/70 px-5 py-3 dark:border-oai-gray-800/70">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={currentPage === 0}
            onClick={() => onPageChange?.(currentPage - 1)}
          >
            {copy("details.pagination.prev")}
          </Button>
          <span className="min-w-16 text-center tabular-nums text-oai-gray-600 dark:text-oai-gray-300">
            {currentPage + 1} / {pageCount}
          </span>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={currentPage + 1 >= pageCount}
            onClick={() => onPageChange?.(currentPage + 1)}
          >
            {copy("details.pagination.next")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function BranchUsageTable({
  rows = [],
  onOpenSessions,
  emptyMessage = "",
  page = 0,
  pageCount = 0,
  pageSize = 10,
  totalRows = rows.length,
  onPageChange,
  className = "",
}) {
  return (
    <Card className={`flex min-h-0 overflow-hidden shadow-sm ${className}`} bodyClassName="!p-0 flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1 overflow-auto [mask-image:linear-gradient(to_right,transparent_0,black_8px,black_calc(100%-8px),transparent_100%)]">
        <table className="w-full min-w-[920px] table-fixed border-collapse">
          <thead className="sticky top-0 z-10 shadow-[0_1px_0_rgba(0,0,0,0.08)] dark:shadow-[0_1px_0_rgba(255,255,255,0.08)]">
            <tr className="vd-table-head border-b border-[var(--glass-border)] text-left text-[11px] uppercase tracking-wide text-oai-brand-600 dark:text-oai-brand-300">
              <th className="w-[28%] px-5 py-4 font-semibold">{copy("branches.table.branch")}</th>
              <th className="w-[12%] px-5 py-4 text-right font-semibold">{copy("branches.table.tokens")}</th>
              <th className="w-[10%] px-5 py-4 text-right font-semibold">{copy("branches.table.cost")}</th>
              <th className="w-[13%] px-5 py-4 font-semibold">{copy("branches.table.top_model")}</th>
              <th className="w-[13%] px-5 py-4 font-semibold">{copy("branches.table.last_seen")}</th>
              <th className="w-[12%] px-5 py-4 font-semibold">{copy("branches.table.confidence_mix")}</th>
              <th className="w-[12%] px-5 py-4 text-right font-semibold">{copy("branches.table.sessions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sm text-oai-gray-500 dark:text-oai-gray-400">
                  {emptyMessage || copy("branches.empty")}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const sessionCount = toCount(row?.session_count);
                const sessionLabel = copy("branches.table.view_sessions");
                const topModel = modelSummary(row?.models);
                return (
                  <tr
                    key={`${String(row?.repo_root || "")}:${String(row?.branch || "")}`}
                    className="vd-row-hover border-b border-oai-gray-200/70 text-sm transition-colors last:border-b-0 hover:bg-oai-black/[0.018] dark:border-oai-gray-800/70 dark:hover:bg-white/[0.03]"
                  >
                    <td className="px-5 py-4 align-middle text-oai-black dark:text-white">
                      <span
                        className="vd-chip inline-flex max-w-full items-center whitespace-normal break-words rounded-md bg-oai-black/[0.045] px-2.5 py-1 font-medium leading-5 dark:bg-white/[0.07]"
                        title={String(row?.branch || "—")}
                      >
                        {String(row?.branch || "—")}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-right align-middle tabular-nums text-oai-gray-700 dark:text-oai-gray-200">
                      {toDisplayNumber(row?.total_tokens ?? 0)}
                    </td>
                    <td className="px-5 py-4 text-right align-middle tabular-nums text-oai-gray-700 dark:text-oai-gray-200">
                      {formatBranchCostLabel(row)}
                    </td>
                    <td className="px-5 py-4 align-middle text-oai-gray-700 dark:text-oai-gray-200">
                      {topModel ? (
                        <div className="min-w-0">
                          <div className="truncate text-sm text-oai-black dark:text-white">{topModel.label}</div>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-5 py-4 align-middle text-oai-gray-700 dark:text-oai-gray-200">
                      {formatTimestamp(row?.last_seen_at)}
                    </td>
                    <td className="px-5 py-4 align-middle">
                      <ConfidenceMix confidence={row?.confidence} />
                    </td>
                    <td className="px-5 py-4 align-middle text-oai-gray-700 dark:text-oai-gray-200">
                      <div className="flex items-center justify-end gap-2">
                        <span className="min-w-5 text-center tabular-nums">{toDisplayNumber(sessionCount)}</span>
                        {sessionCount > 0 ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            aria-label={sessionLabel}
                            onClick={() => onOpenSessions?.(row)}
                          >
                            View
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <PaginationControls
        page={page}
        pageCount={pageCount}
        pageSize={pageSize}
        totalRows={totalRows}
        onPageChange={onPageChange}
      />
    </Card>
  );
}
