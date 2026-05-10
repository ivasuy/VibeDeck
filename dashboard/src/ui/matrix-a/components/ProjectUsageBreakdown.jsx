import React from "react";
import { copy } from "../../../lib/copy";
import { formatUsdCurrency, toDisplayNumber } from "../../../lib/format";
import { ProviderIcon } from "./ProviderIcon.jsx";

function toKnownNumber(value) {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function formatProjectUsageCostLabel(costValue, costEstimated) {
  const numeric = toKnownNumber(costValue);
  if (numeric == null) return "—";
  const formatted = formatUsdCurrency(String(numeric));
  if (formatted === "-") return "—";
  return costEstimated ? `${formatted} ${copy("live.cost.estimated_suffix")}` : formatted;
}

function formatSessions(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) return null;
  return copy("dashboard.projects.breakdown_sessions", { count });
}

function ProviderRow({ providerEntry }) {
  const providerName = String(providerEntry?.provider || copy("shared.placeholder.short"));
  const models = Array.isArray(providerEntry?.models) ? providerEntry.models : [];
  const providerCost =
    providerEntry?.estimated_total_cost_usd ?? providerEntry?.total_cost_usd ?? null;

  return (
    <li
      className="rounded-lg border border-oai-gray-200 bg-white/70 p-3 dark:border-oai-gray-700 dark:bg-oai-gray-900/60"
      aria-label={providerName}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ProviderIcon provider={providerEntry?.provider} size={16} className="shrink-0" />
            <span className="truncate text-sm font-medium text-oai-black dark:text-oai-white">
              {providerName}
            </span>
          </div>
          <div className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
            {copy("dashboard.projects.provider_label")}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-medium text-oai-black dark:text-oai-white tabular-nums">
            {formatProjectUsageCostLabel(providerCost, providerEntry?.cost_estimated === true)}
          </div>
          <div className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400 tabular-nums">
            {toDisplayNumber(providerEntry?.total_tokens ?? 0)}
          </div>
        </div>
      </div>

      {models.length ? (
        <ul className="mt-3 space-y-2 border-t border-oai-gray-200/80 pt-3 dark:border-oai-gray-800/80">
          {models.map((modelEntry, index) => {
            const modelName = String(modelEntry?.model || "—");
            const sessionLabel = formatSessions(modelEntry?.session_count);
            const modelCost =
              modelEntry?.estimated_total_cost_usd ?? modelEntry?.total_cost_usd ?? null;

            return (
              <li
                key={`${providerName}-${modelName}-${index}`}
                className="flex items-start justify-between gap-3 rounded-md bg-oai-black/[0.02] px-3 py-2 dark:bg-white/[0.04]"
                aria-label={modelName}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm text-oai-black dark:text-oai-white">{modelName}</div>
                  <div className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
                    {sessionLabel || copy("dashboard.projects.model_label")}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-medium text-oai-black dark:text-oai-white tabular-nums">
                    {formatProjectUsageCostLabel(modelCost, modelEntry?.cost_estimated === true)}
                  </div>
                  <div className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400 tabular-nums">
                    {toDisplayNumber(modelEntry?.total_tokens ?? 0)}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

export function ProjectUsageBreakdown({ providers = [] }) {
  const rows = Array.isArray(providers) ? providers : [];
  if (!rows.length) return null;

  return (
    <div className="border-t border-oai-gray-200 px-4 py-4 dark:border-oai-gray-800">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="text-xs font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
          {copy("dashboard.projects.breakdown_heading")}
        </h4>
        <div className="text-[11px] text-oai-gray-500 dark:text-oai-gray-400">
          {copy("dashboard.projects.breakdown_columns")}
        </div>
      </div>
      <ul className="space-y-3">
        {rows.map((providerEntry, index) => (
          <ProviderRow
            key={`${String(providerEntry?.provider || "provider")}-${index}`}
            providerEntry={providerEntry}
          />
        ))}
      </ul>
    </div>
  );
}
