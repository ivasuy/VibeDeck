import React, { useEffect, useMemo, useState } from "react";
import { EmptyState, KpiCard, PageShell, SectionHeader, SimpleBar, SkeletonKpiGrid, SkeletonRows, Surface } from "../components/RevampSurfaces.jsx";
import { ProviderLogo } from "../lib/provider-logos.jsx";
import { formatUsdCurrency, toDisplayNumber } from "../lib/format";
import { getModelsView } from "../lib/api";

function topTask(taskCategories) {
  const entries = Object.entries(taskCategories || {}).sort((a, b) => Number(b[1]) - Number(a[1]) || a[0].localeCompare(b[0]));
  return entries[0]?.[0] || "-";
}

export function ModelsPage() {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    getModelsView()
      .then((nextPayload) => {
        if (active) setPayload(nextPayload || {});
      })
      .catch(() => {
        if (!active) return;
        setPayload(null);
        setError("Unable to load model usage.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const models = Array.isArray(payload?.models) ? payload.models : [];
  const empty = !loading && !error && models.length === 0;
  const maxTokens = useMemo(() => Math.max(...models.map((model) => Number(model.total_tokens || 0)), 1), [models]);
  const totals = payload?.totals || {};

  return (
    <PageShell title="Models" subtitle="Ranked model usage with provider identity and cost context.">
      <div className="mb-5">
        {loading ? (
          <>
            <span className="sr-only">Loading parity data...</span>
            <SkeletonKpiGrid count={3} />
          </>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard label="Model count" value={toDisplayNumber(models.length)} detail="in selected window" accent />
            <KpiCard label="Tokens" value={toDisplayNumber(totals.total_tokens || 0)} />
            <KpiCard label="Cost" value={formatUsdCurrency(totals.total_cost_usd || "0.0000", { decimals: 4 })} />
          </div>
        )}
      </div>

      <Surface>
        <SectionHeader title="Top models" />
        {loading ? <SkeletonRows rows={5} /> : null}
        {error ? <EmptyState title={error} body="Check that the local VibeDeck server is running, then refresh." /> : null}
        {empty ? <EmptyState title="No data for this window yet." body="Try a wider range, or check back after more sessions." /> : null}
        {models.length ? (
          <div className="divide-y divide-oai-gray-200/70 dark:divide-oai-gray-800/70">
            {models.map((model) => {
              const providers = Array.isArray(model.providers) ? model.providers : [];
              const primaryProvider = providers[0] || "codex";
              return (
                <div key={model.model} className="grid gap-3 py-3 lg:grid-cols-[minmax(180px,0.9fr)_minmax(0,1fr)_auto_auto_auto] lg:items-center">
                  <div className="flex min-w-0 items-center gap-2">
                    <ProviderLogo provider={primaryProvider} size={18} className="text-oai-gray-700 dark:text-oai-gray-200" />
                    <span className="min-w-0 truncate font-medium text-oai-black dark:text-white">{model.model || "unknown"}</span>
                  </div>
                  <SimpleBar value={Number(model.total_tokens || 0)} max={maxTokens} />
                  <span className="tabular-nums text-oai-gray-600 dark:text-oai-gray-300">{toDisplayNumber(model.total_tokens)}</span>
                  <span className="tabular-nums text-oai-gray-600 dark:text-oai-gray-300">{formatUsdCurrency(model.total_cost_usd, { decimals: 4 })}</span>
                  <span className="text-oai-gray-600 dark:text-oai-gray-300">{topTask(model.task_categories)}</span>
                  <span className="sr-only">{providers.join(", ") || "-"}</span>
                </div>
              );
            })}
          </div>
        ) : null}
      </Surface>
    </PageShell>
  );
}
