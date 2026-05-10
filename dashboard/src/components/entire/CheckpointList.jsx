import React, { useEffect, useMemo, useState } from "react";
import { Card } from "../../ui/openai/components";
import { copy } from "../../lib/copy";
import { getCheckpoint } from "../../lib/vibedeck-api";
import { cn } from "../../lib/cn";

function detailType(value) {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function primitiveEntries(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value)
    .filter(([, item]) => ["string", "number", "boolean"].includes(typeof item) || item == null)
    .slice(0, 12);
}

function MetaItem({ label, value }) {
  return (
    <div className="rounded-md bg-oai-black/[0.03] px-2.5 py-2 text-xs text-oai-gray-600 dark:bg-white/[0.08] dark:text-oai-gray-300">
      <div className="text-[11px] uppercase tracking-wide text-oai-gray-400 dark:text-oai-gray-500">{label}</div>
      <div className="mt-1 break-all text-oai-black dark:text-white">{value}</div>
    </div>
  );
}

export function CheckpointList({ repo = "", checkpoints = null, loading = false, error = "" }) {
  const files = Array.isArray(checkpoints?.files) ? checkpoints.files : [];
  const [selectedPath, setSelectedPath] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [viewMode, setViewMode] = useState("metadata");

  useEffect(() => {
    if (!files.length) {
      setSelectedPath("");
      return;
    }
    setSelectedPath((prev) => (prev && files.includes(prev) ? prev : files[0]));
    setViewMode("metadata");
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

  const detailMeta = useMemo(() => {
    const type = detailType(detail);
    const keys =
      detail && typeof detail === "object" && !Array.isArray(detail)
        ? Object.keys(detail).length
        : Array.isArray(detail)
          ? detail.length
          : 0;
    return {
      type,
      keys,
      entries: primitiveEntries(detail),
    };
  }, [detail]);

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
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
        <p className="mt-2 text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("entire.checkpoints.none")}</p>
      ) : (
        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
          <div className="max-h-72 overflow-auto rounded-md border border-oai-gray-200 dark:border-oai-gray-800">
            {files.map((filePath) => (
              <button
                key={filePath}
                type="button"
                onClick={() => {
                  setSelectedPath(filePath);
                  setViewMode("metadata");
                }}
                className={cn(
                  "block w-full truncate border-b border-oai-gray-200 px-3 py-2 text-left text-xs last:border-b-0 dark:border-oai-gray-800",
                  selectedPath === filePath
                    ? "bg-oai-black/[0.05] text-oai-black dark:bg-white/[0.12] dark:text-white"
                    : "text-oai-gray-600 hover:bg-oai-gray-50 dark:text-oai-gray-300 dark:hover:bg-oai-gray-900",
                )}
                title={filePath}
              >
                {filePath}
              </button>
            ))}
          </div>

          <div className="min-h-[220px] rounded-md border border-oai-gray-200 p-3 dark:border-oai-gray-800">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
                {copy("entire.checkpoints.detail.title")}
              </h3>
              <div className="inline-flex rounded-md bg-oai-black/[0.04] p-0.5 dark:bg-white/[0.08]">
                <button
                  type="button"
                  className={cn(
                    "rounded px-2 py-1 text-xs",
                    viewMode === "metadata"
                      ? "bg-oai-black text-white dark:bg-white dark:text-oai-black"
                      : "text-oai-gray-600 dark:text-oai-gray-300",
                  )}
                  onClick={() => setViewMode("metadata")}
                >
                  {copy("entire.checkpoints.detail.mode.metadata")}
                </button>
                <button
                  type="button"
                  className={cn(
                    "rounded px-2 py-1 text-xs",
                    viewMode === "raw"
                      ? "bg-oai-black text-white dark:bg-white dark:text-oai-black"
                      : "text-oai-gray-600 dark:text-oai-gray-300",
                  )}
                  onClick={() => setViewMode("raw")}
                >
                  {copy("entire.checkpoints.detail.mode.raw")}
                </button>
              </div>
            </div>

            {detailLoading ? (
              <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">
                {copy("entire.checkpoints.detail.loading")}
              </p>
            ) : detailError ? (
              <p className="text-sm text-red-700 dark:text-red-300">
                {copy("entire.checkpoints.detail.error", { error: detailError })}
              </p>
            ) : !selectedPath ? (
              <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">
                {copy("entire.checkpoints.detail.empty")}
              </p>
            ) : viewMode === "raw" ? (
              <pre className="max-h-64 overflow-auto rounded-md bg-oai-black/[0.03] p-2 text-xs text-oai-gray-700 dark:bg-white/[0.08] dark:text-oai-gray-200">
                {JSON.stringify(detail, null, 2)}
              </pre>
            ) : (
              <div className="space-y-2">
                <MetaItem label={copy("entire.checkpoints.detail.meta.path")} value={selectedPath} />
                <MetaItem label={copy("entire.checkpoints.detail.meta.type")} value={detailMeta.type} />
                <MetaItem label={copy("entire.checkpoints.detail.meta.keys")} value={String(detailMeta.keys)} />
                <div className="rounded-md bg-oai-black/[0.03] px-2.5 py-2 text-xs text-oai-gray-600 dark:bg-white/[0.08] dark:text-oai-gray-300">
                  <div className="text-[11px] uppercase tracking-wide text-oai-gray-400 dark:text-oai-gray-500">
                    {copy("entire.checkpoints.detail.meta.fields")}
                  </div>
                  {detailMeta.entries.length === 0 ? (
                    <p className="mt-1 text-oai-gray-500 dark:text-oai-gray-400">{copy("entire.checkpoints.detail.meta.none")}</p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {detailMeta.entries.map(([key, value]) => (
                        <li key={key} className="break-all">
                          <span className="text-oai-gray-500 dark:text-oai-gray-400">{key}: </span>
                          <span className="text-oai-black dark:text-white">{String(value)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
