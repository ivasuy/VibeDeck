import React, { useEffect, useMemo, useState } from "react";
import { Button, Card, Input } from "../../ui/openai/components";
import { copy } from "../../lib/copy";
import { postAttribute } from "../../lib/vibedeck-api";

function readBranch(session) {
  const branch = String(session?.branch || "").trim();
  return branch || "";
}

function normalizeConfidence(value) {
  const confidence = String(value || "").trim().toLowerCase();
  return confidence || "unattributed";
}

export function BranchOverridePanel({ session, onSuccess }) {
  const [branch, setBranch] = useState("");
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    setBranch(readBranch(session));
    setError("");
    setSuccess("");
    setBusyAction("");
  }, [session?.provider, session?.session_id, session?.branch]);

  const canMutate = Boolean(session?.provider && session?.session_id);
  const confidence = useMemo(() => normalizeConfidence(session?.confidence), [session?.confidence]);
  const currentBranch = useMemo(
    () => readBranch(session) || copy("live.value.unattributed_branch"),
    [session],
  );

  if (!session) return null;

  const runSuccess = async () => {
    if (typeof onSuccess === "function") {
      await onSuccess();
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const nextBranch = branch.trim();
    if (!nextBranch) {
      setError(copy("live.override.validation.branch_required"));
      setSuccess("");
      return;
    }
    if (!canMutate) return;
    setBusyAction("save");
    setError("");
    setSuccess("");
    try {
      await postAttribute({
        provider: session.provider,
        session_id: session.session_id,
        branch: nextBranch,
      });
      setSuccess(copy("live.override.success.saved", { branch: nextBranch }));
      await runSuccess();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : copy("live.override.error.fallback");
      setError(copy("live.override.error.submit", { error: message }));
    } finally {
      setBusyAction("");
    }
  };

  const handleClear = async () => {
    if (!canMutate) return;
    setBusyAction("clear");
    setError("");
    setSuccess("");
    try {
      await postAttribute({
        provider: session.provider,
        session_id: session.session_id,
        branch: null,
      });
      setBranch("");
      setSuccess(copy("live.override.success.cleared"));
      await runSuccess();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : copy("live.override.error.fallback");
      setError(copy("live.override.error.submit", { error: message }));
    } finally {
      setBusyAction("");
    }
  };

  const isBusy = Boolean(busyAction);

  return (
    <Card>
      <h2 className="text-sm font-semibold text-oai-black dark:text-white">{copy("live.override.title")}</h2>
      <p className="mt-1 text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("live.override.subtitle")}</p>

      <div className="mt-3 grid gap-2 text-xs">
        <div className="flex items-center justify-between rounded-md bg-oai-black/[0.03] px-2.5 py-2 text-oai-gray-600 dark:bg-white/[0.08] dark:text-oai-gray-300">
          <span>{copy("live.override.meta.current_branch")}</span>
          <span className="truncate pl-2 font-medium text-oai-black dark:text-white" title={currentBranch}>
            {copy("live.override.meta.current_branch_value", { branch: currentBranch })}
          </span>
        </div>
        <div className="flex items-center justify-between rounded-md bg-oai-black/[0.03] px-2.5 py-2 text-oai-gray-600 dark:bg-white/[0.08] dark:text-oai-gray-300">
          <span>{copy("live.override.meta.confidence")}</span>
          <span className="font-medium capitalize text-oai-black dark:text-white">{confidence}</span>
        </div>
      </div>

      <form className="mt-3 space-y-3" onSubmit={handleSubmit}>
        <Input
          label={copy("live.override.input.branch.label")}
          value={branch}
          onChange={(event) => setBranch(event.target.value)}
          placeholder={copy("live.override.input.branch.placeholder")}
          disabled={isBusy}
        />
        {error ? <p className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
        {success ? <p className="text-sm text-emerald-700 dark:text-emerald-300">{success}</p> : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={isBusy || !canMutate}>
            {busyAction === "save" ? copy("live.override.action.saving") : copy("live.override.action.save")}
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={isBusy || !canMutate} onClick={handleClear}>
            {busyAction === "clear" ? copy("live.override.action.clearing") : copy("live.override.action.clear")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
