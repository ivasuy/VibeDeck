import React, { useEffect, useState } from "react";
import { Braces, ChevronRight, FileCode2, FileJson, FolderTree, Hash, ScrollText } from "lucide-react";
import { copy } from "../../lib/copy";
import { getCheckpoint } from "../../lib/vibedeck-api";
import { CheckpointFileInspector } from "./CheckpointFileInspector";
import { cn } from "../../lib/cn";
import { checkpointFileIconName, checkpointFileLabel, groupCheckpointFiles } from "./checkpoint-file-utils";

function unavailableReasonText(checkpoints) {
  const reason = String(checkpoints?.reason || "").trim();
  if (reason === "branch_not_fetched") return copy("entire.checkpoints.reason.branch_not_fetched");
  if (reason === "git_error") {
    const detail = String(checkpoints?.detail || "").trim();
    return detail
      ? copy("entire.checkpoints.reason.git_error_detail", { detail })
      : copy("entire.checkpoints.reason.git_error");
  }
  return copy("entire.checkpoints.none");
}

export function CheckpointList({ repo = "", checkpoints = null, loading = false, error = "", className = "" }) {
  const files = Array.isArray(checkpoints?.files) ? checkpoints.files : [];
  const groups = groupCheckpointFiles(files);
  const [selectedPath, setSelectedPath] = useState("");
  const [openGroupId, setOpenGroupId] = useState();
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const iconForFile = (filePath) => {
    const iconName = checkpointFileIconName(filePath);
    if (iconName === "json") return FileJson;
    if (iconName === "jsonl") return Braces;
    if (iconName === "hash") return Hash;
    if (iconName === "text") return ScrollText;
    return FileCode2;
  };

  useEffect(() => {
    if (!groups.length) {
      setOpenGroupId("");
      setSelectedPath("");
      return;
    }
    setOpenGroupId((prev) => {
      if (prev === undefined) return groups[0].id;
      if (prev === "") return "";
      return groups.some((group) => group.id === prev) ? prev : groups[0].id;
    });
    setSelectedPath((prev) => (prev && files.includes(prev) ? prev : groups[0].files[0] || ""));
  }, [files, groups]);

  useEffect(() => {
    if (!repo || !selectedPath) {
      setDetail(null);
      setDetailError("");
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError("");
    getCheckpoint(repo, selectedPath)
      .then((payload) => {
        if (cancelled) return;
        setDetail(payload ?? null);
      })
      .catch((cause) => {
        if (cancelled) return;
        const message = cause instanceof Error ? cause.message : copy("entire.checkpoints.detail.error_fallback");
        setDetailError(message);
        setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [repo, selectedPath]);

  return (
    <section className={cn("grid h-full min-h-0 max-h-full grid-rows-[minmax(0,1fr)] gap-1 overflow-hidden xl:grid-cols-[300px_minmax(0,1fr)]", className)}>
      <div className="grid h-full min-h-0 max-h-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-[var(--glass-blur)] shadow-glass">
        <div className="flex min-h-0 items-center justify-between gap-2 border-b border-oai-gray-200 px-4 py-2.5 dark:border-oai-gray-800">
          <h2 className="text-sm font-semibold text-oai-black dark:text-white">Checkpoint files</h2>
          {files.length > 0 ? (
            <span className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
              {copy("entire.checkpoints.count", { count: files.length })}
            </span>
          ) : null}
        </div>

        {loading ? (
          <p className="min-h-0 overflow-auto px-4 py-3 text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("entire.checkpoints.loading")}</p>
        ) : error ? (
          <p className="min-h-0 overflow-auto px-4 py-3 text-sm text-red-700 dark:text-red-300">{copy("entire.checkpoints.error", { error })}</p>
        ) : !repo ? (
          <p className="min-h-0 overflow-auto px-4 py-3 text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("entire.checkpoints.empty")}</p>
        ) : !checkpoints?.available || files.length === 0 ? (
          <p className="min-h-0 overflow-auto px-4 py-3 text-sm text-oai-gray-500 dark:text-oai-gray-400">
            {unavailableReasonText(checkpoints)}
          </p>
        ) : (
          <div className="min-h-0 overflow-auto p-1.5">
            <div className="space-y-1">
              {groups.map((group) => {
                const isOpen = openGroupId === group.id;
                return (
                  <section
                    key={group.id}
                    className={cn(
                      "overflow-hidden rounded-2xl border transition-colors",
                      isOpen
                        ? "border-oai-brand-500/40 bg-oai-brand-50/70"
                        : "border-oai-gray-200 bg-oai-black/[0.025] dark:border-oai-gray-800 dark:bg-white/[0.04]",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setOpenGroupId((prev) => (prev === group.id ? "" : group.id));
                        if (!isOpen && group.files.length > 0) setSelectedPath(group.files[0]);
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                      aria-expanded={isOpen}
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-oai-black/[0.06] text-oai-gray-600 dark:bg-white/[0.08] dark:text-oai-gray-300">
                        <FolderTree className="h-5 w-5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-oai-black dark:text-white">{group.label}</span>
                        <span className="mt-1 block text-xs text-oai-gray-500 dark:text-oai-gray-400">
                          {group.files.length} files
                        </span>
                      </span>
                      <ChevronRight className={cn("h-4 w-4 shrink-0 text-oai-gray-500 transition-transform dark:text-oai-gray-400", isOpen && "rotate-90")} aria-hidden />
                    </button>

                    {isOpen ? (
                      <div className="space-y-1 border-t border-oai-gray-200/80 px-2 py-1.5 dark:border-oai-gray-800/80">
                        {group.files.map((filePath) => {
                          const Icon = iconForFile(filePath);
                          const active = selectedPath === filePath;
                          return (
                            <button
                              key={filePath}
                              type="button"
                              onClick={() => setSelectedPath(filePath)}
                              className={cn(
                                "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                                active
                                  ? "bg-oai-black text-white dark:bg-white dark:text-oai-black"
                                  : "hover:bg-oai-black/[0.05] dark:hover:bg-white/[0.08]",
                              )}
                              aria-pressed={active}
                            >
                              <span className={cn(
                                "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                                active
                                  ? "bg-white/15 text-white dark:bg-oai-black/10 dark:text-oai-black"
                                  : "bg-oai-black/[0.06] text-oai-gray-600 dark:bg-white/[0.08] dark:text-oai-gray-300",
                              )}
                              >
                                <Icon className="h-4 w-4" aria-hidden />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-medium">{checkpointFileLabel(filePath)}</span>
                                <span className={cn(
                                  "mt-0.5 block truncate text-xs",
                                  active ? "text-white/75 dark:text-oai-black/70" : "text-oai-gray-500 dark:text-oai-gray-400",
                                )}
                                >
                                  {filePath.split("/").at(-1) || filePath}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="h-full min-h-0 max-h-full overflow-hidden">
        <CheckpointFileInspector
          className="h-full min-h-0"
          file={detail}
          selectedPath={selectedPath}
          loading={detailLoading}
          error={detailError}
        />
      </div>
    </section>
  );
}
