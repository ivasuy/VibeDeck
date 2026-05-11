import React, { useMemo, useState } from "react";
import { Button, Card, Input } from "../../ui/openai/components";
import { copy } from "../../lib/copy";
import { cn } from "../../lib/cn";
import { repoChipParts } from "./checkpoint-file-utils";

function normalizePath(value) {
  return String(value || "").trim();
}

function isAbsolutePath(value) {
  return /^([A-Za-z]:[\\/]|\/)/.test(value);
}

export function RepoPathSelector({
  value = "",
  onChange,
  onSubmit,
  suggestions = [],
  loading = false,
  error = "",
  className = "",
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

  const visibleSuggestions = uniqueSuggestions.slice(0, 8);
  const hiddenSuggestionCount = Math.max(uniqueSuggestions.length - visibleSuggestions.length, 0);

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
    <Card className={className} bodyClassName="!p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-oai-black dark:text-white">{copy("entire.repo.title")}</h2>
          <p className="mt-1 text-sm text-oai-gray-500 dark:text-oai-gray-400">{copy("entire.repo.subtitle")}</p>
        </div>
      </div>

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
        <div className="mt-3 flex min-w-0 items-center gap-2 overflow-hidden">
          <span className="shrink-0 text-xs text-oai-gray-500 dark:text-oai-gray-400">
            {copy("entire.repo.suggestions.label")}
          </span>
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
            {visibleSuggestions.map((repo) => {
              const { name, context, fullPath } = repoChipParts(repo);
              return (
                <button
                  key={repo}
                  type="button"
                  className={cn(
                    "max-w-[220px] shrink-0 rounded-md bg-oai-black/[0.04] px-2 py-1 text-left hover:bg-oai-black/[0.08]",
                    "dark:bg-white/[0.08] dark:hover:bg-white/[0.12]",
                  )}
                  title={fullPath}
                  aria-label={`Load recent repo ${name}`}
                  onClick={() => {
                    onChange?.(repo);
                    submitPath(repo);
                  }}
                >
                  <span className="block truncate text-xs font-medium text-oai-gray-800 dark:text-oai-gray-100">
                    {name}
                  </span>
                  {context ? (
                    <span className="block truncate text-[11px] text-oai-gray-500 dark:text-oai-gray-400">
                      {context}
                    </span>
                  ) : null}
                </button>
              );
            })}
            {hiddenSuggestionCount > 0 ? (
              <span className="shrink-0 self-center text-xs text-oai-gray-500 dark:text-oai-gray-400">
                +{hiddenSuggestionCount} more
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
