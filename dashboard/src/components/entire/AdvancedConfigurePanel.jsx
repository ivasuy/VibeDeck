import React, { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button, Input } from "../../ui/openai/components";
import { copy } from "../../lib/copy";
import { postEntireCommand } from "../../lib/vibedeck-api";
import { readEntirePrefs, writeEntirePrefs } from "./storage";
import { EntireCommandOutput } from "./EntireCommandOutput.jsx";

function parseArgv(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];

  const args = [];
  let current = "";
  let quote = null;
  let tokenStarted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (quote) {
      if (char === quote) {
        quote = null;
        tokenStarted = true;
        continue;
      }

      if (char === "\\") {
        const next = text[index + 1];
        if (next === quote || next === "\\") {
          current += next;
          index += 1;
        } else {
          current += "\\";
        }
        tokenStarted = true;
        continue;
      }

      current += char;
      tokenStarted = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (tokenStarted) {
        args.push(current);
        current = "";
        tokenStarted = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      tokenStarted = true;
      continue;
    }

    current += char;
    tokenStarted = true;
  }

  if (quote) {
    throw new Error("Unmatched quote in configure arguments.");
  }

  if (tokenStarted) {
    args.push(current);
  }

  return args;
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

export function AdvancedConfigurePanel({ repo = "", onActionSuccess, className = "" }) {
  const [argsText, setArgsText] = useState("");
  const [hydratedRepo, setHydratedRepo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [output, setOutput] = useState("");

  useEffect(() => {
    const cleanRepo = String(repo || "").trim();
    if (!cleanRepo) {
      setArgsText("");
      setHydratedRepo("");
      return;
    }
    const saved = readEntirePrefs("configure", cleanRepo);
    setArgsText(typeof saved?.argsText === "string" ? saved.argsText : "");
    setHydratedRepo(cleanRepo);
  }, [repo]);

  useEffect(() => {
    const cleanRepo = String(repo || "").trim();
    if (!cleanRepo || hydratedRepo !== cleanRepo) return;
    writeEntirePrefs("configure", cleanRepo, { argsText });
  }, [repo, hydratedRepo, argsText]);

  const runConfigure = async () => {
    if (!repo || busy) return;
    setError("");
    try {
      const args = parseArgv(argsText);
      setBusy(true);
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
    <div className={className}>
      <div className="space-y-1.5">
        <div className="grid gap-1.5">
          <Input
            placeholder={copy("entire.configure.input.placeholder")}
            value={argsText}
            onChange={(event) => setArgsText(event.target.value)}
            disabled={busy}
          />
          <Button type="button" size="sm" className="w-full justify-center" disabled={busy} onClick={runConfigure}>
            <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {copy("entire.configure.action")}
          </Button>
        </div>

        {error ? (
          <p className="text-sm text-red-700 dark:text-red-300">
            {copy("entire.configure.error", { error })}
          </p>
        ) : null}

        <EntireCommandOutput label={copy("entire.configure.output")} output={output} />
      </div>
    </div>
  );
}
