import React, { createContext, useCallback, useLayoutEffect, useMemo } from "react";
import { setCopyLocale } from "../../lib/copy";
import { EN_LOCALE, persistLocalePreference } from "../../lib/locale";

export const LocaleContext = createContext(null);

export function LocaleProvider({ children }) {
  setCopyLocale(EN_LOCALE);

  useLayoutEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = EN_LOCALE;
  }, []);

  const setLocale = useCallback(() => {
    persistLocalePreference();
    setCopyLocale(EN_LOCALE);
  }, []);

  const contextValue = useMemo(
    () => ({ locale: EN_LOCALE, setLocale, resolvedLocale: EN_LOCALE }),
    [setLocale],
  );

  return <LocaleContext.Provider value={contextValue}>{children}</LocaleContext.Provider>;
}
