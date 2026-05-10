import React, { useMemo, useState } from "react";
import { Button, Card, Input } from "../../ui/openai/components";
import { copy } from "../../lib/copy";

export function normalizePath(value) {
  return String(value || "").trim();
}

export function isAbsolutePath(value) {
  return /^([A-Za-z]:[\\/]|\/)/.test(value);
}

export function RepoPathSelector({
  value = "",
  onChange,
  onSubmit,
  suggestions = [],
  loading = false,
  error = "",
}) {
  const [localError, setLocalError] = useState("");

  const uniqueSuggestions = useMemo(() => {
    const next = [];
    const seen = new Set();
    for (const item of suggestions || []) {
      const repo = normalizePath(item);
      if (!repo || seen.has(repo)) continue;
      seen.add(repo);
      next.push(repo);
    }
    return next;
  }, [suggestions]);

  const submitPath = (candidate) => {
    const repo = normalizePath(candidate);
    if (!repo || !isAbsolutePath(repo)) {
      setLocalError(copy("entire.repo.validation.absolute_path"));
      return;
    }
    setLocalError("");
    onSubmit?.(repo);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    submitPath(value);
  };

  const shownError = localError || error;

  return (
    <Card>
      <h2 className="text-sm font-semibold text-oai-black dark:text-white">{copy("entire.repo.title")}</h2>
      <p className="mt-1 text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("entire.repo.subtitle")}</p>

      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={handleSubmit}>
        <div className="min-w-[280px] flex-1">
          <Input
            label={copy("entire.repo.input.label")}
            value={value}
            onChange={(event) => onChange?.(event.target.value)}
            placeholder={copy("entire.repo.input.placeholder")}
            autoComplete="off"
            list="entire-repo-suggestions"
            disabled={loading}
          />
          {uniqueSuggestions.length > 0 ? (
            <datalist id="entire-repo-suggestions">
              {uniqueSuggestions.map((repo) => (
                <option key={repo} value={repo} />
              ))}
            </datalist>
          ) : null}
        </div>
        <Button type="submit" size="md" disabled={loading}>
          {loading ? copy("entire.repo.action.loading") : copy("entire.repo.action.load")}
        </Button>
      </form>

      {shownError ? (
        <p className="mt-2 text-sm text-red-700 dark:text-red-300">{shownError}</p>
      ) : null}

      {uniqueSuggestions.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-oai-gray-500 dark:text-oai-gray-400">
            {copy("entire.repo.suggestions.label")}
          </span>
          {uniqueSuggestions.map((repo) => (
            <button
              key={repo}
              type="button"
              className="max-w-full truncate rounded-md bg-oai-black/[0.04] px-2 py-1 text-xs text-oai-gray-700 hover:bg-oai-black/[0.08] dark:bg-white/[0.08] dark:text-oai-gray-200 dark:hover:bg-white/[0.12]"
              title={repo}
              onClick={() => {
                onChange?.(repo);
                submitPath(repo);
              }}
            >
              {repo}
            </button>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
