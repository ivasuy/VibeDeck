import React from "react";
import { Button, Card } from "../../ui/openai/components";
import { copy } from "../../lib/copy";
import { toDisplayNumber } from "../../lib/format";
import { ConfidenceBar, CostTokenPair, ProviderModelChips } from "../../ui/ops";

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

function buildProviderModels(row) {
  const providerByModel = new Map();
  for (const session of Array.isArray(row?.sessions) ? row.sessions : []) {
    const model = String(session?.model || "").trim();
    const provider = String(session?.provider || "").trim();
    if (model && provider && !providerByModel.has(model)) {
      providerByModel.set(model, provider);
    }
  }

  return (Array.isArray(row?.models) ? row.models : [])
    .filter((entry) => String(entry?.model || "").trim())
    .map((entry) => ({
      provider: providerByModel.get(String(entry?.model || "").trim()) || copy("live.value.unknown_provider"),
      model: entry?.model,
      total_tokens: entry?.total_tokens,
    }))
    .slice(0, 4);
}

export function BranchUsageTable({ rows = [], onOpenSessions, emptyMessage = "" }) {
  return (
    <Card className="overflow-hidden" bodyClassName="p-0">
      <div className="border-b border-oai-gray-200/70 px-4 py-3 dark:border-oai-gray-800/70">
        <h2 className="text-sm font-semibold text-oai-black dark:text-white">{copy("branches.ledger.title")}</h2>
        <p className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
          {copy("branches.confidence.note")}
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full table-fixed">
          <thead>
            <tr className="border-b border-oai-gray-200 text-left text-xs text-oai-gray-500 dark:border-oai-gray-800 dark:text-oai-gray-400">
              <th className="px-4 py-3 font-semibold">{copy("branches.table.branch")}</th>
              <th className="px-4 py-3 font-semibold">{copy("branches.table.usage")}</th>
              <th className="px-4 py-3 font-semibold">{copy("branches.table.providers")}</th>
              <th className="px-4 py-3 font-semibold">{copy("branches.table.confidence_mix")}</th>
              <th className="px-4 py-3 font-semibold">{copy("branches.table.activity")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-sm text-oai-gray-500 dark:text-oai-gray-400">
                  {emptyMessage || copy("branches.empty")}
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const sessionCount = toCount(row?.session_count);
                const providerModels = buildProviderModels(row);
                return (
                  <tr
                    key={`${String(row?.repo_root || "")}:${String(row?.branch || "")}`}
                    className="border-b border-oai-gray-200/70 text-sm last:border-b-0 dark:border-oai-gray-800/70"
                  >
                    <td className="px-4 py-3 align-top text-oai-black dark:text-white">
                      <div className="min-w-[180px]">
                        <div className="font-medium text-oai-black dark:text-white">{String(row?.branch || "—")}</div>
                        <div className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
                          {copy("branches.table.sessions_detail", { count: toDisplayNumber(sessionCount) })}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top text-oai-gray-700 dark:text-oai-gray-200">
                      <CostTokenPair
                        cost={row?.total_cost_usd}
                        tokens={row?.total_tokens}
                        estimated={row?.cost_estimated === true}
                      />
                    </td>
                    <td className="px-4 py-3 align-top text-oai-gray-700 dark:text-oai-gray-200">
                      {providerModels.length ? (
                        <div className="max-w-[320px] min-w-0">
                          <ProviderModelChips items={providerModels} />
                        </div>
                      ) : (
                        <span className="text-sm text-oai-gray-500 dark:text-oai-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="min-w-[220px]">
                        <ConfidenceBar
                          ariaLabel={copy("branches.table.confidence_aria", {
                            branch: String(row?.branch || "—"),
                          })}
                          confidence={row?.confidence}
                        />
                        <div className="mt-1 text-xs text-oai-gray-600 dark:text-oai-gray-300">
                          {confidenceMixText(row?.confidence)}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top text-oai-gray-700 dark:text-oai-gray-200">
                      <div className="space-y-2">
                        <div className="text-sm text-oai-black dark:text-white">
                          {copy("branches.table.updated_at", { time: formatTimestamp(row?.last_seen_at) })}
                        </div>
                        {sessionCount > 0 ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => onOpenSessions?.(row)}
                          >
                            {copy("branches.table.view_sessions")}
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
    </Card>
  );
}
