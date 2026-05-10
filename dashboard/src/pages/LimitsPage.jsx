import React from "react";
import { Link } from "react-router-dom";
import { Settings as SettingsIcon } from "lucide-react";
import { useUsageLimits } from "../hooks/use-usage-limits";
import { useLimitsDisplayPrefs } from "../hooks/use-limits-display-prefs.js";
import { copy } from "../lib/copy";
import { LimitsPageSkeleton } from "../components/LimitsPageSkeleton.jsx";
import { UsageLimitsPanel } from "../ui/matrix-a/components/UsageLimitsPanel.jsx";
import { PageFrame } from "../components/PageFrame.jsx";

export function LimitsPage() {
  const { data: usageLimits, error, isLoading } = useUsageLimits({ initialRefresh: true });
  const prefs = useLimitsDisplayPrefs();

  return (
    <PageFrame
      title={copy("nav.limits")}
      subtitle={copy("limits.page.subtitle")}
      maxWidth="max-w-6xl"
      actions={(
        <Link
          to="/settings"
          aria-label={copy("limits.page.openSettings")}
          title={copy("limits.page.openSettings")}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-oai-gray-200 text-oai-gray-600 no-underline transition-colors hover:bg-oai-gray-100 hover:text-oai-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500 dark:border-oai-gray-800 dark:text-oai-gray-400 dark:hover:bg-oai-gray-800 dark:hover:text-white"
        >
          <SettingsIcon className="h-4 w-4" aria-hidden />
        </Link>
      )}
    >
      {isLoading ? (
        <LimitsPageSkeleton />
      ) : (
        <>
          {error ? (
            <p className="mb-4 text-sm text-red-500 dark:text-red-400">
              {copy("shared.error.prefix", { error })}
            </p>
          ) : null}
          <UsageLimitsPanel
            claude={usageLimits?.claude}
            codex={usageLimits?.codex}
            cursor={usageLimits?.cursor}
            gemini={usageLimits?.gemini}
            kimi={usageLimits?.kimi}
            kiro={usageLimits?.kiro}
            antigravity={usageLimits?.antigravity}
            copilot={usageLimits?.copilot}
            order={prefs.order}
            visibility={prefs.visibility}
          />
        </>
      )}
    </PageFrame>
  );
}
