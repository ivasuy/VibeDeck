import React from "react";
import { cn } from "../../lib/cn";
import { copy } from "../../lib/copy";

export const CONFIDENCE_CLASS = {
  high: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  medium: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  low: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  unattributed: "bg-red-500/10 text-red-700 dark:text-red-300",
};

function normalizeConfidence(value) {
  const key = String(value || "").toLowerCase();
  return Object.prototype.hasOwnProperty.call(CONFIDENCE_CLASS, key) ? key : "unattributed";
}

export function ConfidenceBadge({ confidence, className = "" }) {
  const normalized = normalizeConfidence(confidence);
  let label = copy("shared.confidence.unattributed");
  if (normalized === "high") label = copy("shared.confidence.high");
  else if (normalized === "medium") label = copy("shared.confidence.medium");
  else if (normalized === "low") label = copy("shared.confidence.low");
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-md px-2 text-xs font-medium capitalize",
        CONFIDENCE_CLASS[normalized],
        className,
      )}
    >
      {label}
    </span>
  );
}
