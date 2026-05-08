import React from "react";
import { copy } from "../../../lib/copy";
import { formatCompactNumber } from "../../../lib/format";

// Brand-aligned color palette for AI models - distinct colors per vendor
const MODEL_BRAND_COLORS = {
  // OpenAI / GPT models - Blue family
  "gpt-5.4": "#3b82f6",
  "gpt-5.1": "#2563eb",
  "gpt-5.4-mini": "#60a5fa",
  "gpt-5.1-codex-mini": "#93c5fd",
  "gpt-4o": "#3b82f6",
  "gpt-4": "#2563eb",
  "gpt-4-turbo": "#60a5fa",
  "gpt-3.5": "#93c5fd",
  "o1": "#1d4ed8",
  "o3": "#1e40af",

  // Anthropic / Claude models - Violet/Purple family
  "claude-opus-4-6": "#7c3aed",
  "claude-haiku-4-5": "#8b5cf6",
  "kimi-for-coding": "#6d28d9",
  "kimi-k2.5": "#a78bfa",
  "claude-opus": "#7c3aed",
  "claude-sonnet": "#8b5cf6",
  "claude-haiku": "#a78bfa",
  "claude": "#7c3aed",

  // Google / Gemini models - Teal/Cyan family
  "gemini-3.1-pro-preview": "#0891b2",
  "gemini": "#06b6d4",
  "gemini-pro": "#22d3ee",
  "gemini-ultra": "#0891b2",

  // Codex - Emerald green
  "codex": "#059669",

  // Cursor - Amber/Gold family
  "cursor": "#f59e0b",
  "composer-1": "#f59e0b",
  "composer-1.5": "#f59e0b",
  "composer-2-fast": "#d97706",

  // Fallback palette for unknown models - diverse colors
  "fallback": [
    "#3b82f6", // Blue
    "#7c3aed", // Violet
    "#0891b2", // Cyan
    "#059669", // Emerald
    "#f59e0b", // Amber
    "#ef4444", // Red
    "#ec4899", // Pink
  ],
};

function getModelColor(modelName, index = 0) {
  if (!modelName) return MODEL_BRAND_COLORS.fallback[index % MODEL_BRAND_COLORS.fallback.length];

  const normalizedName = modelName.toLowerCase().replace(/[_\-\s.]/g, "");

  // Direct match
  for (const [key, color] of Object.entries(MODEL_BRAND_COLORS)) {
    if (typeof color === "string" && normalizedName.includes(key.toLowerCase().replace(/[_\-\s.]/g, ""))) {
      return color;
    }
  }

  // Partial match for model families
  if (normalizedName.includes("gpt") || normalizedName.includes("o1") || normalizedName.includes("o3")) {
    return MODEL_BRAND_COLORS["gpt-5.4"];
  }
  if (normalizedName.includes("claude") || normalizedName.includes("kimi")) {
    return MODEL_BRAND_COLORS["claude-opus-4-6"];
  }
  if (normalizedName.includes("gemini")) {
    return MODEL_BRAND_COLORS["gemini-3.1-pro-preview"];
  }
  if (normalizedName.includes("codex")) {
    return MODEL_BRAND_COLORS["codex"];
  }
  if (normalizedName.includes("composer") || normalizedName.includes("cursor")) {
    return "#f59e0b";
  }

  return MODEL_BRAND_COLORS.fallback[index % MODEL_BRAND_COLORS.fallback.length];
}

export const NeuralAdaptiveFleet = React.memo(function NeuralAdaptiveFleet({
  label,
  totalPercent,
  usage = 0,
  models = [],
}) {
  const percentSymbol = copy("shared.unit.percent");
  const thousandSuffix = copy("shared.unit.thousand_abbrev");
  const millionSuffix = copy("shared.unit.million_abbrev");
  const billionSuffix = copy("shared.unit.billion_abbrev");
  const usageValue = formatCompactNumber(usage, {
    thousandSuffix,
    millionSuffix,
    billionSuffix,
    decimals: 1,
  });
  const usageLabel = copy("dashboard.model_breakdown.usage_label", {
    value: usageValue,
  });

  return (
    <div className="w-full space-y-4">
      {/* Header with enhanced visual hierarchy */}
      <div className="flex justify-between items-center pb-3">
        <div className="flex items-center gap-3">
          <span className="text-base font-semibold text-oai-gray-900 dark:text-oai-gray-100">{label}</span>
          <span className="text-xs font-medium text-oai-gray-500 dark:text-oai-gray-300 bg-oai-gray-100/80 dark:bg-oai-gray-800/80 px-2.5 py-1 rounded-full">{usageLabel}</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold text-oai-black dark:text-oai-white tabular-nums tracking-tight">{totalPercent}</span>
          <span className="text-sm font-semibold text-oai-gray-400 dark:text-oai-gray-400">{percentSymbol}</span>
        </div>
      </div>

      {/* Progress bar - thinner style */}
      <div className="h-2 w-full bg-oai-gray-100 dark:bg-oai-gray-800 flex overflow-hidden rounded-full">
        {models.map((model, index) => {
          const color = getModelColor(model.name, index);
          const modelKey = model?.id ? String(model.id) : `${model.name}-${index}`;
          return (
            <div
              key={modelKey}
              className="h-full transition-all duration-500 ease-out hover:opacity-80 cursor-pointer"
              style={{
                width: `${model.share}%`,
                backgroundColor: color,
              }}
              title={`${model.name}: ${model.share}${percentSymbol}`}
            />
          );
        })}
      </div>

      {/* Model legend with enhanced visuals */}
      <div className="grid grid-cols-2 gap-y-2 gap-x-4">
        {models.map((model, index) => {
          const color = getModelColor(model.name, index);
          const modelKey = model?.id ? String(model.id) : `${model.name}-${index}`;
          return (
            <div
              key={modelKey}
              className="flex items-center gap-2.5 group cursor-pointer hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800 rounded-lg p-1.5 -ml-1.5 transition-all duration-200"
            >
              <div
                className="w-3 h-3 rounded-full shrink-0 shadow-sm ring-2 ring-white dark:ring-oai-gray-900"
                style={{ backgroundColor: color }}
              />
              <div className="flex items-baseline gap-1.5 min-w-0">
                <span
                  className="text-sm truncate text-oai-gray-700 dark:text-oai-gray-300 font-medium group-hover:text-oai-black dark:group-hover:text-oai-white transition-colors"
                  title={model.name}
                >
                  {model.name}
                </span>
                <span
                  className="text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded-md"
                  style={{
                    backgroundColor: `${color}15`,
                    color: color,
                  }}
                >
                  {model.share}{percentSymbol}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
