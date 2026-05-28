import React, { useState } from "react";
import { Card } from "../../openai/components";
import { FadeIn } from "../../foundation/FadeIn.jsx";
import { copy } from "../../../lib/copy";
import { ProviderLogo } from "../../../lib/provider-logos.jsx";

function formatReset(isoOrUnix) {
  if (!isoOrUnix) return null;
  const ts = typeof isoOrUnix === "number" ? isoOrUnix * 1000 : Date.parse(isoOrUnix);
  if (!Number.isFinite(ts)) return null;
  const diff = ts - Date.now();
  if (diff <= 0) return copy("shared.time.now");
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function formatDurationSeconds(value) {
  const totalSeconds = Math.max(0, Math.ceil(Number(value) || 0));
  if (totalSeconds <= 0) return copy("shared.time.now");
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.ceil(totalSeconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.ceil(hours / 24)}d`;
}

function barColor(pct) {
  if (pct >= 90) return "bg-red-500";
  if (pct >= 70) return "bg-amber-500";
  return "bg-indigo-500";
}

function formatCompactTokens(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

function tokenPair(window) {
  const used = formatCompactTokens(window?.used_tokens);
  const limit = formatCompactTokens(window?.limit_tokens);
  if (!used || !limit) return null;
  return `${used} / ${limit} tokens`;
}

function LimitBar({ label, pct, reset, window }) {
  const raw = Math.max(0, Math.min(100, Number(pct) || 0));
  const rounded = Math.round(raw);
  // Sub-1% usage still matters (e.g. team pool); keep bar/text from collapsing to 0%.
  const widthPct = raw > 0 && rounded === 0 ? Math.max(raw, 0.35) : raw;
  const labelPct =
    raw > 0 && rounded === 0 ? "<1" : String(rounded);
  const exactTokens = tokenPair(window);
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-oai-gray-500 dark:text-oai-gray-400 w-12 shrink-0">{label}</span>
        <div className="flex-1 bg-oai-gray-100 dark:bg-oai-gray-700/50 rounded-full h-1.5 overflow-hidden">
          <div
            className={`${barColor(rounded)} rounded-full h-full transition-[width] duration-500 ease-out`}
            style={{ width: `${widthPct}%`, minWidth: raw > 0 ? "3px" : 0 }}
          />
        </div>
        <span className="text-[11px] tabular-nums text-oai-gray-500 dark:text-oai-gray-400 w-[30px] text-right shrink-0">
          {labelPct}%
        </span>
        {reset ? (
          <span className="text-[10px] text-oai-gray-400 dark:text-oai-gray-500 w-6 text-right shrink-0">
            {reset}
          </span>
        ) : null}
      </div>
      {exactTokens ? (
        <div className="pl-14 text-[10px] tabular-nums text-oai-gray-400 dark:text-oai-gray-500">
          {exactTokens}
        </div>
      ) : null}
    </div>
  );
}

function ToolGroup({ id, name, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <ProviderLogo provider={id} size={14} className="text-oai-gray-700 dark:text-oai-gray-200" />
        <span className="text-sm font-medium text-oai-black dark:text-oai-white">{name}</span>
      </div>
      {children}
    </div>
  );
}

const DEFAULT_ORDER = [
  "antigravity",
  "claude",
  "codex",
  "copilot",
  "cursor",
  "factoryai",
  "gemini",
  "hermes",
  "kimi",
  "kiro",
  "openclaw",
  "opencode",
];

const PROVIDER_META = {
  antigravity: { name: "Antigravity" },
  claude: { name: "Claude" },
  codex: { name: "Codex" },
  copilot: { name: "GitHub Copilot" },
  cursor: { name: "Cursor" },
  factoryai: { name: "Factory AI" },
  gemini: { name: "Gemini" },
  hermes: { name: "Hermes" },
  kimi: { name: "Kimi" },
  kiro: { name: "Kiro" },
  openclaw: { name: "OpenClaw" },
  opencode: { name: "OpenCode" },
};

function StatusLine({ children, tone = "neutral" }) {
  const color =
    tone === "error"
      ? "text-red-600 dark:text-red-400"
      : tone === "warning"
        ? "text-amber-700 dark:text-amber-300"
      : "text-oai-gray-500 dark:text-oai-gray-400";
  return <div className={`text-[11px] leading-snug ${color}`}>{children}</div>;
}

function renderProviderGroup(id, data) {
  const meta = PROVIDER_META[id];
  if (!meta) return null;
  if (!data?.configured) {
    return (
      <ToolGroup key={id} id={id} name={meta.name}>
        <StatusLine>{copy("limits.status.not_connected")}</StatusLine>
      </ToolGroup>
    );
  }
  if (data.status === "cooldown") {
    return (
      <ToolGroup key={id} id={id} name={meta.name}>
        <StatusLine tone="warning">
          {copy("limits.status.cooldown", {
            duration: formatDurationSeconds(data.retry_after_seconds),
          })}
        </StatusLine>
      </ToolGroup>
    );
  }
  if (data.status === "setup_required") {
    return (
      <ToolGroup key={id} id={id} name={meta.name}>
        <StatusLine tone="warning">{copy("limits.status.setup_required")}</StatusLine>
        {id === "gemini" ? (
          <StatusLine>{copy("limits.gemini.setup_hint")}</StatusLine>
        ) : null}
      </ToolGroup>
    );
  }
  if (data.error) {
    return (
      <ToolGroup key={id} id={id} name={meta.name}>
        <StatusLine tone="error">{copy("shared.error.prefix", { error: data.error })}</StatusLine>
      </ToolGroup>
    );
  }

  switch (id) {
    case "claude":
      return (
        <ToolGroup key="claude" id="claude" name={meta.name}>
          {data.five_hour ? <LimitBar label="5h" pct={data.five_hour.utilization} reset={formatReset(data.five_hour.resets_at)} window={data.five_hour} /> : null}
          {data.seven_day ? <LimitBar label="7d" pct={data.seven_day.utilization} reset={formatReset(data.seven_day.resets_at)} window={data.seven_day} /> : null}
          {data.seven_day_opus ? <LimitBar label="Opus" pct={data.seven_day_opus.utilization} reset={formatReset(data.seven_day_opus.resets_at)} window={data.seven_day_opus} /> : null}
          {!data.five_hour && !data.seven_day && !data.seven_day_opus ? <StatusLine>{copy("limits.status.no_data")}</StatusLine> : null}
        </ToolGroup>
      );
    case "codex":
      return (
        <ToolGroup key="codex" id="codex" name={meta.name}>
          {data.primary_window ? <LimitBar label="5h" pct={data.primary_window.used_percent} reset={formatReset(data.primary_window.reset_at)} window={data.primary_window} /> : null}
          {data.secondary_window ? <LimitBar label="7d" pct={data.secondary_window.used_percent} reset={formatReset(data.secondary_window.reset_at)} window={data.secondary_window} /> : null}
          {!data.primary_window && !data.secondary_window ? <StatusLine>{copy("limits.status.no_data")}</StatusLine> : null}
        </ToolGroup>
      );
    case "cursor":
      return (
        <ToolGroup key="cursor" id="cursor" name={meta.name}>
          {data.primary_window ? <LimitBar label={copy("limits.label.cursor_plan")} pct={data.primary_window.used_percent} reset={formatReset(data.primary_window.reset_at)} window={data.primary_window} /> : null}
          {data.secondary_window ? <LimitBar label={copy("limits.label.cursor_auto")} pct={data.secondary_window.used_percent} reset={formatReset(data.secondary_window.reset_at)} window={data.secondary_window} /> : null}
          {data.tertiary_window ? <LimitBar label={copy("limits.label.cursor_api")} pct={data.tertiary_window.used_percent} reset={formatReset(data.tertiary_window.reset_at)} window={data.tertiary_window} /> : null}
          {!data.primary_window && !data.secondary_window && !data.tertiary_window ? <StatusLine>{copy("limits.status.no_data")}</StatusLine> : null}
        </ToolGroup>
      );
    case "gemini":
      return (
        <ToolGroup key="gemini" id="gemini" name={meta.name}>
          {data.primary_window ? <LimitBar label="Pro" pct={data.primary_window.used_percent} reset={formatReset(data.primary_window.reset_at)} window={data.primary_window} /> : null}
          {data.secondary_window ? <LimitBar label="Flash" pct={data.secondary_window.used_percent} reset={formatReset(data.secondary_window.reset_at)} window={data.secondary_window} /> : null}
          {data.tertiary_window ? <LimitBar label="Lite" pct={data.tertiary_window.used_percent} reset={formatReset(data.tertiary_window.reset_at)} window={data.tertiary_window} /> : null}
          {!data.primary_window && !data.secondary_window && !data.tertiary_window ? <StatusLine>{copy("limits.status.no_data")}</StatusLine> : null}
        </ToolGroup>
      );
    case "kimi":
      return (
        <ToolGroup key="kimi" id="kimi" name={meta.name}>
          {data.primary_window ? <LimitBar label={copy("limits.label.kimi_weekly")} pct={data.primary_window.used_percent} reset={formatReset(data.primary_window.reset_at)} window={data.primary_window} /> : null}
          {data.secondary_window ? <LimitBar label={copy("limits.label.kimi_5h")} pct={data.secondary_window.used_percent} reset={formatReset(data.secondary_window.reset_at)} window={data.secondary_window} /> : null}
          {data.tertiary_window ? <LimitBar label={copy("limits.label.kimi_total")} pct={data.tertiary_window.used_percent} reset={formatReset(data.tertiary_window.reset_at)} window={data.tertiary_window} /> : null}
          {data.parallel_limit ? <StatusLine>{copy("limits.label.kimi_parallel", { count: data.parallel_limit })}</StatusLine> : null}
          {!data.primary_window && !data.secondary_window && !data.tertiary_window ? <StatusLine>{copy("limits.status.no_data")}</StatusLine> : null}
        </ToolGroup>
      );
    case "kiro":
      return (
        <ToolGroup key="kiro" id="kiro" name={meta.name}>
          {data.primary_window ? <LimitBar label={copy("limits.label.kiro_month")} pct={data.primary_window.used_percent} reset={formatReset(data.primary_window.reset_at)} window={data.primary_window} /> : null}
          {data.secondary_window ? <LimitBar label={copy("limits.label.kiro_bonus")} pct={data.secondary_window.used_percent} reset={formatReset(data.secondary_window.reset_at)} window={data.secondary_window} /> : null}
          {!data.primary_window && !data.secondary_window ? <StatusLine>{copy("limits.status.no_data")}</StatusLine> : null}
        </ToolGroup>
      );
    case "antigravity":
      return (
        <ToolGroup key="antigravity" id="antigravity" name={meta.name}>
          {data.primary_window ? <LimitBar label="Claude" pct={data.primary_window.used_percent} reset={formatReset(data.primary_window.reset_at)} window={data.primary_window} /> : null}
          {data.secondary_window ? <LimitBar label="G Pro" pct={data.secondary_window.used_percent} reset={formatReset(data.secondary_window.reset_at)} window={data.secondary_window} /> : null}
          {data.tertiary_window ? <LimitBar label="Flash" pct={data.tertiary_window.used_percent} reset={formatReset(data.tertiary_window.reset_at)} window={data.tertiary_window} /> : null}
          {!data.primary_window && !data.secondary_window && !data.tertiary_window ? <StatusLine>{copy("limits.status.no_data")}</StatusLine> : null}
        </ToolGroup>
      );
    case "copilot":
      return (
        <ToolGroup key="copilot" id="copilot" name={meta.name}>
          {data.primary_window ? <LimitBar label={copy("limits.label.copilot_premium")} pct={data.primary_window.used_percent} reset={formatReset(data.primary_window.reset_at)} window={data.primary_window} /> : null}
          {data.secondary_window ? <LimitBar label={copy("limits.label.copilot_chat")} pct={data.secondary_window.used_percent} reset={formatReset(data.secondary_window.reset_at)} window={data.secondary_window} /> : null}
          {!data.primary_window && !data.secondary_window ? <StatusLine>{copy("limits.status.no_data")}</StatusLine> : null}
          {data.otel_has_files || data.otel_enabled ? null : <CopilotOtelHint defaultDir={data.otel_default_dir} />}
        </ToolGroup>
      );
    default:
      return (
        <ToolGroup key={id} id={id} name={meta.name}>
          {data.primary_window ? <LimitBar label="Primary" pct={data.primary_window.used_percent} reset={formatReset(data.primary_window.reset_at)} window={data.primary_window} /> : null}
          {data.secondary_window ? <LimitBar label="Secondary" pct={data.secondary_window.used_percent} reset={formatReset(data.secondary_window.reset_at)} window={data.secondary_window} /> : null}
          {data.tertiary_window ? <LimitBar label="Tertiary" pct={data.tertiary_window.used_percent} reset={formatReset(data.tertiary_window.reset_at)} window={data.tertiary_window} /> : null}
          {!data.primary_window && !data.secondary_window && !data.tertiary_window ? <StatusLine>{copy("limits.status.no_data")}</StatusLine> : null}
        </ToolGroup>
      );
  }
}

function CopilotOtelHint({ defaultDir }) {
  const [copied, setCopied] = useState(false);
  const dir = defaultDir || "$HOME/.copilot/otel";
  const snippet = [
    "export COPILOT_OTEL_ENABLED=true",
    "export COPILOT_OTEL_EXPORTER_TYPE=file",
    `export COPILOT_OTEL_FILE_EXPORTER_PATH="${dir}/copilot-otel-$(date +%Y%m%d).jsonl"`,
  ].join("\n");

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (_e) {
      // Clipboard can be unavailable in embedded or restricted contexts.
    }
  };

  return (
    <div className="mt-1 rounded-md border border-amber-300/60 dark:border-amber-700/40 bg-amber-50/50 dark:bg-amber-900/10 px-2.5 py-2 text-[11px] text-oai-gray-600 dark:text-oai-gray-300">
      <div className="font-medium text-oai-gray-700 dark:text-oai-gray-200">{copy("limits.copilot.otelHint.title")}</div>
      <div className="mt-0.5 leading-snug">{copy("limits.copilot.otelHint.body")}</div>
      <pre className="mt-1.5 overflow-x-auto rounded bg-[var(--vd-tint)] px-2 py-1.5 font-mono text-[10.5px] leading-tight whitespace-pre">{snippet}</pre>
      <button
        type="button"
        onClick={onCopy}
        className="vd-control mt-1 inline-flex items-center gap-1 rounded border border-[var(--vd-border)] bg-[var(--vd-control-bg)] px-1.5 py-0.5 text-[10.5px] text-oai-gray-700 transition-colors hover:bg-[var(--vd-tint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vd-ring)] dark:text-oai-gray-200"
      >
        {copied ? copy("limits.copilot.otelHint.copied") : copy("limits.copilot.otelHint.copy")}
      </button>
    </div>
  );
}

export function UsageLimitsPanel({
  antigravity,
  claude,
  codex,
  copilot,
  cursor,
  factoryai,
  gemini,
  hermes,
  kimi,
  kiro,
  openclaw,
  opencode,
  order,
  visibility,
}) {
  const dataById = {
    antigravity,
    claude,
    codex,
    copilot,
    cursor,
    factoryai,
    gemini,
    hermes,
    kimi,
    kiro,
    openclaw,
    opencode,
  };
  const effectiveOrder = Array.isArray(order) && order.length > 0 ? order : DEFAULT_ORDER;

  const groups = effectiveOrder
    .filter((id) => !visibility || visibility[id] !== false)
    .map((id) => renderProviderGroup(id, dataById[id]))
    .filter(Boolean);

  return (
    <FadeIn delay={0.15}>
      <Card>
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-oai-gray-500 dark:text-oai-gray-300 uppercase tracking-wide">{copy("limits.panel.title")}</h3>
          {groups.length > 0 ? groups : <StatusLine>{copy("limits.status.all_hidden")}</StatusLine>}
        </div>
      </Card>
    </FadeIn>
  );
}
