import React, { useEffect, useMemo, useState } from "react";
import { Activity, Power, PowerOff, Stethoscope } from "lucide-react";
import { Button } from "../../ui/openai/components";
import { copy } from "../../lib/copy";
import { postEntireCommand } from "../../lib/vibedeck-api";
import { readEntirePrefs, writeEntirePrefs } from "./storage";

const AGENTS = [
  "claude-code",
  "codex",
  "gemini",
  "opencode",
  "cursor",
  "factoryai-droid",
  "copilot-cli",
];

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

  return (
    <div className={className}>
      <div className="space-y-1.5">
        <div>
          <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
            {AGENTS.slice(0, 6).map((agent) => (
              <label
                key={agent}
                className="vd-control flex h-9 min-w-0 items-center gap-2 rounded-md border px-2.5 text-xs text-oai-gray-700 transition-colors has-[:checked]:border-oai-brand-500/50 has-[:checked]:bg-oai-brand-500/10 dark:text-oai-gray-200"
              >
                <input
                  type="checkbox"
                  className="accent-oai-brand"
                  checked={selectedAgents.includes(agent)}
                  onChange={(event) => toggleAgent(agent, event.target.checked)}
                />
                <span className="min-w-0 truncate">{agent}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label
            className="vd-control flex h-9 min-w-[170px] flex-1 items-center gap-2 rounded-md border px-2.5 text-xs text-oai-gray-700 transition-colors has-[:checked]:border-oai-brand-500/50 has-[:checked]:bg-oai-brand-500/10 dark:text-oai-gray-200 sm:flex-none"
          >
            <input
              type="checkbox"
              className="accent-oai-brand"
              checked={selectedAgents.includes(AGENTS[6])}
              onChange={(event) => toggleAgent(AGENTS[6], event.target.checked)}
            />
            <span className="min-w-0 truncate">{AGENTS[6]}</span>
          </label>
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
          <Button type="button" size="sm" variant="secondary" className="min-w-[96px] flex-1 justify-center sm:flex-none" disabled={busyKey !== ""} onClick={runStatus}>
            <Activity className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {copy("entire.actions.status")}
          </Button>
        </div>

        {error ? (
          <p className="text-sm text-red-700 dark:text-red-300">
            {copy("entire.actions.error", { error })}
          </p>
        ) : null}

        {output ? (
          <div className="rounded-md border border-oai-gray-200 bg-oai-black/[0.03] p-1.5 dark:border-oai-gray-800 dark:bg-white/[0.08]">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
              {copy("entire.actions.output")}
            </div>
            <pre className="max-h-36 overflow-auto text-xs text-oai-gray-700 dark:text-oai-gray-200">
              <code>{output}</code>
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}
