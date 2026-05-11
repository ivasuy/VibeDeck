import { describe, expect, it } from "vitest";
import {
  EN_LOCALE,
  LOCALE_STORAGE_KEY,
  getInitialLocalePreference,
  normalizeLocalePreference,
  normalizeResolvedLocale,
  persistLocalePreference,
  resolvePreferredLocale,
} from "./locale";

describe("English-only locale", () => {
  it("normalizes every preference to English", () => {
    expect(normalizeLocalePreference("system")).toBe(EN_LOCALE);
    expect(normalizeLocalePreference("en")).toBe(EN_LOCALE);
    expect(normalizeLocalePreference("zh-CN")).toBe(EN_LOCALE);
    expect(normalizeLocalePreference(null)).toBe(EN_LOCALE);
  });

  it("resolves browser languages to English", () => {
    expect(resolvePreferredLocale("system", ["zh-CN"])).toBe(EN_LOCALE);
    expect(resolvePreferredLocale("en", ["zh-CN"])).toBe(EN_LOCALE);
    expect(normalizeResolvedLocale("zh-CN")).toBe(EN_LOCALE);
  });

  it("persists only English", () => {
    window.localStorage.clear();
    persistLocalePreference("zh-CN");
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe(EN_LOCALE);
    expect(getInitialLocalePreference()).toBe(EN_LOCALE);
  });
});
