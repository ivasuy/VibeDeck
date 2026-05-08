import React from "react";
import { copy } from "../../../lib/copy";

function normalizeBadgePart(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function toTitleWords(value) {
  const normalized = normalizeBadgePart(value);
  if (!normalized) return "";
  return normalized
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((token) => token.slice(0, 1).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function buildSubscriptionItems(subscriptions) {
  if (!Array.isArray(subscriptions)) return [];
  const deduped = new Map();
  for (const entry of subscriptions) {
    if (!entry || typeof entry !== "object") continue;
    const toolRaw = normalizeBadgePart(entry.tool);
    const planRaw = normalizeBadgePart(entry.planType) || normalizeBadgePart(entry.plan_type);
    if (!toolRaw || !planRaw) continue;
    const tool = toTitleWords(toolRaw) || toolRaw;
    const plan = toTitleWords(planRaw) || planRaw;
    deduped.set(`${toolRaw.toLowerCase()}::${planRaw.toLowerCase()}`, { tool, plan });
  }
  return Array.from(deduped.values());
}

export function IdentityCard({
  title = copy("identity_card.title_default"),
  subtitle,
  rankLabel,
  streakDays,
  subscriptions = [],
  showStats = true,
  className = "",
}) {
  const rankValue = rankLabel ?? copy("identity_card.rank_placeholder");
  const streakValue = Number.isFinite(Number(streakDays))
    ? copy("identity_card.streak_value", { days: Number(streakDays) })
    : copy("identity_card.rank_placeholder");
  const shouldShowStats = showStats && (rankLabel !== undefined || streakDays !== undefined);
  const subscriptionItems = buildSubscriptionItems(subscriptions);

  return (
    <div className={`rounded-xl border border-oai-gray-200 dark:border-oai-gray-800 bg-white dark:bg-oai-gray-900 p-5 ${className}`}>
      {(title || subtitle) && (
        <div className="mb-3">
          {title && (
            <h3 className="text-sm font-medium text-oai-gray-500 dark:text-oai-gray-300 uppercase tracking-wide">{title}</h3>
          )}
          {subtitle && <p className="text-sm text-oai-gray-400 dark:text-oai-gray-400 mt-0.5">{subtitle}</p>}
        </div>
      )}

      <div className="space-y-3">
        {/* Stats */}
        {shouldShowStats ? (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-oai-gray-200 dark:border-oai-gray-800 bg-oai-gray-50 dark:bg-oai-gray-800 p-3 text-center">
              <div className="text-xs font-medium text-oai-gray-500 dark:text-oai-gray-300 uppercase tracking-wide mb-0.5">
                {copy("identity_card.rank_label")}
              </div>
              <div className="text-lg font-semibold text-oai-black dark:text-oai-white tabular-nums">{rankValue}</div>
            </div>
            <div className="rounded-lg border border-oai-gray-200 dark:border-oai-gray-800 bg-oai-gray-50 dark:bg-oai-gray-800 p-3 text-center">
              <div className="text-xs font-medium text-oai-gray-500 dark:text-oai-gray-300 uppercase tracking-wide mb-0.5">
                {copy("identity_card.streak_label")}
              </div>
              <div className="text-lg font-semibold text-oai-black dark:text-oai-white tabular-nums">{streakValue}</div>
            </div>
          </div>
        ) : null}

        {/* Subscriptions */}
        {subscriptionItems.length !== 0 ? (
          <div>
            <div className="mb-1.5 text-xs font-medium text-oai-gray-500 dark:text-oai-gray-300 uppercase tracking-wide">
              {copy("identity_card.subscriptions_label")}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {subscriptionItems.map((entry, index) => (
                <span
                  key={`${entry.tool}:${entry.plan}:${index}`}
                  className="inline-flex items-center px-2 py-0.5 rounded bg-oai-gray-100 dark:bg-oai-gray-800 text-xs text-oai-gray-700 dark:text-oai-gray-300"
                >
                  {copy("identity_card.subscription_item", {
                    tool: entry.tool,
                    plan: entry.plan,
                  })}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
