import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import type { Role } from "../lib/api/types";

/**
 * Sessão de DEMONSTRAÇÃO (sem autenticação real).
 * Guarda somente o perfil escolhido e um nome de exibição no sessionStorage,
 * nunca senhas ou tokens. A autenticação real (Supabase Auth + Google) será
 * integrada pela API em fase futura.
 */
export type DemoSession = { role: Role; name: string };

const KEY = "edusearch-demo-session";

function read(): DemoSession | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<DemoSession>;
    return (v.role === "student" || v.role === "teacher") && typeof v.name === "string" ? (v as DemoSession) : null;
  } catch {
    return null;
  }
}

type Ctx = {
  session: DemoSession | null;
  pendingName: string | null;
  setPendingName: (name: string | null) => void;
  signIn: (s: DemoSession) => void;
  signOut: () => void;
};

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<DemoSession | null>(read);
  const [pendingName, setPendingName] = useState<string | null>(null);

  const signIn = useCallback((s: DemoSession) => {
    setSession(s);
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* sem armazenamento: sessão só em memória */
    }
  }, []);

  const signOut = useCallback(() => {
    setSession(null);
    try {
      window.sessionStorage.removeItem(KEY);
    } catch {
      /* ignora */
    }
  }, []);

  const value = useMemo(
    () => ({ session, pendingName, setPendingName, signIn, signOut }),
    [session, pendingName, signIn, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession precisa estar dentro de <SessionProvider>.");
  return ctx;
}

export const homeFor = (role: Role) => (role === "student" ? "/aluno" : "/professor");

/** Protege as áreas logadas; sem sessão, leva à escolha de perfil. */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { session } = useSession();
  const location = useLocation();
  if (!session) return <Navigate to="/perfil-de-acesso" replace state={{ from: location.pathname }} />;
  if (session.role !== role) return <Navigate to={homeFor(session.role)} replace />;
  return <>{children}</>;
}
