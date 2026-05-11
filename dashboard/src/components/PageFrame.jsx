import React from "react";
import { cn } from "../lib/cn";

export function PageFrame({
  title,
  subtitle,
  actions = null,
  maxWidth = "max-w-7xl",
  hideHeader = false,
  compact = false,
  children,
}) {
  const compactFrame = hideHeader || compact;
  return (
    <div className="flex flex-1 flex-col font-oai text-oai-black antialiased dark:text-oai-white">
      <main className={compactFrame ? "flex-1 overflow-hidden py-2 sm:py-2" : "flex-1 pb-12 pt-8 sm:pb-16 sm:pt-10"}>
        <div className={cn("mx-auto px-4 sm:px-6 lg:px-8", maxWidth)}>
          {hideHeader ? null : (
            <header className={cn("flex flex-wrap items-start justify-between gap-4", compact ? "mb-3" : "mb-8")}>
              <div className="min-w-0">
                <h1 className={cn("font-semibold tracking-tight text-oai-black dark:text-white", compact ? "text-2xl sm:text-3xl" : "text-3xl sm:text-4xl")}>
                  {title}
                </h1>
                {subtitle ? (
                  <p className={cn("max-w-3xl text-sm text-oai-gray-500 dark:text-oai-gray-400", compact ? "mt-1 leading-5" : "mt-2 leading-6 sm:text-base")}>
                    {subtitle}
                  </p>
                ) : null}
              </div>
              {actions ? <div className="shrink-0">{actions}</div> : null}
            </header>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
