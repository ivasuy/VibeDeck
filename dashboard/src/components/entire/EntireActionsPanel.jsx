import React, { useEffect, useMemo, useState } from "react";
import { Activity, Check, Power, PowerOff, Stethoscope } from "lucide-react";
import { Button } from "../../ui/openai/components";
import { copy } from "../../lib/copy";
import { postEntireCommand } from "../../lib/vibedeck-api";
import { readEntirePrefs, writeEntirePrefs } from "./storage";
import { EntireCommandOutput } from "./EntireCommandOutput.jsx";

const AGENTS = [
  "claude-code",
  "codex",
  "gemini",
  "opencode",
  "cursor",
  "factoryai-droid",
  "copilot-cli",
];

const AGENT_META = {
  "claude-code": {
    label: "Claude Code",
    logo: "/brand-logos/claude-code.svg",
    detail: "Anthropic CLI hooks",
  },
  codex: {
    label: "Codex",
    logo: "/brand-logos/codex.svg",
    detail: "OpenAI CLI notify",
  },
  gemini: {
    label: "Gemini",
    logo: "/brand-logos/gemini.svg",
    detail: "Gemini local state",
  },
  opencode: {
    label: "OpenCode",
    logo: "/brand-logos/opencode.svg",
    detail: "OpenCode plugin",
  },
  cursor: {
    label: "Cursor",
    logo: "/brand-logos/cursor.svg",
    detail: "Editor sessions",
  },
  "factoryai-droid": {
    label: "Factory Droid",
    logo: "/brand-logos/factoryai-droid.svg",
    detail: "Factory agent",
  },
  "copilot-cli": {
    label: "Copilot CLI",
    logo: "/brand-logos/copilot.svg",
    detail: "GitHub Copilot",
  },
};

function commandOutputText(payload) {
  if (!payload) return "";
  const stdout = typeof payload.stdout === "string" ? payload.stdout.trim() : "";
  const stderr = typeof payload.stderr === "string" ? payload.stderr.trim() : "";
  if (stdout && stderr) return `${stdout}\n\n${stderr}`;
  if (stdout) return stdout;
  if (stderr) return stderr;
  return JSON.stringify(payload, null, 2);
}

export function EntireActionsPanel({ repo = "", onActionSuccess, className = "" }) {
  const [selectedAgents, setSelectedAgents] = useState([]);
  const [hydratedRepo, setHydratedRepo] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [output, setOutput] = useState("");

  const canEnable = useMemo(() => selectedAgents.length > 0, [selectedAgents]);

  useEffect(() => {
    const cleanRepo = String(repo || "").trim();
    if (!cleanRepo) {
      setSelectedAgents([]);
      setHydratedRepo("");
      return;
    }
    const saved = readEntirePrefs("actions", cleanRepo);
    const savedAgents = Array.isArray(saved?.selectedAgents)
      ? saved.selectedAgents.filter((agent) => AGENTS.includes(agent))
      : [];
    setSelectedAgents(savedAgents);
    setHydratedRepo(cleanRepo);
  }, [repo]);

  useEffect(() => {
    const cleanRepo = String(repo || "").trim();
    if (!cleanRepo || hydratedRepo !== cleanRepo) return;
    const existing = readEntirePrefs("actions", cleanRepo) || {};
    writeEntirePrefs("actions", cleanRepo, { ...existing, selectedAgents });
  }, [repo, hydratedRepo, selectedAgents]);

  const runAction = async (key, task, { reload = false } = {}) => {
    if (!repo) return;
    setBusyKey(key);
    setError("");
    try {
      const result = await task();
      setOutput(commandOutputText(result));
      if (reload) await onActionSuccess?.();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : copy("entire.actions.error_fallback");
      setError(message);
    } finally {
      setBusyKey("");
    }
  };

  const toggleAgent = (agent, checked) => {
    setSelectedAgents((prev) => {
      if (checked) return prev.includes(agent) ? prev : [...prev, agent];
      return prev.filter((item) => item !== agent);
    });
  };

  const runEnable = () =>
    runAction(
      "enable",
      () => postEntireCommand("enable", { repo, agents: selectedAgents }),
      { reload: true },
    );

  const runDisable = () =>
    runAction(
      "disable",
      () => postEntireCommand("disable", { repo }),
      { reload: true },
    );

  const runDoctor = () =>
    runAction("doctor", () => postEntireCommand("doctor", { repo }));

  const runStatus = () =>
    runAction("status", () => postEntireCommand("status", { repo }));

  const renderAgentTile = (agent) => {
    const meta = AGENT_META[agent] || { label: agent, logo: "", detail: "Agent" };
    const checked = selectedAgents.includes(agent);

    return (
      <label
        key={agent}
        className={[
          "group relative flex min-h-[74px] cursor-pointer items-start gap-3 rounded-xl border p-3 text-left transition",
          checked
            ? "border-oai-brand-500/50 bg-oai-brand-500/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] dark:bg-oai-brand-400/10"
            : "border-[var(--vd-border)] bg-white/65 hover:border-oai-brand-300 hover:bg-white dark:bg-oai-gray-950/30 dark:hover:border-oai-brand-500/50",
        ].join(" ")}
      >
        <input
          type="checkbox"
          className="sr-only"
          aria-label={agent}
          checked={checked}
          onChange={(event) => toggleAgent(agent, event.target.checked)}
        />
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--vd-border)] bg-white text-oai-gray-900 dark:bg-oai-gray-950 dark:text-white">
          {meta.logo ? (
            <img src={meta.logo} alt="" className="h-5 w-5 object-contain" aria-hidden />
          ) : (
            <span className="text-xs font-semibold">{meta.label.slice(0, 2)}</span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block break-words text-sm font-semibold leading-5 text-oai-black dark:text-white">
            {meta.label}
          </span>
          <span className="mt-0.5 block break-words text-[11px] leading-4 text-oai-gray-500 dark:text-oai-gray-400">
            {meta.detail}
          </span>
        </span>
        <span
          className={[
            "absolute right-2.5 top-2.5 flex h-5 w-5 items-center justify-center rounded-full border transition",
            checked
              ? "border-oai-brand-500 bg-oai-brand-500 text-white"
              : "border-oai-gray-300 bg-white text-transparent dark:border-oai-gray-700 dark:bg-oai-gray-950",
          ].join(" ")}
          aria-hidden
        >
          <Check className="h-3 w-3" />
        </span>
      </label>
    );
  };

  return (
    <div className={className}>
      <div className="space-y-3">
        <div className="space-y-2">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">Agent coverage</div>
              <div className="mt-0.5 text-[11px] text-oai-gray-500 dark:text-oai-gray-400">
                Pick the tools Entire should protect in this repo.
              </div>
            </div>
            <span className="shrink-0 rounded-md bg-oai-black/[0.04] px-2 py-1 text-[11px] font-medium text-oai-gray-600 dark:bg-white/[0.08] dark:text-oai-gray-300">
              {selectedAgents.length}/{AGENTS.length}
            </span>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {AGENTS.map(renderAgentTile)}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <Button type="button" size="sm" className="min-w-[96px] flex-1 justify-center sm:flex-none" disabled={busyKey !== "" || !canEnable} onClick={runEnable}>
            <Power className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {copy("entire.actions.enable")}
          </Button>
          <Button type="button" size="sm" variant="secondary" className="min-w-[96px] flex-1 justify-center sm:flex-none" disabled={busyKey !== ""} onClick={runDisable}>
            <PowerOff className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {copy("entire.actions.disable")}
          </Button>
          <Button type="button" size="sm" variant="secondary" className="min-w-[96px] flex-1 justify-center sm:flex-none" disabled={busyKey !== ""} onClick={runDoctor}>
            <Stethoscope className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {copy("entire.actions.doctor")}
          </Button>
          <Button type="button" size="sm" variant="secondary" className="min-w-[96px] flex-1 justify-center sm:flex-none" aria-label={copy("entire.actions.status")} disabled={busyKey !== ""} onClick={runStatus}>
            <Activity className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            CLI status
          </Button>
        </div>

        {error ? (
          <p className="text-sm text-red-700 dark:text-red-300">
            {copy("entire.actions.error", { error })}
          </p>
        ) : null}

        <EntireCommandOutput label={copy("entire.actions.output")} output={output} />
      </div>
    </div>
  );
}
