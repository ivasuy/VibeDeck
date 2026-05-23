import React, { useEffect, useState } from "react";
import { Card } from "../ui/openai/components";
import { PageFrame } from "../components/PageFrame.jsx";
import { formatUsdCurrency, toDisplayNumber } from "../lib/format";
import { getModelsView } from "../lib/api";

function topTask(taskCategories) {
  const entries = Object.entries(taskCategories || {}).sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0]));
  return entries[0]?.[0] || "-";
}

export function ModelsPage() {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getModelsView()
      .then((nextPayload) => {
        if (active) setPayload(nextPayload || {});
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const models = Array.isArray(payload?.models) ? payload.models : [];
  const empty = !loading && models.length === 0;

  return (
    <PageFrame title="Models" maxWidth="max-w-7xl">
      <Card bodyClassName="p-0">
        {loading ? <div className="px-5 py-4 text-sm text-oai-gray-500 dark:text-oai-gray-400">Loading parity data...</div> : null}
        {empty ? <div className="px-5 py-4 text-sm text-oai-gray-500 dark:text-oai-gray-400">No data for this window yet.</div> : null}
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-[var(--glass-border)] text-xs uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
              <tr>
                <th className="px-5 py-3 font-medium">Model</th>
                <th className="px-5 py-3 font-medium">Providers</th>
                <th className="px-5 py-3 font-medium">Tokens</th>
                <th className="px-5 py-3 font-medium">Cost</th>
                <th className="px-5 py-3 font-medium">Sessions</th>
                <th className="px-5 py-3 font-medium">Top task</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-oai-gray-200/70 dark:divide-oai-gray-800/70">
              {models.map((model) => (
                <tr key={model.model}>
                  <td className="px-5 py-4 font-medium text-oai-black dark:text-white">{model.model || "unknown"}</td>
                  <td className="px-5 py-4 text-oai-gray-600 dark:text-oai-gray-300">{(model.providers || []).join(", ") || "-"}</td>
                  <td className="px-5 py-4 tabular-nums text-oai-gray-600 dark:text-oai-gray-300">{toDisplayNumber(model.total_tokens)}</td>
                  <td className="px-5 py-4 tabular-nums text-oai-gray-600 dark:text-oai-gray-300">{formatUsdCurrency(model.total_cost_usd, { decimals: 4 })}</td>
                  <td className="px-5 py-4 tabular-nums text-oai-gray-600 dark:text-oai-gray-300">{toDisplayNumber(model.session_count)}</td>
                  <td className="px-5 py-4 text-oai-gray-600 dark:text-oai-gray-300">{topTask(model.task_categories)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </PageFrame>
  );
}
