import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import type { Role } from "../lib/api/types";
import { DEMO_SESSION_KEY, DEMO_TEACHER_ID, DEMO_TEACHER_NAME, firstName } from "../lib/demo";
import { legacyRealPath } from "../lib/navigation";
import { persistenceEnabled } from "./account";
import { useAuth } from "./auth";

/**
 * Sessão de DEMONSTRAÇÃO (sem autenticação real).
 * Guarda somente o perfil escolhido e um nome de exibição no sessionStorage,
 * nunca senhas ou tokens. A autenticação real (Supabase Auth + Google) será
 * integrada pela API em fase futura.
 */
export type DemoSession = {
  role: Role;
  name: string;
  /** Na visão de professor: qual professor fictício está sendo visualizado. */
  teacherId?: string;
};

const KEY = DEMO_SESSION_KEY;

/** Sessão de aluno da demonstração (a aluna fictícia Ana, ou o nome do cadastro demonstrativo). */
export const studentSession = (name = "Ana"): DemoSession => ({ role: "student", name });

/** Sessão de professor da demonstração para um professor fictício (padrão: Profa. Marina). */
export const teacherSession = (t: { id: string; name: string } = { id: DEMO_TEACHER_ID, name: DEMO_TEACHER_NAME }): DemoSession => ({
  role: "teacher",
  name: firstName(t.name),
  teacherId: t.id,
});

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
  /**
   * Troca de perfil (aluno ⇄ professor) já indo para `to`.
   * Não use signIn + navigate para isso: o guard da área antiga redirecionaria
   * para a home do novo perfil antes da navegação assíncrona concluir.
   */
  switchRole: (s: DemoSession, to?: string) => void;
  /** Destino pendente de uma troca de perfil (lido pelo RequireRole). */
  nextPath: string | null;
  clearNextPath: () => void;
  signOut: () => void;
};

const SessionContext = createContext<Ctx | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<DemoSession | null>(read);
  const [pendingName, setPendingName] = useState<string | null>(null);
  const [nextPath, setNextPath] = useState<string | null>(null);

  const signIn = useCallback((s: DemoSession) => {
    setSession(s);
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* sem armazenamento: sessão só em memória */
    }
  }, []);

  const switchRole = useCallback(
    (s: DemoSession, to?: string) => {
      setNextPath(to ?? homeFor(s.role));
      signIn(s);
    },
    [signIn],
  );
  const clearNextPath = useCallback(() => setNextPath(null), []);

  const signOut = useCallback(() => {
    setSession(null);
    try {
      window.sessionStorage.removeItem(KEY);
    } catch {
      /* ignora */
    }
  }, []);

  const value = useMemo(
    () => ({ session, pendingName, setPendingName, signIn, switchRole, nextPath, clearNextPath, signOut }),
    [session, pendingName, signIn, switchRole, nextPath, clearNextPath, signOut],
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
  const { session, nextPath, clearNextPath } = useSession();
  const { status } = useAuth();
  const location = useLocation();
  const allowed = session?.role === role;
  const realAccount = status === "signedIn" && persistenceEnabled();

  // Chegou ao destino de uma troca de perfil: limpa o destino pendente.
  useEffect(() => {
    if (allowed && nextPath && location.pathname === nextPath) clearNextPath();
  }, [allowed, nextPath, location.pathname, clearNextPath]);

  if (!session) {
    // Conta real conectada, sem ter escolhido a demonstração: a URL antiga leva à tela real.
    if (realAccount) return <Navigate to={legacyRealPath(location.pathname)} replace />;
    return <Navigate to="/perfil-de-acesso" replace state={{ from: location.pathname }} />;
  }
  if (!allowed) return <Navigate to={nextPath?.startsWith(homeFor(session.role)) ? nextPath : homeFor(session.role)} replace />;
  return <>{children}</>;
}
