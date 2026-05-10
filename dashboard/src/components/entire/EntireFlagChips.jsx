import React from "react";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";

const CONFIGURE_FLAGS = [
  {
    token: "--telemetry=false",
    labelKey: "entire.configure.flags.telemetry_off",
    group: "telemetry",
  },
  {
    token: "--telemetry=true",
    labelKey: "entire.configure.flags.telemetry_on",
    group: "telemetry",
  },
];

export function EntireFlagChips({ selectedFlags = [], onToggle }) {
  return (
    <div>
      <div className="mb-2 text-xs font-medium text-oai-gray-600 dark:text-oai-gray-300">
        {copy("entire.configure.flags.label")}
      </div>
      <div className="flex flex-wrap gap-2">
        {CONFIGURE_FLAGS.map((flag) => {
          const selected = selectedFlags.includes(flag.token);
          return (
            <button
              key={flag.token}
              type="button"
              aria-pressed={selected}
              className={cn(
                "rounded-md border px-2.5 py-1.5 text-xs transition-colors focus:outline-none focus:ring-2 focus:ring-oai-black/15 dark:focus:ring-white/20",
                selected
                  ? "border-oai-black bg-oai-black text-white dark:border-white dark:bg-white dark:text-oai-black"
                  : "border-oai-gray-200 text-oai-gray-700 hover:border-oai-gray-300 hover:bg-oai-black/[0.03] dark:border-oai-gray-800 dark:text-oai-gray-200 dark:hover:bg-white/[0.08]",
              )}
              onClick={() => onToggle?.(flag)}
            >
              {copy(flag.labelKey)}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-oai-gray-500 dark:text-oai-gray-400">
        {copy("entire.configure.flags.hint")}
      </p>
    </div>
  );
}
