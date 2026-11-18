import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { LoadingState } from "@edusearch/ui";
import { setAccessTokenProvider } from "../lib/api/client";
import { AUTH_CONFIG } from "../lib/auth/config";
import { disableGisAutoSelect } from "../lib/auth/gis";
import { NONCE_MAX_AGE_MS, NonceVault, checkCredential, classifySupabaseError, createNonce, sanitizeNext, type AuthFailure } from "../lib/auth/oauth";
import { toAuthenticatedProfile, toSessionInfo, type AuthenticatedProfile, type SessionInfo } from "../lib/auth/profile";
import { getSupabase } from "../lib/auth/supabase";

/**
 * Sessão AUTENTICADA: Google Identity Services (ID token) + Supabase Auth.
 *
 * Totalmente separada da demonstração (src/app/session.tsx):
 * - chaves de armazenamento diferentes; nada da demonstração é migrado;
 * - a área real (/conta) não lê nem grava dados fictícios.
 *
 * Autenticação ≠ autorização: aqui só se sabe QUEM é o usuário. Permissões
 * virão da API (FastAPI), que valida o JWT do Supabase. Papel escolhido na tela
 * e user_metadata NUNCA concedem privilégios.
 */
export type AuthStatus = "disabled" | "loading" | "signedOut" | "signedIn";
export type SignInResult = { ok: true } | { ok: false; failure: AuthFailure };

type Ctx = {
  status: AuthStatus;
  profile: AuthenticatedProfile | null;
  session: SessionInfo | null;
  /** Aviso pendente para a tela de login (ex.: sessão expirada). */
  notice: AuthFailure | null;
  clearNotice: () => void;
  /** Gera (ou reaproveita) o nonce da tentativa atual e devolve o HASH para o GIS. */
  prepareNonce: () => Promise<string>;
  /** Troca a credencial do GIS por uma sessão do Supabase. */
  signInWithGoogleCredential: (credential: unknown) => Promise<SignInResult>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<Ctx | null>(null);

// Nonces só em memória (nunca em storage). Um por tentativa, uso único.
const vault = new NonceVault();
let current: { hashed: string; issuedAt: number } | null = null;

function hasStoredSession() {
  try {
    return window.localStorage.getItem(AUTH_CONFIG.storageKey) !== null;
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(() =>
    !AUTH_CONFIG.enabled ? "disabled" : hasStoredSession() ? "loading" : "signedOut",
  );
  const [profile, setProfile] = useState<AuthenticatedProfile | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [notice, setNotice] = useState<AuthFailure | null>(null);
  const subscribed = useRef<SupabaseClient | null>(null);
  const signedInRef = useRef(false);
  const leavingRef = useRef(false);
  const inflight = useRef<Promise<SignInResult> | null>(null);

  const apply = useCallback((s: Session | null | undefined) => {
    if (s?.user) {
      signedInRef.current = true;
      setProfile(toAuthenticatedProfile(s.user));
      setSession(toSessionInfo(s.user, s.expires_at));
      setStatus("signedIn");
    } else {
      signedInRef.current = false;
      setProfile(null);
      setSession(null);
      setStatus("signedOut");
    }
  }, []);

  /** Carrega o cliente e assina as mudanças de sessão (uma única vez). */
  const client = useCallback(async () => {
    const sb = await getSupabase();
    if (subscribed.current !== sb) {
      subscribed.current = sb;
      sb.auth.onAuthStateChange((event, s) => {
        // Não chamar métodos do Supabase aqui dentro (risco de deadlock do SDK).
        if (event === "SIGNED_OUT" && signedInRef.current && !leavingRef.current) setNotice("session_expired");
        apply(s);
      });
    }
    return sb;
  }, [apply]);

  // Restauração da sessão gravada (com confirmação no servidor).
  useEffect(() => {
    if (!AUTH_CONFIG.enabled || !hasStoredSession()) return;
    let active = true;
    (async () => {
      try {
        const sb = await client();
        const { data } = await sb.auth.getSession();
        if (!active) return;
        apply(data.session);
        if (data.session) {
          const { error } = await sb.auth.getUser();
          // Usuário removido/bloqueado ou sessão revogada: encerra localmente (gera "sessão expirada").
          if (active && error && (error.status === 401 || error.status === 403)) await sb.auth.signOut({ scope: "local" });
        }
      } catch {
        if (active) apply(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [apply, client]);

  // Estado da sessão (só o status, sem dados) para estilos e diagnóstico dos testes.
  useEffect(() => {
    document.documentElement.dataset.auth = status;
  }, [status]);

  // JWT do SUPABASE (nunca o ID token do Google) para a futura API FastAPI.
  useEffect(() => {
    if (status !== "signedIn") return;
    setAccessTokenProvider(async () => {
      const sb = await getSupabase();
      return (await sb.auth.getSession()).data.session?.access_token ?? null;
    });
    return () => setAccessTokenProvider(null);
  }, [status]);

  const prepareNonce = useCallback(async () => {
    const now = Date.now();
    // StrictMode/remontagem: reaproveita o nonce ainda não usado da tentativa atual.
    if (current && now - current.issuedAt < NONCE_MAX_AGE_MS / 2) return current.hashed;
    const pair = await createNonce();
    vault.remember(pair, now);
    current = { hashed: pair.hashed, issuedAt: now };
    return pair.hashed;
  }, []);

  const signInWithGoogleCredential = useCallback(
    (credential: unknown): Promise<SignInResult> => {
      // Ignora credenciais duplicadas enquanto uma troca está em andamento.
      if (inflight.current) return inflight.current;
      const run = (async (): Promise<SignInResult> => {
        if (!AUTH_CONFIG.enabled) return { ok: false, failure: "provider_error" };
        const now = Date.now();
        const checked = checkCredential(credential, { clientId: AUTH_CONFIG.googleClientId, now });
        if (!checked.ok) return { ok: false, failure: checked.failure };
        const rawNonce = vault.consume(checked.hashedNonce, now);
        if (current?.hashed === checked.hashedNonce) current = null; // a próxima tentativa recebe um novo nonce
        if (!rawNonce) return { ok: false, failure: "invalid_nonce" };
        try {
          const sb = await client();
          const { data, error } = await sb.auth.signInWithIdToken({ provider: "google", token: credential as string, nonce: rawNonce });
          if (error || !data.session) return { ok: false, failure: classifySupabaseError(error) };
          setNotice(null);
          apply(data.session);
          return { ok: true };
        } catch {
          // Exceção (não erro tratado do SDK): carregamento do SDK ou rede.
          return { ok: false, failure: "network" };
        }
      })();
      inflight.current = run;
      void run.finally(() => {
        inflight.current = null;
      });
      return run;
    },
    [apply, client],
  );

  const signOut = useCallback(async () => {
    const userId = profile?.id;
    leavingRef.current = true;
    try {
      const sb = await client();
      // "local": encerra a sessão deste dispositivo e revoga o refresh token dele.
      await sb.auth.signOut({ scope: "local" });
    } catch {
      try {
        window.localStorage.removeItem(AUTH_CONFIG.storageKey);
      } catch {
        /* ignora */
      }
    } finally {
      leavingRef.current = false;
    }
    disableGisAutoSelect();
    vault.clear();
    current = null;
    if (userId) clearRoleIntent(userId);
    apply(null);
  }, [apply, client, profile?.id]);

  const clearNotice = useCallback(() => setNotice(null), []);

  const value = useMemo(
    () => ({ status, profile, session, notice, clearNotice, prepareNonce, signInWithGoogleCredential, signOut }),
    [status, profile, session, notice, clearNotice, prepareNonce, signInWithGoogleCredential, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth precisa estar dentro de <AuthProvider>.");
  return ctx;
}

/** Protege rotas da conta REAL. A demonstração continua usando RequireRole. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") return <LoadingState label="Verificando sua sessão…" className="min-h-dvh" />;
  if (status !== "signedIn") {
    return <Navigate to={`/?next=${encodeURIComponent(sanitizeNext(location.pathname))}`} replace />;
  }
  return <>{children}</>;
}

/* ---------------------- Papel pretendido (não é permissão) ---------------------- */

export type RoleIntent = "student" | "teacher";
const roleKey = (userId: string) => `edusearch-account-role:${userId}`;

/**
 * Papel ESCOLHIDO na tela, guardado só neste navegador até existir a API de
 * perfil. Provisório: o backend decidirá o papel efetivo e as permissões.
 */
export function readRoleIntent(userId: string): RoleIntent | null {
  try {
    const v = window.localStorage.getItem(roleKey(userId));
    return v === "student" || v === "teacher" ? v : null;
  } catch {
    return null;
  }
}

export function writeRoleIntent(userId: string, role: RoleIntent) {
  try {
    window.localStorage.setItem(roleKey(userId), role);
  } catch {
    /* ignora */
  }
}

function clearRoleIntent(userId: string) {
  try {
    window.localStorage.removeItem(roleKey(userId));
  } catch {
    /* ignora */
  }
}
