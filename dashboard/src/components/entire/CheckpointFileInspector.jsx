import React, { useEffect, useMemo, useState } from "react";
import { Braces, Clipboard, FileJson, Hash, ScrollText } from "lucide-react";
import { Button } from "../../ui/openai/components";
import { cn } from "../../lib/cn";
import { formatUsdCurrency, toDisplayNumber } from "../../lib/format";
import { copy } from "../../lib/copy";

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

function usageRows(value) {
  return Array.isArray(value) ? value : [];
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

function usageQualityLabel(usage) {
  const quality = String(usage?.cost_quality || "").trim().toLowerCase();
  if (quality === "stored") return copy("entire.checkpoints.usage.quality.stored");
  if (quality === "estimated") return copy("entire.checkpoints.usage.quality.estimated");
  if (quality === "token_buckets") return copy("entire.checkpoints.usage.quality.token_buckets");
  return "";
}

function isMetadataPath(filePath) {
  return String(filePath || "").trim().toLowerCase().endsWith("/metadata.json");
}

export function CheckpointFileInspector({ file = null, loading = false, error = "", selectedPath = "", className = "" }) {
  const [tab, setTab] = useState("preview");
  const fields = useMemo(() => primitiveEntries(file?.parsed), [file?.parsed]);
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
  const showUsagePreview = Boolean(usage) || isMetadataFile;
  const usageModels = usageRows(usage?.models);
  const usageProviders = usageRows(usage?.providers);
  const statusLabel = usageStatusLabel(usage) || (!usage && isMetadataFile ? copy("entire.checkpoints.usage.not_linked") : "");
  const costLabel = usageCostLabel(usage);
  const qualityLabel = usageQualityLabel(usage);

  useEffect(() => {
    setTab("preview");
  }, [file?.path, selectedPath]);

  useEffect(() => {
    if (!tabs.some((item) => item.id === tab)) setTab("preview");
  }, [tab, tabs]);

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
        <Button type="button" size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(file.raw || "")}>
          <Clipboard className="mr-1 h-3.5 w-3.5" aria-hidden />
          Copy
        </Button>
      </div>

      <div className="min-h-0 overflow-hidden p-3">
        <div className="h-full min-h-0 overflow-auto rounded-md bg-oai-brand-50/70 p-3 dark:bg-oai-brand-950/30">
          {showUsagePreview ? (
            <div className="mb-3 rounded-md border border-oai-gray-200 bg-white/80 p-3 dark:border-oai-gray-800 dark:bg-oai-black/20">
              <div className="text-xs font-semibold uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">Usage preview</div>
              {statusLabel ? (
                <div className="mt-2 rounded bg-oai-black/[0.04] px-2.5 py-2 text-xs font-semibold text-oai-black dark:bg-white/[0.06] dark:text-white">
                  {statusLabel}
                </div>
              ) : null}
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div className="rounded bg-oai-black/[0.04] px-2.5 py-2 text-xs dark:bg-white/[0.06]">
                  <div className="uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">Total tokens</div>
                  <div className="mt-1 font-semibold text-oai-black dark:text-white">
                    {usage?.total_tokens == null ? "—" : toDisplayNumber(usage.total_tokens)}
                  </div>
                </div>
                <div className="rounded bg-oai-black/[0.04] px-2.5 py-2 text-xs dark:bg-white/[0.06]">
                  <div className="uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">Total cost</div>
                  <div className="mt-1 font-semibold text-oai-black dark:text-white">
                    {costLabel || "—"}
                  </div>
                </div>
              </div>
              {qualityLabel ? (
                <div className="mt-2 text-xs font-medium text-oai-gray-700 dark:text-oai-gray-200">
                  {qualityLabel}
                </div>
              ) : null}
              {usageModels.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {usageModels.map((row, idx) => (
                    <span key={`${String(row?.model || "unknown")}-${idx}`} className="rounded-md bg-oai-brand-100 px-2 py-1 text-[11px] font-medium text-oai-brand-800 dark:bg-oai-brand-950/60 dark:text-oai-brand-300">
                      {String(row?.model || "unknown")}
                    </span>
                  ))}
                </div>
              ) : null}
              {usageProviders.length > 0 ? (
                <div className="mt-2 space-y-1">
                  {usageProviders.map((row, idx) => (
                    <div key={`${String(row?.provider || "unknown")}-${idx}`} className="flex items-center justify-between text-xs text-oai-gray-700 dark:text-oai-gray-200">
                      <span>{String(row?.provider || "unknown")}</span>
                      <span>{toDisplayNumber(row?.total_tokens ?? 0)}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {tab === "raw" ? (
            <pre className="whitespace-pre-wrap break-words text-xs text-oai-gray-700 dark:text-oai-gray-200">
              {file.raw || ""}
            </pre>
          ) : tab === "parsed" ? (
            <pre className="text-xs text-oai-gray-700 dark:text-oai-gray-200">
              {JSON.stringify(file.parsed, null, 2)}
            </pre>
          ) : file.kind === "json" ? (
            <div className="grid content-start gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {fields.map(([key, value]) => (
                <div key={key} className="vd-subcard rounded-md bg-oai-black/[0.035] px-3 py-2 text-xs dark:bg-white/[0.07]">
                  <div className="uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">{key}</div>
                  <div className="mt-1 break-all font-medium text-oai-black dark:text-white">{String(value)}</div>
                </div>
              ))}
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
