import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "edusearch-theme";
const media = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

/** Lê a preferência salva (somente preferência visual, nada sensível). */
export function readThemePreference(): ThemePreference {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref !== "system") return pref;
  return media()?.matches ? "dark" : "light";
}

export function applyTheme(pref: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(pref);
  document.documentElement.dataset.theme = resolved;
  return resolved;
}

/**
 * Preferência de tema com persistência local e sincronização com o sistema.
 * `persist: false` apenas segue o sistema (usado no website).
 */
export function useTheme({ persist = true }: { persist?: boolean } = {}) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    persist ? readThemePreference() : "system",
  );
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(preference));

  useEffect(() => {
    setResolved(applyTheme(preference));
    if (preference !== "system") return;
    const mq = media();
    if (!mq) return;
    const onChange = () => setResolved(applyTheme("system"));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [preference]);

  const setPreference = useCallback(
    (pref: ThemePreference) => {
      setPreferenceState(pref);
      if (!persist) return;
      try {
        if (pref === "system") window.localStorage.removeItem(STORAGE_KEY);
        else window.localStorage.setItem(STORAGE_KEY, pref);
      } catch {
        /* armazenamento indisponível: mantém apenas em memória */
      }
    },
    [persist],
  );

  return { preference, resolved, setPreference };
}

/**
 * Script inline para o <head>, evita "flash" de tema errado antes do React montar.
 * Mantido em sincronia com STORAGE_KEY.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var p=localStorage.getItem("${STORAGE_KEY}")}catch(e){}var d=p==="dark"||(p!=="light"&&window.matchMedia&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light"})();`;
