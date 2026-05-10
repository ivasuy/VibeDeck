import React, { useState } from "react";
import { Button, Card, Input } from "../../ui/openai/components";
import { copy } from "../../lib/copy";
import { postEntireCommand } from "../../lib/vibedeck-api";
import { EntireFlagChips } from "./EntireFlagChips";

function parseArgv(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];
  return text.match(/\S+/g) || [];
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

function serializeArgv(tokens) {
  return tokens.join(" ").trim();
}

export function AdvancedConfigurePanel({ repo = "", onActionSuccess }) {
  const [open, setOpen] = useState(false);
  const [argsText, setArgsText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [output, setOutput] = useState("");

  const toggleFlag = (flag) => {
    setArgsText((prev) => {
      const tokens = parseArgv(prev);
      const next = tokens.includes(flag)
        ? tokens.filter((token) => token !== flag)
        : [...tokens.filter((token) => token !== flag), flag];
      return serializeArgv(next);
    });
  };

  const runConfigure = async () => {
    if (!repo || busy) return;
    setBusy(true);
    setError("");
    try {
      const args = parseArgv(argsText);
      const result = await postEntireCommand("configure", { repo, args });
      setOutput(commandOutputText(result));
      await onActionSuccess?.();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : copy("entire.configure.error_fallback");
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-oai-black dark:text-white">{copy("entire.configure.title")}</h2>
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpen((prev) => !prev)}>
          {copy("entire.configure.disclosure")}
        </Button>
      </div>

      <p className="mt-1 text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("entire.configure.subtitle")}</p>

      {open ? (
        <div className="mt-3 space-y-3">
          <EntireFlagChips selectedFlags={parseArgv(argsText)} onToggle={toggleFlag} />
          <Input
            label={copy("entire.configure.input.label")}
            placeholder={copy("entire.configure.input.placeholder")}
            value={argsText}
            onChange={(event) => setArgsText(event.target.value)}
            disabled={busy}
          />
          <Button type="button" size="sm" disabled={busy} onClick={runConfigure}>
            {copy("entire.configure.action")}
          </Button>

          {error ? (
            <p className="text-sm text-red-700 dark:text-red-300">
              {copy("entire.configure.error", { error })}
            </p>
          ) : null}

          {output ? (
            <div className="rounded-md border border-oai-gray-200 bg-oai-black/[0.03] p-2 dark:border-oai-gray-800 dark:bg-white/[0.08]">
              <div className="mb-1 text-[11px] uppercase tracking-wide text-oai-gray-500 dark:text-oai-gray-400">
                {copy("entire.configure.output")}
              </div>
              <pre className="max-h-44 overflow-auto text-xs text-oai-gray-700 dark:text-oai-gray-200">
                <code>{output}</code>
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
