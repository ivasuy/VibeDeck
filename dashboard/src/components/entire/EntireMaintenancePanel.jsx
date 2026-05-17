import React, { useEffect, useMemo, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { Button, Input } from "../../ui/openai/components";
import { copy } from "../../lib/copy";
import { confirmDestructive, postEntireCommand } from "../../lib/vibedeck-api";
import { readEntirePrefs, writeEntirePrefs } from "./storage";
import { EntireCommandOutput } from "./EntireCommandOutput.jsx";

function commandOutputText(payload) {
  if (!payload) return "";
  const stdout = typeof payload.stdout === "string" ? payload.stdout.trim() : "";
  const stderr = typeof payload.stderr === "string" ? payload.stderr.trim() : "";
  if (stdout && stderr) return `${stdout}\n\n${stderr}`;
  if (stdout) return stdout;
  if (stderr) return stderr;
  return JSON.stringify(payload, null, 2);
}

export function EntireMaintenancePanel({ repo = "", onActionSuccess, className = "" }) {
  const [checkpointId, setCheckpointId] = useState("");
  const [cleanAll, setCleanAll] = useState(false);
  const [hydratedRepo, setHydratedRepo] = useState("");
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [output, setOutput] = useState("");

  const canRewind = useMemo(() => checkpointId.trim().length > 0, [checkpointId]);

  useEffect(() => {
    const cleanRepo = String(repo || "").trim();
    if (!cleanRepo) {
      setCheckpointId("");
      setCleanAll(false);
      setHydratedRepo("");
      return;
    }
    const saved = readEntirePrefs("actions", cleanRepo);
    setCheckpointId(typeof saved?.checkpointId === "string" ? saved.checkpointId : "");
    setCleanAll(Boolean(saved?.cleanAll));
    setHydratedRepo(cleanRepo);
  }, [repo]);

  useEffect(() => {
    const cleanRepo = String(repo || "").trim();
    if (!cleanRepo || hydratedRepo !== cleanRepo) return;
    const existing = readEntirePrefs("actions", cleanRepo) || {};
    writeEntirePrefs("actions", cleanRepo, { ...existing, checkpointId, cleanAll });
  }, [repo, hydratedRepo, checkpointId, cleanAll]);

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
    <div className={className}>
      <div className="space-y-1.5">
        <div className="grid gap-1.5">
          <Input
            placeholder={copy("entire.actions.rewind.input_placeholder")}
            value={checkpointId}
            onChange={(event) => setCheckpointId(event.target.value)}
            disabled={busyKey !== ""}
          />
          <div className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_34px_34px] sm:items-center">
            <label className="flex min-w-0 items-center gap-2 text-xs text-oai-gray-600 dark:text-oai-gray-300">
              <input
                type="checkbox"
                checked={cleanAll}
                disabled={busyKey !== ""}
                onChange={(event) => setCleanAll(event.target.checked)}
              />
              <span className="whitespace-nowrap">{copy("entire.actions.clean.all")}</span>
            </label>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="!h-8 !w-8 !px-0"
              aria-label={copy("entire.actions.rewind")}
              title={copy("entire.actions.rewind")}
              disabled={busyKey !== "" || !canRewind}
              onClick={runRewind}
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">{copy("entire.actions.rewind")}</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="!h-8 !w-8 !px-0"
              aria-label={copy("entire.actions.clean")}
              title={copy("entire.actions.clean")}
              disabled={busyKey !== ""}
              onClick={runClean}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">{copy("entire.actions.clean")}</span>
            </Button>
          </div>
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
