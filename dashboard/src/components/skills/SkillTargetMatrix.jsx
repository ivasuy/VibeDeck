import React from "react";
import { Loader2 } from "lucide-react";
import { ProviderIcon } from "../../ui/matrix-a/components/ProviderIcon.jsx";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";
import { Card } from "../../ui/openai/components";
import { IconBadge } from "../../ui/ops";

const TARGET_ACTIVE_CLASSES = {
  claude: "bg-orange-500/10 ring-1 ring-orange-500/20 hover:bg-orange-500/20",
  codex: "bg-emerald-500/10 ring-1 ring-emerald-500/20 hover:bg-emerald-500/20",
  gemini: "bg-sky-500/10 ring-1 ring-sky-500/20 hover:bg-sky-500/20",
  opencode: "bg-amber-500/10 ring-1 ring-amber-500/20 hover:bg-amber-500/20",
  hermes: "bg-indigo-500/10 ring-1 ring-indigo-500/20 hover:bg-indigo-500/20",
};

function targetBusyKey(skillId, targetId) {
  return `target:${skillId}:${targetId}`;
}

function sourceLabel(skill) {
  return skill?.repoOwner && skill?.repoName
    ? `${skill.repoOwner}/${skill.repoName}`
    : copy("skills.inventory.source_local");
}

export function SkillTargetMatrix({
  items = [],
  targets = [],
  busyKey = "",
  onToggleTarget,
}) {
  return (
    <Card bodyClassName="p-0">
      <div className="border-b border-oai-gray-200 px-4 py-3 dark:border-oai-gray-800">
        <div className="flex items-center gap-2">
          <IconBadge accent="live" label={copy("skills.matrix.title")} />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-oai-black dark:text-white">
              {copy("skills.matrix.title")}
            </h2>
            <p className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
              {copy("skills.matrix.subtitle")}
            </p>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse">
          <thead>
            <tr className="border-b border-oai-gray-200/80 bg-oai-black/[0.02] text-left dark:border-oai-gray-800/80 dark:bg-white/[0.03]">
              <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
                {copy("skills.matrix.skill_column")}
              </th>
              <th className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
                {copy("skills.matrix.source_column")}
              </th>
              {targets.map((target) => (
                <th
                  key={target.id}
                  className="px-3 py-3 text-center text-xs font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400"
                  aria-label={target.label}
                >
                  <div className="flex items-center justify-center">
                    <ProviderIcon provider={target.id} size={16} />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((skill) => {
              const activeTargets = new Set(skill.targets || []);
              return (
                <tr
                  key={skill.id || skill.key}
                  className="border-b border-oai-gray-200/80 last:border-b-0 dark:border-oai-gray-800/80"
                >
                  <td className="px-4 py-3 align-top">
                    <div className="text-sm font-medium text-oai-black dark:text-white">
                      {skill.name || skill.directory}
                    </div>
                    {skill.description ? (
                      <div className="mt-1 line-clamp-2 text-xs text-oai-gray-500 dark:text-oai-gray-400">
                        {skill.description}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 align-top text-sm text-oai-gray-600 dark:text-oai-gray-300">
                    <div className="truncate" title={sourceLabel(skill)}>
                      {sourceLabel(skill)}
                    </div>
                  </td>
                  {targets.map((target) => {
                    const checked = activeTargets.has(target.id);
                    const isBusy = busyKey === targetBusyKey(skill.id, target.id);
                    return (
                      <td key={target.id} className="px-3 py-3 text-center align-top">
                        <button
                          type="button"
                          aria-pressed={checked}
                          aria-label={copy("skills.target.toggle_aria", { target: target.label })}
                          title={copy(
                            checked ? "skills.target.remove_title" : "skills.target.sync_title",
                            { target: target.label },
                          )}
                          disabled={isBusy}
                          onClick={() => onToggleTarget(skill, target.id, !checked)}
                          className={cn(
                            "inline-flex h-9 w-9 items-center justify-center rounded-md transition disabled:cursor-wait disabled:opacity-70",
                            checked
                              ? TARGET_ACTIVE_CLASSES[target.id] || "bg-oai-gray-100 dark:bg-oai-gray-800"
                              : "opacity-40 grayscale hover:bg-oai-gray-100 hover:opacity-100 hover:grayscale-0 dark:hover:bg-oai-gray-800",
                          )}
                        >
                          {isBusy ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          ) : (
                            <ProviderIcon provider={target.id} size={16} />
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
