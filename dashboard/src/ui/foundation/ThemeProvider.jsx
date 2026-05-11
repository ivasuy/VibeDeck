import React, { createContext, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  getCachedNativeSystemDark,
  isNativeEmbed,
  requestNativeSystemAppearance,
  subscribeNativeSystemAppearance,
  syncNativeChromeAppearance,
} from "../../lib/native-bridge.js";

const THEME_STORAGE_KEY = "vibedeck-theme";
const THEME_STORAGE_KEY_LEGACY = "vibedeck-theme-legacy";

/**
 * @typedef {"light" | "dark" | "system"} Theme
 * @typedef {{ theme: Theme, setTheme: (theme: Theme) => void, toggleTheme: () => void, resolvedTheme: "light" | "dark" }} ThemeContextValue
 */

/** @type {React.Context<ThemeContextValue | null>} */
export const ThemeContext = createContext(null);

/**
 * Get initial theme from localStorage or default to "system"
 * @returns {Theme}
 */
function getInitialTheme() {
  if (typeof window === "undefined") return "system";
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
      || localStorage.getItem(THEME_STORAGE_KEY_LEGACY);
    if (stored === "light" || stored === "dark" || stored === "system") {
      return stored;
    }
  } catch {
    // Ignore localStorage errors (e.g., private mode)
  }
  return "system";
}

/**
 * Get system preferred theme
 * @returns {"light" | "dark"}
 */
function getSystemTheme() {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Apply theme class to document element
 * @param {"light" | "dark"} resolvedTheme
 */
function applyThemeToDOM(resolvedTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (resolvedTheme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

/**
 * ThemeProvider - Manages theme state and syncs with DOM/localStorage
 * @param {{ children: React.ReactNode }} props
 */
export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(getInitialTheme);
  const [resolvedTheme, setResolvedTheme] = useState(() => {
    if (theme !== "system") return theme;
    if (isNativeEmbed()) {

      const cached = getCachedNativeSystemDark();
      if (typeof cached === "boolean") return cached ? "dark" : "light";
    }
    return getSystemTheme();
  });

  const themeRef = useRef(theme);
  useEffect(() => {
    themeRef.current = theme;
  }, [theme]);

  // Apply theme to DOM whenever resolvedTheme changes
  useEffect(() => {
    applyThemeToDOM(resolvedTheme);
  }, [resolvedTheme]);


  useLayoutEffect(() => {
    if (theme === "system") {
      if (isNativeEmbed()) {

        const cached = getCachedNativeSystemDark();
        if (typeof cached === "boolean") {
          setResolvedTheme(cached ? "dark" : "light");
        } else {

          setResolvedTheme(getSystemTheme());
        }

        requestNativeSystemAppearance();
        return;
      }
      setResolvedTheme(getSystemTheme());
    } else {
      setResolvedTheme(theme);
    }
  }, [theme]);


  useEffect(() => {
    if (!isNativeEmbed()) return;
    const unsubscribe = subscribeNativeSystemAppearance((isDark) => {
      if (themeRef.current === "system") {
        setResolvedTheme(isDark ? "dark" : "light");
      }
    });
    return unsubscribe;
  }, []);


  useEffect(() => {
    if (typeof window === "undefined") return;
    if (theme !== "system") return;
    if (isNativeEmbed()) return;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = (e) => {
      const newResolved = e.matches ? "dark" : "light";
      setResolvedTheme(newResolved);
    };

    // Modern API
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
    // Legacy API (older Safari)
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, [theme]);


  useEffect(() => {
    const forNative =
      theme === "system" && !isNativeEmbed() ? getSystemTheme() : resolvedTheme;
    syncNativeChromeAppearance(forNative, theme);
  }, [resolvedTheme, theme]);

  const setTheme = useCallback((newTheme) => {
    setThemeState(newTheme);
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, newTheme);
      } catch {
        // Ignore localStorage errors
      }
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem(THEME_STORAGE_KEY, next);
        } catch {
          // Ignore localStorage errors
        }
      }
      return next;
    });
  }, []);

  const contextValue = useMemo(
    () => ({
      theme,
      setTheme,
      toggleTheme,
      resolvedTheme,
    }),
    [theme, setTheme, toggleTheme, resolvedTheme]
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}
