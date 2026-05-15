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

  return (
    <section className={cn("vd-card rounded-3xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 shadow-glass backdrop-blur-[var(--glass-blur)]", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-oai-black dark:text-white">Checkpoint timeline</h2>
          <p className="mt-1 max-w-3xl text-sm text-oai-gray-500 dark:text-oai-gray-400">
            Accumulated metadata, usage, cost, prompts, and captured activity for each checkpoint are shown here.
          </p>
        </div>
        {hasRepo && hasCheckpointData && available && cards.length > 0 ? (
          <span className="shrink-0 text-xs font-medium text-oai-gray-500 dark:text-oai-gray-400">
            {cards.length} checkpoint{cards.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>

      <div className="mt-4">
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

