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
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  return `high ${mix.high} · medium ${mix.medium} · low ${mix.low} · unattributed ${mix.unattributed}`;
}

function ConfidenceMix({ confidence }) {
  const mix = confidenceMix(confidence);
  return (
    <div className="min-w-[240px] space-y-1">
      <div className="text-xs text-oai-gray-600 dark:text-oai-gray-300">{confidenceMixText(confidence)}</div>
      <div className="flex flex-wrap gap-1.5 text-[11px]">
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

export function BranchUsageTable({ rows = [], onOpenSessions }) {
  return (
    <Card className="overflow-hidden" bodyClassName="p-0">
      <div className="overflow-x-auto">
        <table className="min-w-full table-fixed">
          <thead>
            <tr className="border-b border-oai-gray-200 text-left text-xs text-oai-gray-500 dark:border-oai-gray-800 dark:text-oai-gray-400">
              <th className="px-4 py-3 font-semibold">{copy("branches.table.repo")}</th>
              <th className="px-4 py-3 font-semibold">{copy("branches.table.branch")}</th>
              <th className="px-4 py-3 font-semibold">{copy("branches.table.tokens")}</th>
              <th className="px-4 py-3 font-semibold">{copy("branches.table.cost")}</th>
              <th className="px-4 py-3 font-semibold">{copy("branches.table.sessions")}</th>
              <th className="px-4 py-3 font-semibold">{copy("branches.table.last_seen")}</th>
              <th className="px-4 py-3 font-semibold">{copy("branches.table.confidence_mix")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-sm text-oai-gray-500 dark:text-oai-gray-400">
                  {copy("branches.empty")}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const sessionCount = toCount(row?.session_count);
                const sessionLabel = copy("branches.table.view_sessions");
                return (
                  <tr
                    key={`${String(row?.repo_root || "")}:${String(row?.branch || "")}`}
                    className="border-b border-oai-gray-200/70 text-sm last:border-b-0 dark:border-oai-gray-800/70"
                  >
                    <td className="px-4 py-3 align-top text-oai-black dark:text-white">
                      <div className="break-all">{String(row?.repo_root || "—")}</div>
                    </td>
                    <td className="px-4 py-3 align-top text-oai-black dark:text-white">{String(row?.branch || "—")}</td>
                    <td className="px-4 py-3 align-top text-oai-gray-700 dark:text-oai-gray-200">
                      {toDisplayNumber(row?.total_tokens ?? 0)}
                    </td>
                    <td className="px-4 py-3 align-top text-oai-gray-700 dark:text-oai-gray-200">
                      {formatUsdCurrency(String(row?.total_cost_usd ?? 0))}
                    </td>
                    <td className="px-4 py-3 align-top text-oai-gray-700 dark:text-oai-gray-200">
                      <div className="flex items-center gap-2">
                        <span>{toDisplayNumber(sessionCount)}</span>
                        {sessionCount > 0 ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => onOpenSessions?.(row)}
                          >
                            {sessionLabel}
                          </Button>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top text-oai-gray-700 dark:text-oai-gray-200">
                      {formatTimestamp(row?.last_seen_at)}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <ConfidenceMix confidence={row?.confidence} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <div className="border-t border-oai-gray-200/70 px-4 py-2 text-xs text-oai-gray-500 dark:border-oai-gray-800/70 dark:text-oai-gray-400">
        {copy("branches.confidence.note")}
      </div>
    </Card>
  );
}
