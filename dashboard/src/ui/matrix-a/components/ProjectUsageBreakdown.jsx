import React from "react";
import { copy } from "../../../lib/copy";
import { toDisplayNumber, formatUsdCurrency } from "../../../lib/format";
import { MiniBarChart, ProviderModelChips } from "../../ops";
import { ProviderIcon } from "./ProviderIcon.jsx";

function toKnownNumber(value) {
  if (value == null || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function resolveProjectUsageCostValue(entry) {
  const exactCost = toKnownNumber(entry?.total_cost_usd);
  const estimatedCost = toKnownNumber(entry?.estimated_total_cost_usd);
  const costEstimated = entry?.cost_estimated === true;
  const totalTokens = toKnownNumber(entry?.total_tokens);
  const costQuality = String(entry?.cost_quality || "").trim();

  if (!costEstimated) {
    return exactCost ?? estimatedCost ?? null;
  }

  if (estimatedCost != null) {
    return estimatedCost;
  }

  if (exactCost == null) {
    return null;
  }

  if (exactCost !== 0) {
    return exactCost;
  }

  if (totalTokens === 0) {
    return 0;
  }

  if (["zero_tokens", "stored", "token_buckets"].includes(costQuality)) {
    return 0;
  }

  return null;
}

export function formatProjectUsageCostLabel(costValue, costEstimated) {
  const numeric = toKnownNumber(costValue);
  if (numeric == null) return "—";
  const formatted = formatUsdCurrency(String(numeric));
  if (formatted === "-") return "—";
  return costEstimated ? `${formatted} ${copy("live.cost.estimated_suffix")}` : formatted;
}

function buildUsageRows(entries) {
  const placeholder = copy("shared.placeholder.short");
  return (Array.isArray(entries) ? entries : []).map((entry, index) => {
    const costValue = resolveProjectUsageCostValue(entry);
    const value = costValue ?? Number(entry?.total_tokens || 0);

    return {
      key: `${String(entry?.provider || entry?.model || "row")}-${index}`,
      label: String(entry?.provider || entry?.model || placeholder),
      value,
      valueLabel:
        costValue != null
          ? formatProjectUsageCostLabel(costValue, entry?.cost_estimated === true)
          : copy("dashboard.projects.breakdown_tokens_fallback", {
            tokens: toDisplayNumber(entry?.total_tokens ?? 0),
          }),
    };
  });
}

function formatSessions(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count <= 0) return null;
  return copy("dashboard.projects.breakdown_sessions", { count });
}

function ProviderRow({ providerEntry }) {
  const providerName = String(providerEntry?.provider || copy("shared.placeholder.short"));
  const models = Array.isArray(providerEntry?.models) ? providerEntry.models : [];
  const providerCost = resolveProjectUsageCostValue(providerEntry);
  const sessionLabel = formatSessions(providerEntry?.session_count);

  return (
    <li
      className="border-t border-oai-gray-200/80 py-4 first:border-t-0 first:pt-0 dark:border-oai-gray-800/80"
      aria-label={providerName}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ProviderIcon provider={providerEntry?.provider} size={16} className="shrink-0" />
            <span className="truncate text-sm font-medium text-oai-black dark:text-oai-white">
              {providerName}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
            <span>{copy("dashboard.projects.provider_label")}</span>
            <span>
              {copy("dashboard.projects.models_label")}: {models.length}
            </span>
            {sessionLabel ? <span>{sessionLabel}</span> : null}
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
        <div className="mt-3 space-y-3">
          <ProviderModelChips
            items={models.map((modelEntry) => ({
              provider: providerEntry?.provider,
              model: modelEntry?.model,
              total_tokens: modelEntry?.total_tokens,
            }))}
          />
          <ul className="space-y-2">
            {models.map((modelEntry, index) => {
              const modelName = String(modelEntry?.model || copy("shared.placeholder.short"));
              const modelCost = resolveProjectUsageCostValue(modelEntry);
              const modelSessionLabel = formatSessions(modelEntry?.session_count);

              return (
                <li
                  key={`${providerName}-${modelName}-${index}`}
                  className="flex items-start justify-between gap-3 rounded-md bg-oai-black/[0.02] px-3 py-2 dark:bg-white/[0.04]"
                  aria-label={modelName}
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm text-oai-black dark:text-oai-white">{modelName}</div>
                    <div className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
                      {modelSessionLabel || copy("dashboard.projects.model_label")}
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
        </div>
      ) : null}
    </li>
  );
}

export function ProjectUsageBreakdown({ providers = [], topModels = [], projectName = "" }) {
  const providerRows = Array.isArray(providers) ? providers : [];
  const modelRows = Array.isArray(topModels) ? topModels : [];
  if (!providerRows.length) return null;
  const projectLabel = projectName || copy("shared.placeholder.short");

  return (
    <div className="border-t border-oai-gray-200 px-4 py-4 dark:border-oai-gray-800">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h4 className="text-xs font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
          {copy("dashboard.projects.breakdown_heading")}
        </h4>
        <div className="text-[11px] text-oai-gray-500 dark:text-oai-gray-400">
          {copy("dashboard.projects.breakdown_columns")}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-oai-gray-200/80 bg-oai-black/[0.02] px-3 py-3 dark:border-oai-gray-800/80 dark:bg-white/[0.04]">
          <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
            {copy("dashboard.projects.breakdown_provider_mix")}
          </div>
          <MiniBarChart
            ariaLabel={copy("dashboard.projects.breakdown_provider_mix_aria", { project: projectLabel })}
            accent="cost"
            rows={buildUsageRows(providerRows)}
          />
        </div>

        <div className="rounded-lg border border-oai-gray-200/80 bg-oai-black/[0.02] px-3 py-3 dark:border-oai-gray-800/80 dark:bg-white/[0.04]">
          <div className="mb-3 text-[11px] font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
            {copy("dashboard.projects.breakdown_model_mix")}
          </div>
          <MiniBarChart
            ariaLabel={copy("dashboard.projects.breakdown_model_mix_aria", { project: projectLabel })}
            accent="project"
            rows={buildUsageRows(modelRows)}
          />
        </div>
      </div>

      {modelRows.length ? (
        <div className="mt-4">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
            {copy("dashboard.projects.breakdown_models_used")}
          </div>
          <ProviderModelChips items={modelRows} />
        </div>
      ) : null}

      <ul className="mt-4">
        {providerRows.map((providerEntry, index) => (
          <ProviderRow
            key={`${String(providerEntry?.provider || "provider")}-${index}`}
            providerEntry={providerEntry}
          />
        ))}
      </ul>
    </div>
  );
}
