import React, { useEffect, useMemo, useState } from "react";
import { Braces, Clipboard, FileJson, Hash, ScrollText } from "lucide-react";
import { Button } from "../../ui/openai/components";
import { cn } from "../../lib/cn";

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

export function CheckpointFileInspector({ file = null, loading = false, error = "", selectedPath = "" }) {
  const [tab, setTab] = useState("preview");
  const fields = useMemo(() => primitiveEntries(file?.parsed), [file?.parsed]);
  const Icon = iconForKind(file?.kind);

  useEffect(() => {
    setTab("preview");
  }, [file?.path, selectedPath]);

  if (loading) {
    return <div className="p-5 text-sm text-oai-gray-500 dark:text-oai-gray-400">Loading checkpoint file...</div>;
  }
  if (error) {
    return <div className="p-5 text-sm text-red-700 dark:text-red-300">Unable to load checkpoint: {error}</div>;
  }
  if (!file) {
    return <div className="p-5 text-sm text-oai-gray-500 dark:text-oai-gray-400">Select a checkpoint file.</div>;
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-oai-gray-200 bg-white dark:border-oai-gray-800 dark:bg-oai-gray-900">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-oai-gray-200 px-4 py-3 dark:border-oai-gray-800">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <Icon className="h-4 w-4 shrink-0 text-oai-gray-500 dark:text-oai-gray-400" aria-hidden />
            <h3 className="truncate text-sm font-semibold text-oai-black dark:text-white">{file.file_name || selectedPath}</h3>
            <span className="rounded-md bg-oai-black/[0.05] px-1.5 py-0.5 text-[11px] uppercase text-oai-gray-600 dark:bg-white/[0.1] dark:text-oai-gray-300">
              {file.kind || "unknown"}
            </span>
          </div>
          <div className="mt-1 truncate text-xs text-oai-gray-500 dark:text-oai-gray-400" title={file.path || selectedPath}>
            {file.path || selectedPath}
          </div>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-x-3 gap-y-1 text-right text-[11px] text-oai-gray-500 dark:text-oai-gray-400">
          <span>size</span>
          <span>{Number(file.size_bytes || 0)}</span>
          <span>line_count</span>
          <span>{Number(file.line_count || 0)}</span>
        </div>
      </header>

      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-oai-gray-200 px-4 py-2 dark:border-oai-gray-800">
        <div className="inline-flex rounded-md bg-oai-black/[0.04] p-0.5 dark:bg-white/[0.08]">
          {[
            { id: "preview", label: "Preview" },
            { id: "raw", label: "Raw" },
            { id: "parsed", label: "Parsed" },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn(
                "rounded px-2.5 py-1 text-xs",
                tab === item.id
                  ? "bg-oai-black text-white dark:bg-white dark:text-oai-black"
                  : "text-oai-gray-600 dark:text-oai-gray-300",
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

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {tab === "raw" ? (
          <pre className="min-h-full whitespace-pre-wrap rounded-md bg-oai-black/[0.03] p-3 text-xs text-oai-gray-700 dark:bg-white/[0.08] dark:text-oai-gray-200">
            {file.raw || ""}
          </pre>
        ) : tab === "parsed" ? (
          <pre className="min-h-full overflow-auto rounded-md bg-oai-black/[0.03] p-3 text-xs text-oai-gray-700 dark:bg-white/[0.08] dark:text-oai-gray-200">
            {JSON.stringify(file.parsed, null, 2)}
          </pre>
        ) : file.kind === "json" ? (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {fields.map(([key, value]) => (
              <div key={key} className="rounded-md bg-oai-black/[0.035] px-3 py-2 text-xs dark:bg-white/[0.07]">
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
            <pre className="overflow-auto rounded-md bg-oai-black/[0.03] p-3 text-xs text-oai-gray-700 dark:bg-white/[0.08] dark:text-oai-gray-200">
              {JSON.stringify(file.parsed?.preview || [], null, 2)}
            </pre>
          </div>
        ) : file.kind === "hash" ? (
          <div className="rounded-lg border border-oai-gray-200 p-4 dark:border-oai-gray-800">
            <div className="text-xs uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">{file.parsed?.algorithm || "hash"}</div>
            <div className="mt-2 break-all font-mono text-sm text-oai-black dark:text-white">{file.parsed?.value || file.raw}</div>
          </div>
        ) : (
          <pre className="whitespace-pre-wrap rounded-md bg-oai-black/[0.03] p-3 text-sm leading-6 text-oai-gray-700 dark:bg-white/[0.08] dark:text-oai-gray-200">
            {file.raw || ""}
          </pre>
        )}
      </div>
    </section>
  );
}
