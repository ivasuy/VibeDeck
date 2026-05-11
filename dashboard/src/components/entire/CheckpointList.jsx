import React, { useEffect, useState } from "react";
import { Card } from "../../ui/openai/components";
import { copy } from "../../lib/copy";
import { getCheckpoint } from "../../lib/vibedeck-api";
import { CheckpointFileInspector } from "./CheckpointFileInspector";
import { CheckpointNavigator } from "./CheckpointNavigator";

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
  const [selectedPath, setSelectedPath] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  useEffect(() => {
    if (!files.length) {
      setSelectedPath("");
      return;
    }
    setSelectedPath((prev) => (prev && files.includes(prev) ? prev : files[0]));
  }, [files]);

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
    <Card className={`flex min-h-0 overflow-hidden ${className}`} bodyClassName="flex h-full min-h-0 flex-col !p-4">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-oai-black dark:text-white">{copy("entire.checkpoints.title")}</h2>
        {files.length > 0 ? (
          <span className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
            {copy("entire.checkpoints.count", { count: files.length })}
          </span>
        ) : null}
      </div>

      {loading ? (
        <p className="mt-2 text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("entire.checkpoints.loading")}</p>
      ) : error ? (
        <p className="mt-2 text-sm text-red-700 dark:text-red-300">{copy("entire.checkpoints.error", { error })}</p>
      ) : !repo ? (
        <p className="mt-2 text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("entire.checkpoints.empty")}</p>
      ) : !checkpoints?.available || files.length === 0 ? (
        <p className="mt-2 text-sm text-oai-gray-500 dark:text-oai-gray-400">
          {unavailableReasonText(checkpoints)}
        </p>
      ) : (
        <div className="mt-3 grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(260px,360px)_minmax(0,1fr)]">
          <CheckpointNavigator files={files} selectedPath={selectedPath} onSelect={setSelectedPath} />
          <CheckpointFileInspector file={detail} selectedPath={selectedPath} loading={detailLoading} error={detailError} />
        </div>
      )}
    </Card>
  );
}
