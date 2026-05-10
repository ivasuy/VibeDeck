import React from "react";
import { cn } from "../../lib/cn";
import { Card } from "../openai/components";
import { getAccentToken } from "./AccentTokens";
import { IconBadge } from "./IconBadge";

export function EmptyStatePanel({
  accent = "default",
  title,
  description,
  action = null,
  className = "",
}) {
  const token = getAccentToken(accent);

  return (
    <Card className={cn("border-dashed", className)}>
      <div className={cn("rounded-lg border p-4", token.panelClassName)}>
        <div className="flex items-start gap-3">
          <IconBadge accent={accent} label={title} />
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold text-oai-black dark:text-oai-white">{title}</h3>
            {description ? (
              <p className="mt-1 text-sm text-oai-gray-500 dark:text-oai-gray-400">{description}</p>
            ) : null}
            {action ? <div className="mt-3">{action}</div> : null}
          </div>
        </div>
      </div>
    </Card>
  );
}
