import React, { useMemo, useState } from "react";
import { LimitsSettingsPanel } from "../components/LimitsSettingsPanel.jsx";
import { AccountSection } from "../components/settings/AccountSection.jsx";
import { AppearanceSection } from "../components/settings/AppearanceSection.jsx";
import { SectionCard } from "../components/settings/Controls.jsx";
import { MenuBarSection, NativeAppFooter } from "../components/settings/MenuBarSection.jsx";
import { useLimitsDisplayPrefs } from "../hooks/use-limits-display-prefs.js";
import { getAutoDetectedProviders } from "../lib/api";
import { copy } from "../lib/copy";

const MODEL_ALIASES_STORAGE_KEY = "vibedeck.modelAliases.v1";

function readStoredAliases() {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(MODEL_ALIASES_STORAGE_KEY) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((row) => row?.alias && row?.canonical)
      : [];
  } catch (_err) {
    return [];
  }
}

function writeStoredAliases(aliases) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(MODEL_ALIASES_STORAGE_KEY, JSON.stringify(aliases));
  } catch (_err) {
    // Local-only settings are best effort.
  }
}

function ModelAliasesSection() {
  const [aliases, setAliases] = useState(() => readStoredAliases());
  const [alias, setAlias] = useState("");
  const [canonical, setCanonical] = useState("");

  function addAlias(event) {
    event.preventDefault();
    const nextAlias = alias.trim();
    const nextCanonical = canonical.trim();
    if (!nextAlias || !nextCanonical) return;
    const nextAliases = [
      ...aliases.filter((row) => row.alias !== nextAlias),
      { alias: nextAlias, canonical: nextCanonical },
    ];
    setAliases(nextAliases);
    writeStoredAliases(nextAliases);
    setAlias("");
    setCanonical("");
  }

  return (
    <SectionCard title={copy("settings.model_aliases.title")}>
      <form className="grid gap-3 py-3" onSubmit={addAlias}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-medium text-oai-gray-600 dark:text-oai-gray-300">
            <span>{copy("settings.model_aliases.alias_label")}</span>
            <input
              value={alias}
              onChange={(event) => setAlias(event.target.value)}
              className="vd-control h-10 rounded-md border border-oai-gray-300 bg-oai-white px-3 text-sm text-oai-black dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-oai-white"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-oai-gray-600 dark:text-oai-gray-300">
            <span>{copy("settings.model_aliases.canonical_label")}</span>
            <input
              value={canonical}
              onChange={(event) => setCanonical(event.target.value)}
              className="vd-control h-10 rounded-md border border-oai-gray-300 bg-oai-white px-3 text-sm text-oai-black dark:border-oai-gray-700 dark:bg-oai-gray-900 dark:text-oai-white"
            />
          </label>
        </div>
        <div>
          <button
            type="submit"
            className="rounded-md border border-oai-gray-300 px-3 py-2 text-sm font-medium text-oai-gray-700 transition-colors hover:bg-oai-gray-50 dark:border-oai-gray-700 dark:text-oai-gray-200 dark:hover:bg-oai-gray-800"
          >
            {copy("settings.model_aliases.add")}
          </button>
        </div>
        {aliases.length ? (
          <div className="grid gap-2 pt-1">
            {aliases.map((row) => (
              <div key={row.alias} className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium text-oai-black dark:text-white">{row.alias}</span>
                <span className="truncate text-oai-gray-500 dark:text-oai-gray-400">{row.canonical}</span>
              </div>
            ))}
          </div>
        ) : null}
      </form>
    </SectionCard>
  );
}

function ProviderAutoDetectSection() {
  const [providers, setProviders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function scanProviders() {
    setLoading(true);
    setError("");
    try {
      const payload = await getAutoDetectedProviders();
      const rows = Array.isArray(payload?.providers)
        ? payload.providers
        : Array.isArray(payload)
          ? payload
          : [];
      setProviders(rows);
    } catch (err) {
      setProviders([]);
      setError(err?.message || "Provider scan failed");
    } finally {
      setLoading(false);
    }
  }

  const sortedProviders = useMemo(
    () => [...providers].sort((left, right) => String(left?.displayName || left?.id || "").localeCompare(String(right?.displayName || right?.id || ""))),
    [providers],
  );

  return (
    <SectionCard
      title={copy("settings.provider_detect.title")}
      action={(
        <button
          type="button"
          onClick={scanProviders}
          disabled={loading}
          className="rounded-md border border-oai-gray-300 px-3 py-2 text-sm font-medium text-oai-gray-700 transition-colors hover:bg-oai-gray-50 disabled:opacity-60 dark:border-oai-gray-700 dark:text-oai-gray-200 dark:hover:bg-oai-gray-800"
        >
          {loading ? copy("settings.provider_detect.scanning") : copy("settings.provider_detect.scan")}
        </button>
      )}
    >
      <div className="grid gap-2 py-3">
        {error ? <p className="text-sm text-red-700 dark:text-red-300">{error}</p> : null}
        {sortedProviders.map((provider) => (
          <div key={provider?.id || provider?.displayName} className="flex items-center justify-between gap-3 text-sm">
            <span className="font-medium text-oai-black dark:text-white">
              {provider?.displayName || provider?.display_name || provider?.id || "Unknown"}
            </span>
            <span className="vd-chip rounded-md border border-[var(--glass-border)] px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-oai-gray-600 dark:text-oai-gray-300">
              {provider?.found ? copy("settings.provider_detect.found") : copy("settings.provider_detect.missing")}
            </span>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

export function SettingsPage() {
  const limitsPrefs = useLimitsDisplayPrefs();

  return (
    <div className="flex flex-1 flex-col font-oai text-oai-black antialiased dark:text-oai-white">
      <main className="flex-1 pb-12 pt-8 sm:pb-16 sm:pt-10">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="mb-8">
            <h1 className="text-3xl font-semibold tracking-tight text-oai-black dark:text-white sm:text-4xl">
              {copy("settings.page.title")}
            </h1>
            <p className="mt-2 text-sm text-oai-gray-500 dark:text-oai-gray-400">
              {copy("settings.page.subtitle")}
            </p>
          </div>

          <div className="space-y-4">
            <AppearanceSection />
            <MenuBarSection />
            <AccountSection />
            <SectionCard title={copy("settings.section.limits")}>
              <LimitsSettingsPanel prefs={limitsPrefs} />
            </SectionCard>
            <ModelAliasesSection />
            <ProviderAutoDetectSection />
          </div>

          <NativeAppFooter />
        </div>
      </main>
    </div>
  );
}
