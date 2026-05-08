import React from "react";
import { Info } from "lucide-react";
import { copy } from "../../../lib/copy";
import { Button, Counter } from "../../openai/components";

function normalizePeriods(periods) {
  if (!Array.isArray(periods)) return [];
  return periods.map((p) => {
    if (typeof p === "string") {
      return { key: p, label: p.toUpperCase() };
    }
    return { key: p.key, label: p.label || String(p.key).toUpperCase() };
  });
}

function parseAnimatedCounterValue(displayValue) {
  if (typeof displayValue !== "string") return null;
  const match = displayValue.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

export const UsagePanel = React.memo(function UsagePanel({
  title = copy("usage.panel.title"),
  period,
  periods,
  onPeriodChange,
  metrics = [],
  showSummary = false,
  summaryLabel = copy("usage.summary.total_system_output"),
  summaryValue = "—",
  summaryCostValue,
  onCostInfo,
  costInfoLabel = copy("usage.cost_info.label"),
  summarySubLabel,
  breakdown,
  breakdownCollapsed = false,
  onToggleBreakdown,
  collapseLabel,
  expandLabel,
  collapseAriaLabel,
  expandAriaLabel,
  useSummaryLayout = false,
  onRefresh,
  loading = false,
  error,
  rangeLabel,
  rangeTimeZoneLabel,
  statusLabel,
  hideHeader = false,
  className = "",
}) {
  const tabs = normalizePeriods(periods);
  const toggleLabel = breakdownCollapsed ? expandLabel : collapseLabel;
  const toggleAriaLabel = breakdownCollapsed ? expandAriaLabel : collapseAriaLabel;
  const summaryCounterValue = parseAnimatedCounterValue(String(summaryValue ?? ""));
  const showAnimatedSummary = summaryCounterValue != null;
  const showBreakdownToggle = Boolean(onToggleBreakdown && toggleLabel);
  const breakdownRows =
    breakdown && breakdown.length
      ? breakdown
      : [
          {
            key: copy("usage.metric.input"),
            label: copy("usage.metric.input"),
          },
          {
            key: copy("usage.metric.output"),
            label: copy("usage.metric.output"),
          },
          {
            key: copy("usage.metric.cached_input"),
            label: copy("usage.metric.cached_short"),
          },
          {
            key: copy("usage.metric.reasoning_output"),
            label: copy("usage.metric.reasoning_short"),
          },
        ]
          .map((item) => {
            const match = metrics.find((row) => row.label === item.key);
            if (!match) return null;
            return { label: item.label, value: match.value };
          })
          .filter(Boolean);

  return (
    <div className={`rounded-xl border border-oai-gray-200 dark:border-oai-gray-800 bg-white dark:bg-oai-gray-900 p-5 ${className}`}>
      {!hideHeader ? (
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex flex-wrap gap-1">
            {tabs.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`text-xs font-medium px-2 py-1 rounded transition-colors ${
                  period === p.key
                    ? "text-oai-black dark:text-oai-white bg-oai-gray-100 dark:bg-oai-gray-800"
                    : "text-oai-gray-500 dark:text-oai-gray-300 hover:text-oai-black dark:hover:text-oai-white hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800"
                }`}
                onClick={() => onPeriodChange?.(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {showBreakdownToggle && (
              <Button size="sm" variant="ghost" onClick={onToggleBreakdown}>
                {toggleLabel}
              </Button>
            )}
            {onRefresh && (
              <Button variant="secondary" size="sm" disabled={loading} onClick={onRefresh}>
                ↻
              </Button>
            )}
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="text-sm text-red-400 px-2 py-2 bg-red-500/10 rounded-lg border border-red-500/20 mb-4">
          {copy("shared.error.prefix", { error })}
        </div>
      ) : null}

      {showSummary || useSummaryLayout ? (
        <div className="flex-1 flex flex-col items-center justify-center space-y-8 py-8">
          <div className="text-center animate-fade-in">
            <div className="text-xs text-oai-gray-500 dark:text-oai-gray-300 uppercase tracking-wide mb-4">
              {summaryLabel}
            </div>
            <div className="text-display-sm md:text-display font-bold text-oai-black dark:text-oai-white tracking-tighter tabular-nums leading-none">
              {showAnimatedSummary ? (
                <Counter
                  value={summaryCounterValue}
                  displayValue={summaryValue}
                  fontSize={72}
                  padding={8}
                  gap={1}
                  textColor="var(--oai-black, #111827)"
                  fontWeight={700}
                  gradientHeight={12}
                  gradientFrom="rgba(255,255,255,0.96)"
                  gradientTo="rgba(255,255,255,0)"
                  counterStyle={{
                    paddingLeft: 0,
                    paddingRight: 0,
                    gap: "0.01em",
                  }}
                  digitStyle={{ width: "0.9ch" }}
                />
              ) : (
                summaryValue
              )}
            </div>
            {summaryCostValue ? (
              <div className="flex items-center justify-center gap-2 mt-6">
                <span className="sr-only">{copy("usage.metric.total_cost")}</span>
                {onCostInfo ? (
                  <button
                    type="button"
                    onClick={onCostInfo}
                    title={costInfoLabel}
                    aria-label={costInfoLabel}
                    className="inline-flex items-center gap-1.5 text-xl md:text-2xl font-semibold text-oai-brand hover:text-oai-brand-dark dark:hover:text-oai-brand-light transition-colors cursor-pointer"
                  >
                    {summaryCostValue}
                    <Info size={16} strokeWidth={2} className="text-oai-gray-400 dark:text-oai-gray-500" />
                  </button>
                ) : (
                  <span className="text-xl md:text-2xl font-semibold text-oai-brand">
                    {summaryCostValue}
                  </span>
                )}
              </div>
            ) : null}
            {summarySubLabel ? (
              <div className="text-sm text-oai-gray-500 mt-3 font-medium">{summarySubLabel}</div>
            ) : null}
          </div>

          {!breakdownCollapsed && breakdownRows.length ? (
            <div className="w-full max-w-lg">
              <div className="grid grid-cols-2 gap-3">
                {breakdownRows.map((row, idx) => (
                  <div
                    key={`${row.label}-${idx}`}
                    className="flex flex-col items-center py-3"
                  >
                    <span className="text-xs text-oai-gray-400 dark:text-oai-gray-400 mb-1">{row.label}</span>
                    <span className="text-lg font-semibold text-oai-black dark:text-oai-white tabular-nums">
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-5">
          {metrics.map((row, idx) => (
            <div key={`${row.label}-${idx}`} className="text-center py-2">
              <div className="text-xs text-oai-gray-400 dark:text-oai-gray-400 mb-1">{row.label}</div>
              <div className={`text-lg font-semibold text-oai-black dark:text-oai-white ${row.valueClassName || ""}`}>
                {row.value}
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  );
});
