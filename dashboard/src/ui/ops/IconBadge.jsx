import React from "react";
import { cn } from "../../lib/cn";
import { getAccentToken } from "./AccentTokens";

export function IconBadge({
  accent = "default",
  icon: IconOverride,
  label,
  className = "",
  iconClassName = "",
}) {
  const token = getAccentToken(accent);
  const Icon = IconOverride || token.icon;

  return (
    <span
      aria-label={label}
      className={cn(
        "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-[11px]",
        token.badgeClassName,
        className,
      )}
    >
      <Icon className={cn("h-3.5 w-3.5", iconClassName)} aria-hidden="true" />
    </span>
  );
}
