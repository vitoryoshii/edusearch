import { createContext, useContext, type ReactNode } from "react";
import { useTheme } from "@edusearch/ui";

type ThemeCtx = ReturnType<typeof useTheme>;
const ThemeContext = createContext<ThemeCtx | null>(null);

/** Uma única fonte de verdade para o tema (preferência salva + sistema). */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useAppTheme precisa estar dentro de <ThemeProvider>.");
  return ctx;
}
