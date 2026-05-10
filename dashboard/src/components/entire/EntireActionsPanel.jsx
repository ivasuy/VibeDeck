import React, { useMemo, useState } from "react";
import { Button, Card, Input } from "../../ui/openai/components";
import { copy } from "../../lib/copy";
import { confirmDestructive, postEntireCommand } from "../../lib/vibedeck-api";

const AGENTS = [
  "claude-code",
  "codex",
  "gemini",
  "opencode",
  "cursor",
  "factoryai-droid",
  "copilot-cli",
];

const ENTIRE_AGENTS_STORAGE_KEY = "vibedeck.entire.selectedAgentsByRepo";

function loadStoredAgentsByRepo() {
  if (typeof window === "undefined" || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(ENTIRE_AGENTS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveStoredAgentsByRepo(value) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(ENTIRE_AGENTS_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Ignore storage failures in restricted browser modes.
  }
}

function commandOutputText(payload) {
  if (!payload) return "";
  const stdout = typeof payload.stdout === "string" ? payload.stdout.trim() : "";
  const stderr = typeof payload.stderr === "string" ? payload.stderr.trim() : "";
  if (stdout && stderr) return `${stdout}\n\n${stderr}`;
  if (stdout) return stdout;
  if (stderr) return stderr;
  return JSON.stringify(payload, null, 2);
}

export function EntireActionsPanel({ repo = "", onActionSuccess }) {
  const [selectedAgents, setSelectedAgents] = useState([]);
  const [checkpointId, setCheckpointId] = useState("");
  const [cleanAll, setCleanAll] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [output, setOutput] = useState("");

  const canEnable = useMemo(() => selectedAgents.length > 0, [selectedAgents]);
  const canRewind = useMemo(() => checkpointId.trim().length > 0, [checkpointId]);

  React.useEffect(() => {
    const stored = loadStoredAgentsByRepo();
    const next = Array.isArray(stored[repo]) ? stored[repo].filter((item) => AGENTS.includes(item)) : [];
    setSelectedAgents(next);
  }, [repo]);

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
      const next = checked ? (prev.includes(agent) ? prev : [...prev, agent]) : prev.filter((item) => item !== agent);
      const stored = loadStoredAgentsByRepo();
      if (repo) {
        stored[repo] = next;
        saveStoredAgentsByRepo(stored);
      }
      return next;
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

  const runRewind = async () => {
    const id = checkpointId.trim();
    if (!id) {
      setError(copy("entire.actions.rewind.validation.required"));
      return;
    }
    await runAction(
      "rewind",
      async () => {
        const { token } = await confirmDestructive("rewindCheckpoint");
        return postEntireCommand("rewind", { repo, checkpointId: id, confirm_token: token });
      },
      { reload: true },
    );
  };

  const runClean = () =>
    runAction(
      "clean",
      async () => {
        const { token } = await confirmDestructive("cleanEntire");
        return postEntireCommand("clean", { repo, all: cleanAll, confirm_token: token });
      },
      { reload: true },
    );

  return (
    <Card>
      <h2 className="text-sm font-semibold text-oai-black dark:text-white">{copy("entire.actions.title")}</h2>
      <p className="mt-1 text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("entire.actions.subtitle")}</p>

      <div className="mt-3 space-y-3">
        <div>
          <div className="mb-1 text-xs uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
            {copy("entire.actions.enable.agents_label")}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {AGENTS.map((agent) => (
              <label
                key={agent}
                className="flex items-center gap-2 rounded-md border border-oai-gray-200 px-2.5 py-1.5 text-xs text-oai-gray-700 dark:border-oai-gray-800 dark:text-oai-gray-200"
              >
                <input
                  type="checkbox"
                  checked={selectedAgents.includes(agent)}
                  aria-label={agent}
                  onChange={(event) => toggleAgent(agent, event.target.checked)}
                />
                <span>{agent}</span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-oai-gray-500 dark:text-oai-gray-400">
            {copy("entire.actions.enable.agents_hint")}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={busyKey !== "" || !canEnable} onClick={runEnable}>
            {copy("entire.actions.enable")}
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={busyKey !== ""} onClick={runDisable}>
            {copy("entire.actions.disable")}
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={busyKey !== ""} onClick={runDoctor}>
            {copy("entire.actions.doctor")}
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={busyKey !== ""} onClick={runStatus}>
            {copy("entire.actions.status")}
          </Button>
        </div>

        <div className="rounded-md border border-oai-gray-200 p-3 dark:border-oai-gray-800">
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <Input
              label={copy("entire.actions.rewind.input_label")}
              placeholder={copy("entire.actions.rewind.input_placeholder")}
              value={checkpointId}
              onChange={(event) => setCheckpointId(event.target.value)}
              disabled={busyKey !== ""}
            />
            <Button type="button" size="sm" variant="secondary" disabled={busyKey !== "" || !canRewind} onClick={runRewind}>
              {copy("entire.actions.rewind")}
            </Button>
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs text-oai-gray-600 dark:text-oai-gray-300">
            <input
              type="checkbox"
              checked={cleanAll}
              disabled={busyKey !== ""}
              onChange={(event) => setCleanAll(event.target.checked)}
            />
            <span>{copy("entire.actions.clean.all")}</span>
          </label>
          <div className="mt-2">
            <Button type="button" size="sm" variant="ghost" disabled={busyKey !== ""} onClick={runClean}>
              {copy("entire.actions.clean")}
            </Button>
          </div>
        </div>

        {error ? (
          <p className="text-sm text-red-700 dark:text-red-300">
            {copy("entire.actions.error", { error })}
          </p>
        ) : null}

        {output ? (
          <div className="rounded-md border border-oai-gray-200 bg-oai-black/[0.03] p-2 dark:border-oai-gray-800 dark:bg-white/[0.08]">
            <div className="mb-1 text-[11px] uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
              {copy("entire.actions.output")}
            </div>
            <pre className="max-h-44 overflow-auto text-xs text-oai-gray-700 dark:text-oai-gray-200">
              <code>{output}</code>
            </pre>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
