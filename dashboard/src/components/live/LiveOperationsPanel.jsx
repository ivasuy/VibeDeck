import React from "react";
import { LiveProviderLimitsGrid } from "./LiveProviderLimitsGrid";
import { LiveSessionList } from "./LiveSessionList";

export function LiveOperationsPanel({
  sessions,
  selectedKey,
  onSelectSession,
  streamStatus,
  streamError,
  limits,
  limitsLoading,
  limitsError,
}) {
  return (
    <section className="vd-card flex h-[calc(100dvh-326px)] min-h-[500px] max-h-[640px] flex-col overflow-hidden rounded-xl border border-oai-gray-200 bg-white dark:border-oai-gray-800 dark:bg-oai-gray-900">
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(360px,0.9fr)_minmax(0,1.1fr)]">
        <div className="min-h-0 border-b border-[var(--vd-border)] lg:border-b-0 lg:border-r">
          <LiveProviderLimitsGrid
            sessions={sessions}
            limits={limits}
            loading={limitsLoading}
            error={limitsError}
            embedded
            className="h-full"
          />
        </div>
        <div className="min-h-0">
          <LiveSessionList
            sessions={sessions}
            selectedKey={selectedKey}
            onSelectSession={onSelectSession}
            streamStatus={streamStatus}
            streamError={streamError}
            embedded
            className="h-full"
          />
        </div>
      </div>
    </section>
  );
}
