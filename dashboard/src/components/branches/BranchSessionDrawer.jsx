import React from "react";
import { X } from "lucide-react";
import { Button } from "../../ui/openai/components";
import { copy } from "../../lib/copy";
import { formatUsdCurrency, toDisplayNumber } from "../../lib/format";
import { ConfidenceBadge } from "../live/ConfidenceBadge";

function formatTimestamp(value) {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCostLabel(value) {
  if (value == null || value === "") return copy("branches.value.unknown_cost");
  const n = Number(value);
  if (!Number.isFinite(n)) return copy("branches.value.unknown_cost");
  return formatUsdCurrency(String(n));
}

export function BranchSessionDrawer({ row = null, onClose }) {
  if (!row) return null;
  const sessions = Array.isArray(row?.sessions) ? row.sessions : [];
  const models = Array.isArray(row?.models) ? row.models : [];
  const hasModels = models.length !== 0;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20 backdrop-blur-[1px]">
      <div className="h-full w-full max-w-2xl border-l border-oai-gray-200 bg-white shadow-xl dark:border-oai-gray-800 dark:bg-oai-gray-900">
        <div className="flex items-start justify-between border-b border-oai-gray-200 px-4 py-3 dark:border-oai-gray-800">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-oai-black dark:text-white">{copy("branches.drawer.title")}</h2>
            <p className="mt-1 truncate text-xs text-oai-gray-500 dark:text-oai-gray-400">
              {String(row?.repo_root || "—")} · {String(row?.branch || "—")}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 px-0"
            aria-label={copy("branches.drawer.close")}
            onClick={onClose}
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        <div className="h-[calc(100%-57px)] overflow-auto p-4">
          {hasModels ? (
            <div className="mb-4 rounded-md border border-oai-gray-200 bg-oai-black/[0.02] p-3 dark:border-oai-gray-800 dark:bg-white/[0.03]">
              <div className="mb-2 text-xs font-medium text-oai-gray-600 dark:text-oai-gray-300">
                {copy("branches.drawer.model_summary")}
              </div>
              <div className="flex flex-wrap gap-2">
                {models.map((modelEntry) => (
                  <div
                    key={String(modelEntry?.model || "unknown")}
                    className="min-w-0 rounded-md border border-oai-gray-200 bg-white px-2.5 py-2 dark:border-oai-gray-700 dark:bg-oai-gray-900"
                  >
                    <div className="max-w-[220px] truncate text-xs font-medium text-oai-black dark:text-white">
                      {String(modelEntry?.model || "—")}
                    </div>
                    <div className="mt-1 text-[11px] text-oai-gray-500 dark:text-oai-gray-400">
                      {toDisplayNumber(modelEntry?.total_tokens ?? 0)} · {formatCostLabel(modelEntry?.total_cost_usd)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {sessions.length === 0 ? (
            <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("branches.drawer.empty")}</p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-oai-gray-200 dark:border-oai-gray-800">
              <table className="min-w-full table-fixed">
                <thead>
                  <tr className="border-b border-oai-gray-200 text-left text-xs text-oai-gray-500 dark:border-oai-gray-800 dark:text-oai-gray-400">
                    <th className="px-3 py-2 font-semibold">{copy("branches.drawer.provider")}</th>
                    <th className="px-3 py-2 font-semibold">{copy("branches.drawer.session_id")}</th>
                    <th className="px-3 py-2 font-semibold">{copy("branches.drawer.start")}</th>
                    <th className="px-3 py-2 font-semibold">{copy("branches.drawer.end")}</th>
                    <th className="px-3 py-2 font-semibold">{copy("branches.drawer.model")}</th>
                    <th className="px-3 py-2 font-semibold">{copy("branches.drawer.tokens")}</th>
                    <th className="px-3 py-2 font-semibold">{copy("branches.drawer.cost")}</th>
                    <th className="px-3 py-2 font-semibold">{copy("branches.drawer.confidence")}</th>
                    <th className="px-3 py-2 font-semibold">{copy("branches.drawer.tier")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session, index) => (
                    <tr
                      key={`${String(session?.provider || "unknown")}:${String(session?.session_id || index)}`}
                      className="border-b border-oai-gray-200/70 text-xs last:border-b-0 dark:border-oai-gray-800/70"
                    >
                      <td className="px-3 py-2 text-oai-black dark:text-white">{String(session?.provider || "—")}</td>
                      <td className="px-3 py-2 text-oai-gray-700 dark:text-oai-gray-200">{String(session?.session_id || "—")}</td>
                      <td className="px-3 py-2 text-oai-gray-700 dark:text-oai-gray-200">{formatTimestamp(session?.started_at)}</td>
                      <td className="px-3 py-2 text-oai-gray-700 dark:text-oai-gray-200">{formatTimestamp(session?.ended_at)}</td>
                      <td className="px-3 py-2 text-oai-gray-700 dark:text-oai-gray-200">{String(session?.model || "—")}</td>
                      <td className="px-3 py-2 text-oai-gray-700 dark:text-oai-gray-200">{toDisplayNumber(session?.total_tokens ?? 0)}</td>
                      <td className="px-3 py-2 text-oai-gray-700 dark:text-oai-gray-200">
                        {formatCostLabel(session?.total_cost_usd)}
                      </td>
                      <td className="px-3 py-2">
                        <ConfidenceBadge confidence={session?.confidence} className="h-5 px-1.5 text-[10px]" />
                      </td>
                      <td className="px-3 py-2 text-oai-gray-700 dark:text-oai-gray-200">
                        {String(session?.branch_resolution_tier || "—")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
