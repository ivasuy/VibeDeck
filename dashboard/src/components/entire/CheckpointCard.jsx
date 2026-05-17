import React, { useEffect, useRef, useState } from "react";
import { ChevronDown, FileJson2, FileText, Loader2 } from "lucide-react";
import { getCheckpoint } from "../../lib/vibedeck-api";
import { summarizeJsonlPayload } from "./checkpoint-card-utils";
import { formatUsdCurrency } from "../../lib/format";
import { cn } from "../../lib/cn";

function cleanText(value) {
  return String(value || "").trim();
}

function formatTokens(value) {
  if (value == null || value === "") return "";
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toLocaleString()} tokens` : "";
}

function formatRowCost(value) {
  if (value == null || value === "") return "No cost";
  return formatUsdCurrency(Number(value).toFixed(2));
}

function formatSessionCount(value) {
  if (value == null || value === "") return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return `${number.toLocaleString()} ${number === 1 ? "session" : "sessions"}`;
}

function checkpointReadout(checkpoint) {
  if (!checkpoint?.usage) {
    return {
      tone: "Needs review",
      title: "Usage is not linked yet",
      body: "Entire found checkpoint artifacts, but VibeDeck could not map usage back to this checkpoint. Inspect metadata first, then confirm the checkpoint id in the branch.",
    };
  }

  if (checkpoint.statusLabel) {
    return {
      tone: checkpoint.statusLabel,
      title: checkpoint.statusLabel,
      body: checkpoint.reason || "Usage exists, but this checkpoint needs review before it can be treated as a clean cost record.",
    };
  }

  const model = checkpoint.topModel ? ` using ${checkpoint.topModel}` : "";
  const sessions = checkpoint.sessionCount ? ` across ${formatSessionCount(checkpoint.sessionCount)}` : "";
  const cost = checkpoint.costLabel ? ` Cost is ${checkpoint.costLabel}.` : "";
  return {
    tone: "Ready",
    title: `Linked checkpoint${model}${sessions}`,
    body: `This checkpoint has enough metadata to review cost, tokens, prompt context, and captured activity together.${cost}`,
  };
}

function ArtifactBadge({ available, label }) {
  return (
    <span
      className={[
        "rounded-md border px-2 py-1 text-[11px] font-medium",
        available
          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "border-[var(--vd-border)] bg-white/60 text-oai-gray-500 dark:bg-oai-gray-950/30 dark:text-oai-gray-400",
      ].join(" ")}
    >
      {label}
    </span>
  );
}

function summarizePathList(paths) {
  const entries = Array.isArray(paths) ? paths.map(cleanText).filter(Boolean) : [];
  return entries;
}

function rawText(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

function MetricBlock({ label, value }) {
  return (
    <div className="min-w-0 rounded-2xl border border-[var(--vd-border)] bg-white/70 px-3 py-2.5 shadow-[0_16px_40px_rgba(15,23,42,0.04)] dark:bg-oai-gray-900/55">
      <div className="text-[11px] font-medium uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">{label}</div>
      <div className="mt-1 break-words text-sm font-semibold leading-5 text-oai-black dark:text-white">{value}</div>
    </div>
  );
}

function BreakdownRegion({ label, rows, kind }) {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  return (
    <section role="region" aria-label={label} className="rounded-2xl border border-[var(--vd-border)] bg-[var(--vd-tint)] p-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
        {kind === "provider" ? <FileJson2 className="h-3.5 w-3.5" aria-hidden /> : <FileText className="h-3.5 w-3.5" aria-hidden />}
        <span>{kind === "provider" ? "Providers" : "Models"}</span>
      </div>
      <div className="mt-3 space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="grid gap-2 rounded-xl bg-white/70 px-3 py-2.5 dark:bg-oai-gray-900/55 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
            <div className="min-w-0">
              <div className="break-words text-sm font-medium leading-5 text-oai-black dark:text-white">{row.label}</div>
              {row.tokens != null ? (
                <div className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">{Number(row.tokens).toLocaleString()} tokens</div>
              ) : null}
            </div>
            <div className="text-sm font-semibold text-oai-black dark:text-white sm:text-right">
              {formatRowCost(row.costUsd)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function MetadataUsageGrid({ rows }) {
  if (!Array.isArray(rows) || rows.length === 0) return null;

  return (
    <section className="mt-4 rounded-2xl border border-[var(--vd-border)] bg-white/70 p-3 dark:bg-oai-gray-900/55">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">Metadata calls</div>
          <p className="mt-1 text-xs leading-5 text-oai-gray-500 dark:text-oai-gray-400">
            Parsed from checkpoint metadata files so reviewers can inspect usage without opening raw JSON.
          </p>
        </div>
        <span className="rounded-md bg-oai-black/[0.04] px-2 py-1 text-[11px] font-medium text-oai-gray-600 dark:bg-white/[0.08] dark:text-oai-gray-300">
          {rows.length} call{rows.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
        {rows.map((row) => (
          <article key={row.path} className="min-w-0 rounded-xl border border-[var(--vd-border)] bg-[var(--vd-tint)] p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {row.status ? (
                <span className="rounded-md bg-oai-brand-500/10 px-2 py-0.5 text-[11px] font-semibold text-oai-brand-700 dark:text-oai-brand-300">
                  {row.status}
                </span>
              ) : null}
              {row.provider ? (
                <span className="rounded-md bg-oai-black/[0.04] px-2 py-0.5 text-[11px] font-medium text-oai-gray-600 dark:bg-white/[0.08] dark:text-oai-gray-300">
                  {row.provider}
                </span>
              ) : null}
            </div>
            <div className="mt-2 break-words text-sm font-semibold leading-5 text-oai-black dark:text-white">
              {row.model || row.label || "Metadata file"}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-lg bg-white/70 px-2.5 py-2 dark:bg-oai-gray-950/40">
                <div className="text-oai-gray-500 dark:text-oai-gray-400">Tokens</div>
                <div className="mt-0.5 font-semibold text-oai-black dark:text-white">
                  {row.tokens != null ? Number(row.tokens).toLocaleString() : "None"}
                </div>
              </div>
              <div className="rounded-lg bg-white/70 px-2.5 py-2 dark:bg-oai-gray-950/40">
                <div className="text-oai-gray-500 dark:text-oai-gray-400">Cost</div>
                <div className="mt-0.5 font-semibold text-oai-black dark:text-white">
                  {formatRowCost(row.costUsd)}
                </div>
              </div>
            </div>
            <div className="mt-2 break-all font-mono text-[10px] leading-4 text-oai-gray-500 dark:text-oai-gray-400">
              {row.label || row.path}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function CheckpointCard({ repo = "", card, getCheckpointImpl = getCheckpoint }) {
  const checkpoint = card && typeof card === "object" ? card : {};
  const checkpointId = cleanText(checkpoint.id || checkpoint.label);
  const label = cleanText(checkpoint.label || checkpoint.id);
  const promptPath = cleanText(checkpoint.promptPath);
  const jsonlPath = cleanText(checkpoint.jsonlPath);
  const metadataPath = cleanText(checkpoint.metadataPath);
  const fileList = summarizePathList(checkpoint.files);
  const modelRows = Array.isArray(checkpoint.modelRows) ? checkpoint.modelRows : [];
  const providerRows = Array.isArray(checkpoint.providerRows) ? checkpoint.providerRows : [];
  const metadataRows = Array.isArray(checkpoint.metadataRows) ? checkpoint.metadataRows : [];

  const [promptState, setPromptState] = useState({ open: false, loading: false, error: "", payload: null, loadedPath: "" });
  const [activityState, setActivityState] = useState({ open: false, loading: false, error: "", payload: null, loadedPath: "" });
  const [advancedState, setAdvancedState] = useState({ open: false, loading: false, error: "", payload: null, loadedPath: "" });

  const promptSeq = useRef(0);
  const activitySeq = useRef(0);
  const advancedSeq = useRef(0);

  useEffect(() => {
    promptSeq.current += 1;
    activitySeq.current += 1;
    advancedSeq.current += 1;
    setPromptState({ open: false, loading: false, error: "", payload: null, loadedPath: "" });
    setActivityState({ open: false, loading: false, error: "", payload: null, loadedPath: "" });
    setAdvancedState({ open: false, loading: false, error: "", payload: null, loadedPath: "" });
  }, [repo, checkpointId]);

  const openSection = async (kind, path, stateSetter, seqRef) => {
    if (!path) {
      stateSetter((prev) => ({ ...prev, open: true, error: "No checkpoint path available" }));
      return;
    }

    const currentToken = seqRef.current + 1;
    seqRef.current = currentToken;
    stateSetter((prev) => ({
      ...prev,
      open: true,
      loading: true,
      error: "",
    }));

    try {
      const payload = await getCheckpointImpl(repo, path);
      if (seqRef.current !== currentToken) return;
      stateSetter({
        open: true,
        loading: false,
        error: "",
        payload: payload ?? null,
        loadedPath: path,
      });
    } catch (cause) {
      if (seqRef.current !== currentToken) return;
      const message = cause instanceof Error ? cause.message : `Unable to load ${kind}`;
      stateSetter({
        open: true,
        loading: false,
        error: message,
        payload: null,
        loadedPath: path,
      });
    }
  };

  const toggleSection = (state, stateSetter, kind, path, seqRef) => {
    if (state.open) {
      stateSetter((prev) => ({ ...prev, open: false, loading: false, error: "" }));
      return;
    }
    if (state.payload && state.loadedPath === path) {
      stateSetter((prev) => ({ ...prev, open: true, error: "" }));
      return;
    }
    void openSection(kind, path, stateSetter, seqRef);
  };

  const promptSummary = rawText(promptState.payload?.raw);
  const activitySummary = activityState.payload ? summarizeJsonlPayload(activityState.payload) : null;
  const advancedSummary = rawText(advancedState.payload?.raw);

  const summaryChips = [
    checkpoint.branch ? cleanText(checkpoint.branch) : "",
    checkpoint.provider ? cleanText(checkpoint.provider) : "",
    checkpoint.topModel ? cleanText(checkpoint.topModel) : "",
    checkpoint.costQuality ? cleanText(checkpoint.costQuality) : "",
    checkpoint.sessionCount != null && checkpoint.sessionCount !== "" ? formatSessionCount(checkpoint.sessionCount) : "",
  ].filter(Boolean);

  const providerRegionNeeded = providerRows.length > 1 || modelRows.length === 0;
  const modelRegionLabel = `Model breakdown for ${checkpointId || label}`;
  const providerRegionLabel = `Provider breakdown for ${checkpointId || label}`;
  const readout = checkpointReadout(checkpoint);

  return (
    <section aria-label={`Checkpoint ${label || checkpointId}`} className="vd-card rounded-3xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-4 shadow-glass backdrop-blur-[var(--glass-blur)]">
      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(360px,480px)] 2xl:items-start">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="break-words text-base font-semibold leading-6 text-oai-black dark:text-white">{label || checkpointId || "Checkpoint"}</h3>
          </div>
          {summaryChips.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {summaryChips.map((chip) => (
                <span
                  key={chip}
                  className="inline-flex items-center rounded-full border border-[var(--vd-border)] bg-white/75 px-2.5 py-1 text-[11px] font-medium text-oai-gray-700 dark:bg-oai-gray-900/60 dark:text-oai-gray-200"
                >
                  {chip}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="grid min-w-0 gap-2 sm:grid-cols-3">
          <MetricBlock label="Cost" value={checkpoint.costLabel || "No cost"} />
          <MetricBlock label="Tokens" value={checkpoint.totalTokens != null ? formatTokens(checkpoint.totalTokens) : "No tokens"} />
          <MetricBlock label="Status" value={checkpoint.statusLabel || "Usage linked"} />
        </div>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(260px,340px)]">
        <div className="rounded-2xl border border-[var(--vd-border)] bg-white/75 p-4 dark:bg-oai-gray-900/55">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-oai-brand-500/10 px-2 py-1 text-[11px] font-semibold text-oai-brand-700 dark:text-oai-brand-300">
              {readout.tone}
            </span>
            {checkpoint.confidence ? (
              <span className="rounded-md bg-oai-black/[0.04] px-2 py-1 text-[11px] font-medium text-oai-gray-600 dark:bg-white/[0.08] dark:text-oai-gray-300">
                {checkpoint.confidence}
              </span>
            ) : null}
          </div>
          <div className="mt-3 text-sm font-semibold leading-5 text-oai-black dark:text-white">{readout.title}</div>
          <p className="mt-1 text-sm leading-6 text-oai-gray-600 dark:text-oai-gray-300">{readout.body}</p>
        </div>

        <div className="rounded-2xl border border-[var(--vd-border)] bg-[var(--vd-tint)] p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">Inspection coverage</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <ArtifactBadge available={Boolean(promptPath)} label="Prompt" />
            <ArtifactBadge available={Boolean(jsonlPath)} label="Activity" />
            <ArtifactBadge available={Boolean(metadataPath)} label="Metadata" />
            <ArtifactBadge available={fileList.length > 0} label={`${fileList.length} file${fileList.length === 1 ? "" : "s"}`} />
          </div>
          <p className="mt-3 text-xs leading-5 text-oai-gray-500 dark:text-oai-gray-400">
            Start with the prompt for intent, then captured activity for event shape, then metadata when you need raw fields.
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <BreakdownRegion label={modelRegionLabel} rows={modelRows} kind="model" />
        {providerRegionNeeded ? (
          <BreakdownRegion label={providerRegionLabel} rows={providerRows} kind="provider" />
        ) : null}
      </div>

      <MetadataUsageGrid rows={metadataRows} />

      <div className="mt-4 space-y-3">
        <section className="rounded-2xl border border-[var(--vd-border)] bg-white/65 p-3 dark:bg-oai-gray-900/50">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 text-left"
            aria-expanded={promptState.open}
            onClick={() => toggleSection(promptState, setPromptState, "prompt", promptPath, promptSeq)}
          >
            <span className="text-sm font-semibold text-oai-black dark:text-white">Show prompt for {checkpointId || label}</span>
            <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", promptState.open && "rotate-180")} aria-hidden />
          </button>

          {promptState.open ? (
            <div role="region" aria-label={`Prompt for ${checkpointId || label}`} className="mt-3 rounded-xl border border-[var(--vd-border)] bg-[var(--vd-tint)] p-3">
              {promptState.loading ? (
                <div className="flex items-center gap-2 text-sm text-oai-gray-500 dark:text-oai-gray-400">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Loading prompt...
                </div>
              ) : promptState.error ? (
                <div className="text-sm text-red-700 dark:text-red-300">{promptState.error}</div>
              ) : (
                <pre className="whitespace-pre-wrap break-words text-sm leading-6 text-oai-black dark:text-white">{promptSummary}</pre>
              )}
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-[var(--vd-border)] bg-white/65 p-3 dark:bg-oai-gray-900/50">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 text-left"
            aria-expanded={activityState.open}
            onClick={() => toggleSection(activityState, setActivityState, "captured activity", jsonlPath, activitySeq)}
          >
            <span className="text-sm font-semibold text-oai-black dark:text-white">Show captured activity for {checkpointId || label}</span>
            <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", activityState.open && "rotate-180")} aria-hidden />
          </button>

          {activityState.open ? (
            <div role="region" aria-label={`Captured activity for ${checkpointId || label}`} className="mt-3 rounded-xl border border-[var(--vd-border)] bg-[var(--vd-tint)] p-3">
              {activityState.loading ? (
                <div className="flex items-center gap-2 text-sm text-oai-gray-500 dark:text-oai-gray-400">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Loading captured activity...
                </div>
              ) : activityState.error ? (
                <div className="text-sm text-red-700 dark:text-red-300">{activityState.error}</div>
              ) : activitySummary ? (
                <div className="space-y-3">
                  <div className="text-sm font-semibold text-oai-black dark:text-white">
                    {activitySummary.validLines} valid line{activitySummary.validLines === 1 ? "" : "s"}
                    {activitySummary.invalidLines ? ` · ${activitySummary.invalidLines} invalid line${activitySummary.invalidLines === 1 ? "" : "s"}` : ""}
                  </div>
                  {activitySummary.eventRows.length > 0 ? (
                    <ul className="space-y-2">
                      {activitySummary.eventRows.map((row) => (
                        <li key={row.label} className="flex items-center justify-between gap-3 rounded-xl bg-white/70 px-3 py-2 dark:bg-oai-gray-900/55">
                          <span className="text-sm font-medium text-oai-black dark:text-white">{row.label}</span>
                          <span className="text-sm text-oai-gray-600 dark:text-oai-gray-300">
                            {row.count} event{row.count === 1 ? "" : "s"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-sm text-oai-gray-500 dark:text-oai-gray-400">No captured activity events found.</div>
                  )}
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-[var(--vd-border)] bg-white/65 p-3 dark:bg-oai-gray-900/50">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 text-left"
            aria-expanded={advancedState.open}
            onClick={() => toggleSection(advancedState, setAdvancedState, "advanced details", metadataPath, advancedSeq)}
          >
            <span className="text-sm font-semibold text-oai-black dark:text-white">Show advanced details for {checkpointId || label}</span>
            <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", advancedState.open && "rotate-180")} aria-hidden />
          </button>

          {advancedState.open ? (
            <div role="region" aria-label={`Advanced details for ${checkpointId || label}`} className="mt-3 space-y-3 rounded-xl border border-[var(--vd-border)] bg-[var(--vd-tint)] p-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">Files</div>
                {fileList.length > 0 ? (
                  <ul className="mt-2 space-y-1.5">
                    {fileList.map((filePath) => (
                      <li key={filePath} className="break-all rounded-lg bg-white/70 px-3 py-2 text-sm leading-5 text-oai-black dark:bg-oai-gray-900/55 dark:text-white">
                        {filePath}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-2 text-sm text-oai-gray-500 dark:text-oai-gray-400">No files recorded.</div>
                )}
              </div>

              {advancedState.loading ? (
                <div className="flex items-center gap-2 text-sm text-oai-gray-500 dark:text-oai-gray-400">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Loading advanced details...
                </div>
              ) : advancedState.error ? (
                <div className="text-sm text-red-700 dark:text-red-300">{advancedState.error}</div>
              ) : (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">Metadata</div>
                  {advancedSummary ? (
                    <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-white/70 px-3 py-2 text-sm leading-6 text-oai-black dark:bg-oai-gray-900/55 dark:text-white">
                      {advancedSummary}
                    </pre>
                  ) : (
                    <div className="mt-2 text-sm text-oai-gray-500 dark:text-oai-gray-400">No metadata available.</div>
                  )}
                </div>
              )}
            </div>
          ) : null}
        </section>
      </div>
    </section>
  );
}
