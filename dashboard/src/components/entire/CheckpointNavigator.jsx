import React from "react";
import { Braces, File, FileJson, FolderGit2, Hash, ScrollText } from "lucide-react";
import { cn } from "../../lib/cn";
import { checkpointFileIconName, checkpointFileLabel, groupCheckpointFiles } from "./checkpoint-file-utils";

function IconForFile({ filePath }) {
  const name = checkpointFileIconName(filePath);
  const Icon = name === "json" ? FileJson : name === "jsonl" ? Braces : name === "hash" ? Hash : name === "text" ? ScrollText : File;
  return <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />;
}

function subPath(filePath) {
  return filePath.split("/").slice(2, -1).join("/");
}

export function CheckpointNavigator({ files = [], selectedPath = "", onSelect }) {
  const groups = groupCheckpointFiles(files);

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-sm">
      <div className="shrink-0 border-b border-oai-gray-200 px-3 py-3 dark:border-oai-gray-800">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-oai-black dark:text-white">Checkpoint files</h3>
          <span className="text-xs text-oai-gray-500 dark:text-oai-gray-400">{files.length} files</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {groups.map((group) => (
          <div key={group.id} className="border-b border-oai-gray-200 last:border-b-0 dark:border-oai-gray-800">
            <div className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-oai-gray-600 dark:text-oai-gray-300">
              <FolderGit2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{group.label}</span>
              <span className="ml-auto text-oai-gray-400 dark:text-oai-gray-500">{group.files.length}</span>
            </div>
            <div className="pb-1">
              {group.files.map((filePath) => {
                const label = checkpointFileLabel(filePath);
                return (
                  <button
                    key={filePath}
                    type="button"
                    aria-label={`Open checkpoint file ${label} ${filePath}`}
                    title={filePath}
                    onClick={() => onSelect?.(filePath)}
                    className={cn(
                      "flex w-full min-w-0 items-center gap-2 px-5 py-1.5 text-left text-xs transition-colors",
                      selectedPath === filePath
                        ? "bg-oai-black/[0.06] text-oai-black dark:bg-white/[0.12] dark:text-white"
                        : "text-oai-gray-600 hover:bg-oai-gray-50 dark:text-oai-gray-300 dark:hover:bg-oai-gray-900",
                    )}
                  >
                    <IconForFile filePath={filePath} />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    <span className="max-w-[120px] truncate text-oai-gray-400 dark:text-oai-gray-500">{subPath(filePath)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
