import React from "react";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";
import { getCheckpoint } from "../../lib/vibedeck-api";
import { buildCheckpointCards } from "./checkpoint-card-utils";
import { CheckpointCard } from "./CheckpointCard.jsx";

function unavailableReasonText(checkpoints) {
  const reason = String(checkpoints?.reason || "").trim();
  if (reason === "branch_not_fetched") return copy("entire.checkpoints.reason.branch_not_fetched");
  if (reason === "git_error") {
    const detail = String(checkpoints?.detail || "").trim();
    return detail
      ? copy("entire.checkpoints.reason.git_error_detail", { detail })
      : copy("entire.checkpoints.reason.git_error");
  }
  return copy("entire.checkpoints.none");
}

function timelineSummary(cards) {
  const safeCards = Array.isArray(cards) ? cards : [];
  const totalCost = safeCards.reduce((sum, card) => {
    const value = Number(card?.totalCostUsd);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
  const linked = safeCards.filter((card) => card?.usage && !card?.statusLabel).length;
  const needsReview = safeCards.filter((card) => !card?.usage || card?.statusLabel).length;

  return {
    linked,
    needsReview,
    linkedLabel: linked > 0 ? linked : "None",
    needsReviewLabel: needsReview > 0 ? needsReview : "None",
    totalCostLabel: totalCost > 0 ? `$${totalCost.toFixed(2)} total` : "No cost",
  };
}

function SummaryPill({ label, value, tone = "neutral" }) {
  return (
    <div
      className={[
        "rounded-xl border px-3 py-2",
        tone === "review"
          ? "border-amber-500/20 bg-amber-500/10"
          : "border-[var(--vd-border)] bg-white/70 dark:bg-oai-gray-900/55",
      ].join(" ")}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-oai-black dark:text-white">{value}</div>
    </div>
  );
}

export function CheckpointTimeline({
  repo = "",
  checkpoints = null,
  loading = false,
  error = "",
  className = "",
  getCheckpointImpl = getCheckpoint,
}) {
  const cards = buildCheckpointCards({ checkpoints });
  const hasRepo = String(repo || "").trim().length > 0;
  const hasCheckpointData = checkpoints && typeof checkpoints === "object";
  const available = checkpoints?.available === true;
  const summary = timelineSummary(cards);

  return (
    <section className={cn("vd-card grid h-full min-h-[520px] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-3xl border border-[var(--glass-border)] bg-[var(--glass-bg)] shadow-glass backdrop-blur-[var(--glass-blur)]", className)}>
      <div className="grid gap-3 border-b border-[var(--vd-border)] px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-oai-black dark:text-white">Checkpoint timeline</h2>
          <p className="mt-1 max-w-3xl text-sm text-oai-gray-500 dark:text-oai-gray-400">
            Review each checkpoint as a costed work unit: intent, metadata calls, model breakdown, and captured activity stay grouped together.
          </p>
        </div>
        {hasRepo && hasCheckpointData && available && cards.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:min-w-[440px]">
            <SummaryPill label="Checkpoints" value={cards.length} />
            <SummaryPill label="Linked" value={summary.linkedLabel} />
            <SummaryPill label="Review" value={summary.needsReviewLabel} tone={summary.needsReview > 0 ? "review" : "neutral"} />
            <SummaryPill label="Cost" value={summary.totalCostLabel} />
          </div>
        ) : null}
      </div>

      <div className="min-h-0 overflow-y-auto overflow-x-hidden p-5">
        {loading ? (
          <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("entire.checkpoints.loading")}</p>
        ) : error ? (
          <p className="text-sm text-red-700 dark:text-red-300">{copy("entire.checkpoints.error", { error })}</p>
        ) : !hasRepo ? (
          <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">Load a repo to view checkpoint usage.</p>
        ) : !hasCheckpointData || !available || cards.length === 0 ? (
          <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">{unavailableReasonText(checkpoints)}</p>
        ) : (
          <div className="space-y-4">
            {cards.map((card) => (
              <CheckpointCard key={card.id} repo={repo} card={card} getCheckpointImpl={getCheckpointImpl} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
