import React from "react";
import { cn } from "../lib/cn";

export function PageFrame({
  title,
  subtitle,
  actions = null,
  maxWidth = "max-w-7xl",
  hideHeader = false,
  children,
}) {
  return (
    <div className="flex flex-1 flex-col font-oai text-oai-black antialiased dark:text-oai-white">
      <main className="flex-1 pb-12 pt-8 sm:pb-16 sm:pt-10">
        <div className={cn("mx-auto px-4 sm:px-6 lg:px-8", maxWidth)}>
          {hideHeader ? null : (
            <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-3xl font-semibold tracking-tight text-oai-black dark:text-white sm:text-4xl">
                  {title}
                </h1>
                {subtitle ? (
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-oai-gray-500 dark:text-oai-gray-400 sm:text-base">
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
