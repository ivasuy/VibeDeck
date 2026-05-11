import React, { useMemo, useState } from "react";
import { FolderOpen } from "lucide-react";
import { Button, Input } from "../../ui/openai/components";
import { copy } from "../../lib/copy";

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
  description = "",
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
    <div className={className}>
      <form className="flex flex-wrap items-end gap-1.5" onSubmit={handleSubmit}>
        <div className="min-w-[280px] flex-1">
          <Input
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
          <FolderOpen className="mr-1.5 h-4 w-4" aria-hidden />
          {loading ? copy("entire.repo.action.loading") : copy("entire.repo.action.load")}
        </Button>
      </form>
      {description ? (
        <p className="mt-1.5 text-xs leading-5 text-oai-gray-500 dark:text-oai-gray-400">{description}</p>
      ) : null}

      {shownError ? (
        <p className="mt-1.5 text-sm text-red-700 dark:text-red-300">{shownError}</p>
      ) : null}
    </div>
  );
}
