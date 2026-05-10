import React from "react";
import { FolderTree, Trash2 } from "lucide-react";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";
import { Card, Button } from "../../ui/openai/components";
import { IconBadge } from "../../ui/ops";

function sourceLabel(skill) {
  return skill?.repoOwner && skill?.repoName
    ? `${skill.repoOwner}/${skill.repoName}`
    : copy("skills.inventory.source_local");
}

function directoryLabel(skill) {
  const sourceDirectory = skill?.sourceDirectory || skill?.directory || "";
  return sourceDirectory || copy("skills.target.none");
}

function targetSummary(skill, targets) {
  const activeTargets = Array.isArray(skill?.targets) ? skill.targets : [];
  if (!activeTargets.length) return copy("skills.inventory.targets_none");
  return activeTargets
    .map((id) => targets.find((target) => target.id === id)?.label || id)
    .join(", ");
}

function statusLabel(skill) {
  return skill?.managed ? copy("skills.inventory.managed") : copy("skills.inventory.local");
}

export function InstalledSkillList({ items = [], targets = [], busyKey = "", onRemove }) {
  return (
    <Card bodyClassName="p-0">
      <div className="border-b border-oai-gray-200 px-4 py-3 dark:border-oai-gray-800">
        <div className="flex items-center gap-2">
          <IconBadge accent="skills" label={copy("skills.inventory.title")} />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-oai-black dark:text-white">
              {copy("skills.inventory.title")}
            </h2>
            <p className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
              {copy("skills.inventory.subtitle")}
            </p>
          </div>
        </div>
      </div>

      <div className="divide-y divide-oai-gray-200/80 dark:divide-oai-gray-800/80">
        {items.map((skill) => {
          const removing = busyKey === `remove:${skill.id || skill.directory}`;
          const repoText = sourceLabel(skill);
          const directoryText = directoryLabel(skill);

          return (
            <div
              key={skill.id || skill.key}
              className="grid gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)_auto]"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-oai-black dark:text-white">
                    {skill.name || skill.directory}
                  </h3>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium ring-1",
                      skill.managed
                        ? "bg-emerald-500/8 text-emerald-700 ring-emerald-500/15 dark:text-emerald-300"
                        : "bg-oai-gray-100 text-oai-gray-700 ring-oai-gray-200 dark:bg-oai-gray-800 dark:text-oai-gray-200 dark:ring-oai-gray-700",
                    )}
                  >
                    {statusLabel(skill)}
                  </span>
                </div>
                {skill.description ? (
                  <p className="mt-1 text-sm leading-6 text-oai-gray-600 dark:text-oai-gray-300">
                    {skill.description}
                  </p>
                ) : null}
              </div>

              <div className="grid gap-2 text-xs">
                <div>
                  <div className="font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
                    {copy("skills.source.label")}
                  </div>
                  <div className="truncate text-sm text-oai-black dark:text-white" title={repoText}>
                    {repoText}
                  </div>
                </div>
                <div>
                  <div className="font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
                    {copy("skills.inventory.directory")}
                  </div>
                  <div
                    className="inline-flex max-w-full items-center gap-1.5 truncate text-sm text-oai-gray-600 dark:text-oai-gray-300"
                    title={directoryText}
                  >
                    <FolderTree className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{directoryText}</span>
                  </div>
                </div>
                <div>
                  <div className="font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
                    {copy("skills.matrix.title")}
                  </div>
                  <div className="text-sm text-oai-black dark:text-white">
                    {targetSummary(skill, targets)}
                  </div>
                </div>
              </div>

              <div className="flex items-start lg:justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={removing}
                  onClick={() => onRemove(skill)}
                  aria-label={copy("skills.action.remove")}
                  className="!text-red-700 hover:!bg-red-50 hover:!text-red-800 dark:!text-red-300 dark:hover:!bg-red-950/30 dark:hover:!text-red-200"
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                  {copy("skills.action.remove")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
