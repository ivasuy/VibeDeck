import React from "react";
import { cn } from "../../lib/cn";
import { EntireActionsPanel } from "./EntireActionsPanel";
import { AdvancedConfigurePanel } from "./AdvancedConfigurePanel";
import { EntireMaintenancePanel } from "./EntireMaintenancePanel";

function ControlSection({ title, children }) {
  return (
    <section className="rounded-xl border border-[var(--vd-border)] bg-white/70 p-4 shadow-[0_12px_32px_rgba(15,23,42,0.035)] dark:bg-oai-gray-900/60">
      <h3 className="text-sm font-semibold leading-5 text-oai-black dark:text-white">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function EntireControlPanel({ repo = "", onActionSuccess, className = "" }) {
  const selectedRepo = String(repo || "").trim();

  return (
    <section
      className={cn(
        "vd-card grid min-h-[420px] grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] shadow-glass backdrop-blur-[var(--glass-blur)]",
        className,
      )}
    >
      <header className="border-b border-[var(--vd-border)] px-5 py-4">
        <h2 className="text-sm font-semibold text-oai-black dark:text-white">Controls</h2>
        <p className="mt-1 text-xs leading-5 text-oai-gray-500 dark:text-oai-gray-400">
          Keep agent actions, configuration, and maintenance grouped around the selected repository.
        </p>
      </header>

      <div className="min-h-0 overflow-auto p-5">
        {!selectedRepo ? (
          <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">
            Select a repo to manage Entire controls.
          </p>
        ) : (
          <div className="space-y-4">
            <ControlSection title="Agents and status">
              <EntireActionsPanel repo={selectedRepo} onActionSuccess={onActionSuccess} />
            </ControlSection>
            <ControlSection title="Configure">
              <AdvancedConfigurePanel repo={selectedRepo} onActionSuccess={onActionSuccess} />
            </ControlSection>
            <ControlSection title="Maintenance">
              <EntireMaintenancePanel repo={selectedRepo} onActionSuccess={onActionSuccess} />
            </ControlSection>
          </div>
        )}
      </div>
    </section>
  );
}
