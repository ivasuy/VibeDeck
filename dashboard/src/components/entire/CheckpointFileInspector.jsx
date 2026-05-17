import React, { useEffect, useMemo, useState } from "react";
import { Braces, Clipboard, FileJson, Hash, ScrollText } from "lucide-react";
import { Button } from "../../ui/openai/components";
import { cn } from "../../lib/cn";
import { formatUsdCurrency } from "../../lib/format";
import { copy } from "../../lib/copy";
import { safeWriteClipboard } from "../../lib/safe-browser";

const PREVIEW_LIMIT = 12000;

function iconForKind(kind) {
  if (kind === "json") return FileJson;
  if (kind === "jsonl") return Braces;
  if (kind === "hash") return Hash;
  return ScrollText;
}

function primitiveEntries(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).filter(([, item]) => item == null || ["string", "number", "boolean"].includes(typeof item));
}

function usageStatusLabel(usage) {
  const status = String(usage?.status || "").trim().toLowerCase();
  if (status === "ambiguous") return copy("entire.checkpoints.usage.ambiguous");
  if (status === "unmatched") return copy("entire.checkpoints.usage.not_linked");
  return "";
}

function usageCostLabel(usage) {
  const totalCost = usage?.total_cost_usd;
  const unknownCount = Number(usage?.cost_unknown_count || 0);
  if (totalCost == null && unknownCount > 0) return copy("entire.checkpoints.usage.unknown_cost");
  if (totalCost == null) return "";
  return formatUsdCurrency(Number(totalCost).toFixed(2));
}

function isMetadataPath(filePath) {
  return String(filePath || "").trim().toLowerCase().endsWith("/metadata.json");
}

function boundedPreview(value, limit = PREVIEW_LIMIT) {
  const text = value == null ? "" : String(value);
  if (text.length <= limit) return { text, truncated: false };
  return { text: text.slice(0, limit), truncated: true };
}

function PreviewText({ preview, className = "" }) {
  return (
    <div className="space-y-2">
      {preview.truncated ? (
        <div className="text-xs font-medium text-oai-gray-500 dark:text-oai-gray-400">
          Preview truncated to 12,000 characters.
        </div>
      ) : null}
      <pre className={cn("whitespace-pre-wrap break-words text-xs text-oai-gray-700 dark:text-oai-gray-200", className)}>
        {preview.text}
      </pre>
    </div>
  );
}

export function CheckpointFileInspector({ file = null, loading = false, error = "", selectedPath = "", className = "" }) {
  const [tab, setTab] = useState("preview");
  const [copyStatus, setCopyStatus] = useState("");
  const primitiveFields = useMemo(() => primitiveEntries(file?.parsed), [file?.parsed]);
  const rawPreview = useMemo(() => boundedPreview(file?.raw), [file?.raw]);
  const parsedPreview = useMemo(() => boundedPreview(JSON.stringify(file?.parsed, null, 2) ?? ""), [file?.parsed]);
  const Icon = iconForKind(file?.kind);
  const tabs = useMemo(() => (
    file?.kind === "text"
      ? [
          { id: "preview", label: "Preview" },
          { id: "raw", label: "Raw" },
        ]
      : [
          { id: "preview", label: "Preview" },
          { id: "raw", label: "Raw" },
          { id: "parsed", label: "Parsed" },
        ]
  ), [file?.kind]);
  const usage = file?.usage && typeof file.usage === "object" ? file.usage : null;
  const metadataPath = file?.path || selectedPath;
  const isMetadataFile = isMetadataPath(metadataPath);
  const statusLabel = usageStatusLabel(usage) || (!usage && isMetadataFile ? copy("entire.checkpoints.usage.not_linked") : "");
  const costLabel = usageCostLabel(usage);
  const fields = useMemo(() => {
    const rows = [...primitiveFields];
    if (isMetadataFile) {
      const costValue = statusLabel || costLabel;
      if (costValue) rows.unshift(["COST", costValue]);
    }
    return rows;
  }, [costLabel, isMetadataFile, primitiveFields, statusLabel]);

  useEffect(() => {
    setTab("preview");
  }, [file?.path, selectedPath]);

  useEffect(() => {
    setCopyStatus("");
  }, [file?.path, selectedPath]);

  useEffect(() => {
    if (!tabs.some((item) => item.id === tab)) setTab("preview");
  }, [tab, tabs]);

  const onCopy = async () => {
    const copied = await safeWriteClipboard(file.raw || "");
    setCopyStatus(copied ? "copied" : "failed");
  };

  if (loading) {
    return (
      <div className={cn("vd-card flex h-full min-h-0 max-h-full items-center overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-[var(--glass-blur)] shadow-glass p-5 text-sm text-oai-gray-500 dark:text-oai-gray-400", className)}>
        Loading checkpoint file...
      </div>
    );
  }
  if (error) {
    return (
      <div className={cn("vd-card flex h-full min-h-0 max-h-full items-center overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-[var(--glass-blur)] shadow-glass p-5 text-sm text-red-700 dark:text-red-300", className)}>
        Unable to load checkpoint: {error}
      </div>
    );
  }
  if (!file) {
    return (
      <div className={cn("vd-card flex h-full min-h-0 max-h-full items-center overflow-hidden rounded-2xl border border-dashed border-oai-gray-300 bg-white/70 p-5 text-sm text-oai-gray-500 shadow-[0_20px_50px_rgba(15,23,42,0.04)] backdrop-blur dark:border-oai-gray-700 dark:bg-oai-gray-900/60 dark:text-oai-gray-400", className)}>
        Select a checkpoint file.
      </div>
    );
  }

  return (
    <section className={cn("vd-card grid h-full min-h-0 max-h-full grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-[var(--glass-bg)] backdrop-blur-[var(--glass-blur)] shadow-glass", className)}>
      <header className="flex min-h-0 items-start justify-between gap-3 border-b border-[var(--vd-border)] px-4 py-2.5">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <Icon className="h-4 w-4 shrink-0 text-oai-brand-500 dark:text-oai-brand-300" aria-hidden />
            <h3 className="truncate text-sm font-semibold text-oai-black dark:text-white">{file.file_name || selectedPath}</h3>
            <span className="vd-chip rounded-md bg-oai-black/[0.05] px-1.5 py-0.5 text-[11px] uppercase text-oai-gray-600 dark:bg-white/[0.1] dark:text-oai-gray-300">
              {file.kind || "unknown"}
            </span>
          </div>
        </div>
        <div className="min-w-0 max-w-[48%] truncate text-right text-[11px] text-oai-gray-500 dark:text-oai-gray-400" title={file.path || selectedPath}>
          {file.path || selectedPath}
        </div>
      </header>

      <div className="flex min-h-0 items-center justify-between gap-3 border-b border-[var(--vd-border)] px-4 py-2">
        <div className="inline-flex rounded-md border border-[var(--vd-border)] bg-[var(--vd-tint)] p-0.5">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn(
                "rounded px-2.5 py-1 text-xs",
                tab === item.id
                  ? "bg-oai-brand-600 text-white dark:bg-oai-brand-400 dark:text-oai-brand-950"
                  : "text-oai-gray-600 dark:text-oai-gray-300 hover:bg-oai-brand-50 dark:hover:bg-oai-brand-950/35",
              )}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={onCopy}>
            <Clipboard className="mr-1 h-3.5 w-3.5" aria-hidden />
            Copy
          </Button>
          {copyStatus === "copied" ? (
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Copied</span>
          ) : copyStatus === "failed" ? (
            <span className="text-xs font-medium text-red-600 dark:text-red-400">Copy failed</span>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 overflow-hidden p-3">
        <div className="h-full min-h-0 overflow-auto rounded-md bg-oai-brand-50/70 p-3 dark:bg-oai-brand-950/30">
          {tab === "raw" ? (
            <PreviewText preview={rawPreview} />
          ) : tab === "parsed" ? (
            <PreviewText preview={parsedPreview} />
          ) : file.kind === "json" ? (
            <div className="space-y-3">
              {file.parse_error ? (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 dark:border-red-900/60 dark:bg-red-950/20">
                  <div className="text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-300">Parse error</div>
                  <div className="mt-1 whitespace-pre-wrap break-words text-xs text-red-700 dark:text-red-200">
                    {String(file.parse_error)}
                  </div>
                </div>
              ) : null}
              <div className="grid content-start gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {fields.map(([key, value]) => (
                  <div key={key} className="vd-subcard rounded-md bg-oai-black/[0.035] px-3 py-2 text-xs dark:bg-white/[0.07]">
                    <div className="uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">{key}</div>
                    <div className="mt-1 break-all font-medium text-oai-black dark:text-white">{String(value)}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : file.kind === "jsonl" ? (
            <div className="space-y-3">
              <div className="text-sm font-medium text-oai-black dark:text-white">
                {file.parsed?.valid_lines || 0} valid lines
                {file.parsed?.invalid_lines ? ` · ${file.parsed.invalid_lines} invalid lines` : ""}
              </div>
              <pre className="overflow-auto text-xs text-oai-gray-700 dark:text-oai-gray-200">
                {JSON.stringify(file.parsed?.preview || [], null, 2)}
              </pre>
            </div>
          ) : file.kind === "hash" ? (
              <div className="rounded-lg border border-oai-gray-200 p-4 dark:border-oai-gray-800">
              <div className="text-xs uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">{file.parsed?.algorithm || "hash"}</div>
              <div className="mt-2 break-all font-mono text-sm text-oai-black dark:text-white">{file.parsed?.value || file.raw}</div>
            </div>
          ) : file.kind === "text" ? (
            <PreviewText preview={rawPreview} className="text-sm leading-6" />
          ) : (
            <pre className="whitespace-pre-wrap text-sm leading-6 text-oai-gray-700 dark:text-oai-gray-200">
              {file.raw || ""}
            </pre>
          )}
        </div>
      </div>
    </section>
  );
}
