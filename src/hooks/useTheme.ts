import { useCallback, useEffect, useSyncExternalStore } from "react";

export type ThemePreference = "system" | "light" | "dark";

export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "writing-workshop:theme";

const CHANGE_EVENT = "writing-workshop:theme-change";

const readPreference = (): ThemePreference => {
  const stored = localStorage.getItem(STORAGE_KEY);

  return stored === "light" || stored === "dark" ? stored : "system";
};

const systemQuery = (): MediaQueryList => window.matchMedia("(prefers-color-scheme: dark)");

export const resolveTheme = (preference: ThemePreference): ResolvedTheme => {
  if (preference === "system") {
    return systemQuery().matches ? "dark" : "light";
  }

  return preference;
};

const subscribe = (onChange: () => void): (() => void) => {
  const query = systemQuery();
  query.addEventListener("change", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);

  return () => {
    query.removeEventListener("change", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
};

/**
 * Theme preference persisted in localStorage. "system" follows the OS
 * setting live. The resolved theme is applied as the `dark` class on
 * `<html>`, which the stylesheet keys on.
 */
export interface ThemeControls {
  readonly preference: ThemePreference;
  readonly resolved: ResolvedTheme;
  setPreference(next: ThemePreference): void;
}

export const useTheme = (): ThemeControls => {
  const preference = useSyncExternalStore(subscribe, readPreference);
  const resolved = useSyncExternalStore(subscribe, () => resolveTheme(preference));

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    if (next === "system") {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, next);
    }

    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return { preference, resolved, setPreference };
};
