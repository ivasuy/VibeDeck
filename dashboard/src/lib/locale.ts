import { safeGetItem, safeSetItem } from "./safe-browser";

export const LOCALE_STORAGE_KEY = "vibedeck-locale";
export const LOCALE_STORAGE_KEY_LEGACY = LOCALE_STORAGE_KEY.replace("vibedeck", "tokentracker");
export const EN_LOCALE = "en";

export function normalizeLocalePreference() {
  return EN_LOCALE;
}

export function normalizeResolvedLocale() {
  return EN_LOCALE;
}

export function resolvePreferredLocale() {
  return EN_LOCALE;
}

export function getInitialLocalePreference() {
  if (typeof window === "undefined") return EN_LOCALE;
  const stored = safeGetItem(LOCALE_STORAGE_KEY) || safeGetItem(LOCALE_STORAGE_KEY_LEGACY);
  if (stored !== EN_LOCALE) safeSetItem(LOCALE_STORAGE_KEY, EN_LOCALE);
  return EN_LOCALE;
}

export function persistLocalePreference() {
  return safeSetItem(LOCALE_STORAGE_KEY, EN_LOCALE);
}
