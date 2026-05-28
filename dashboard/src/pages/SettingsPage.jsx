import React, { useMemo, useState } from "react";
import { LimitsSettingsPanel } from "../components/LimitsSettingsPanel.jsx";
import { AccountSection } from "../components/settings/AccountSection.jsx";
import { AppearanceSection } from "../components/settings/AppearanceSection.jsx";
import { SectionCard } from "../components/settings/Controls.jsx";
import { MenuBarSection, NativeAppFooter } from "../components/settings/MenuBarSection.jsx";
import { useLimitsDisplayPrefs } from "../hooks/use-limits-display-prefs.js";
import { getAutoDetectedProviders, getCurrencyRates } from "../lib/api";
import { copy } from "../lib/copy";
import { PageShell } from "../components/RevampSurfaces.jsx";

const MODEL_ALIASES_STORAGE_KEY = "vibedeck.modelAliases.v1";
const DISPLAY_CURRENCY_STORAGE_KEY = "vibedeck.displayCurrency";
const DISPLAY_CURRENCIES = ["USD", "EUR", "GBP", "JPY", "INR"];

function readStoredCurrency() {
  if (typeof window === "undefined" || !window.localStorage) return "USD";
  const value = String(window.localStorage.getItem(DISPLAY_CURRENCY_STORAGE_KEY) || "USD").toUpperCase();
  return DISPLAY_CURRENCIES.includes(value) ? value : "USD";
}

function writeStoredCurrency(currency) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(DISPLAY_CURRENCY_STORAGE_KEY, currency);
  } catch (_err) {
    // Local-only display preference is best effort.
  }
}

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
              className="vd-control h-10 rounded-md border border-[var(--vd-border)] bg-[var(--vd-control-bg)] px-3 text-sm text-oai-black focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vd-ring)] dark:text-oai-white"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium text-oai-gray-600 dark:text-oai-gray-300">
            <span>{copy("settings.model_aliases.canonical_label")}</span>
            <input
              value={canonical}
              onChange={(event) => setCanonical(event.target.value)}
              className="vd-control h-10 rounded-md border border-[var(--vd-border)] bg-[var(--vd-control-bg)] px-3 text-sm text-oai-black focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vd-ring)] dark:text-oai-white"
            />
          </label>
        </div>
        <div>
          <button
            type="submit"
            className="vd-control rounded-md border border-[var(--vd-border)] bg-[var(--vd-control-bg)] px-3 py-2 text-sm font-medium text-oai-gray-700 transition-colors hover:bg-[var(--vd-tint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vd-ring)] dark:text-oai-gray-200"
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
          className="vd-control rounded-md border border-[var(--vd-border)] bg-[var(--vd-control-bg)] px-3 py-2 text-sm font-medium text-oai-gray-700 transition-colors hover:bg-[var(--vd-tint)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vd-ring)] disabled:opacity-60 dark:text-oai-gray-200"
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

function DisplayCurrencySection() {
  const [currency, setCurrency] = useState(() => readStoredCurrency());

  function onCurrencyChange(event) {
    const nextCurrency = event.target.value;
    setCurrency(nextCurrency);
    writeStoredCurrency(nextCurrency);
    getCurrencyRates({ currency: nextCurrency }).catch(() => {});
  }

  return (
    <SectionCard title="Display currency">
      <div className="grid gap-3 py-3">
        <label className="grid gap-1 text-xs font-medium text-oai-gray-600 dark:text-oai-gray-300">
          <span>Display currency</span>
          <select
            value={currency}
            onChange={onCurrencyChange}
            className="vd-control h-10 rounded-md border border-[var(--vd-border)] bg-[var(--vd-control-bg)] px-3 text-sm text-oai-black focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vd-ring)] dark:text-oai-white"
          >
            {DISPLAY_CURRENCIES.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400">
          Display currency only. Exports keep USD cost columns.
        </p>
      </div>
    </SectionCard>
  );
}

export function SettingsPage() {
  const limitsPrefs = useLimitsDisplayPrefs();
  const navSections = [
    "Account",
    "Appearance",
    "Providers",
    "Menu Bar",
    "Advanced",
    "Privacy",
  ];

  return (
    <PageShell title={copy("settings.page.title")} subtitle={copy("settings.page.subtitle")}>
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-8 lg:self-start">
          <nav className="grid gap-1 border-l border-[var(--vd-border)] pl-3" aria-label="Settings sections">
            {navSections.map((section) => (
              <a
                key={section}
                href={`#settings-${section.toLowerCase().replace(/\s+/g, "-")}`}
                className="rounded-md px-2 py-2 text-sm font-medium text-oai-gray-600 transition-colors hover:bg-[var(--vd-tint)] hover:text-oai-black dark:text-oai-gray-300 dark:hover:text-white"
              >
                {section}
              </a>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 space-y-5">
          <section id="settings-account" className="scroll-mt-8">
            <AccountSection />
          </section>
          <section id="settings-appearance" className="scroll-mt-8">
            <AppearanceSection />
          </section>
          <section id="settings-providers" className="scroll-mt-8 space-y-4">
            <ProviderAutoDetectSection />
            <SectionCard title={copy("settings.section.limits")}>
              <LimitsSettingsPanel prefs={limitsPrefs} />
            </SectionCard>
          </section>
          <section id="settings-menu-bar" className="scroll-mt-8">
            <MenuBarSection />
          </section>
          <section id="settings-advanced" className="scroll-mt-8 space-y-4">
            <DisplayCurrencySection />
            <ModelAliasesSection />
          </section>
          <section id="settings-privacy" className="scroll-mt-8">
            <SectionCard title="Privacy">
              <p className="py-3 text-sm leading-6 text-oai-gray-500 dark:text-oai-gray-400">
                VibeDeck keeps usage data local by default. Exports and provider scans run from this machine.
              </p>
            </SectionCard>
          </section>
          <NativeAppFooter />
        </div>
      </div>
    </PageShell>
  );
}
