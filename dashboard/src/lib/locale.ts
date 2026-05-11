import { safeGetItem, safeSetItem } from "./safe-browser";

export const LOCALE_STORAGE_KEY = "vibedeck-locale";
export const LOCALE_STORAGE_KEY_LEGACY = "vibedeck-locale-legacy";
export const EN_LOCALE = "en";

export function normalizeLocalePreference(_value?: any) {
  return EN_LOCALE;
}

export function normalizeResolvedLocale(_value?: any) {
  return EN_LOCALE;
}

export function resolvePreferredLocale(_preferred?: any, _fallback?: any) {
  return EN_LOCALE;
}

export function getInitialLocalePreference() {
  if (typeof window === "undefined") return EN_LOCALE;
  const stored = safeGetItem(LOCALE_STORAGE_KEY) || safeGetItem(LOCALE_STORAGE_KEY_LEGACY);
  if (stored !== EN_LOCALE) safeSetItem(LOCALE_STORAGE_KEY, EN_LOCALE);
  return EN_LOCALE;
}

export function persistLocalePreference(_value?: any) {
  return safeSetItem(LOCALE_STORAGE_KEY, EN_LOCALE);
}
