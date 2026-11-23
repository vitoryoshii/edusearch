import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { LoadingState } from "@edusearch/ui";
import { setAccessTokenProvider } from "../lib/api/client";
import { AUTH_CONFIG } from "../lib/auth/config";
import { EMAIL_LINK_PATHS, classifyEmailError, normalizeEmail, type EmailFailure, type EmailOp } from "../lib/auth/email";
import { disableGisAutoSelect } from "../lib/auth/gis";
import { NONCE_MAX_AGE_MS, NonceVault, checkCredential, classifySupabaseError, createNonce, sanitizeNext, type AuthFailure } from "../lib/auth/oauth";
import { toAuthenticatedProfile, toSessionInfo, type AuthenticatedProfile, type SessionInfo } from "../lib/auth/profile";
import { getSupabase } from "../lib/auth/supabase";
import { FEATURES } from "../lib/features";

/**
 * Sessão AUTENTICADA: Google Identity Services (ID token) + Supabase Auth,
 * e — quando o estágio permitir — e-mail e senha (Supabase Auth).
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
export type EmailResult = { ok: true } | { ok: false; failure: EmailFailure };

/** Acesso por e-mail (Supabase). Senhas só passam por aqui rumo ao SDK; nunca são guardadas. */
export type EmailAuthApi = {
  signIn: (email: string, password: string) => Promise<EmailResult>;
  /** Sempre "ok" genérico quando o e-mail já existe (sem enumeração). */
  signUp: (email: string, password: string) => Promise<EmailResult>;
  requestReset: (email: string) => Promise<EmailResult>;
  resendConfirmation: (email: string) => Promise<EmailResult>;
  /** Troca o código do link de e-mail (PKCE) pela sessão. */
  exchangeLink: (code: string) => Promise<EmailResult>;
  updatePassword: (password: string) => Promise<EmailResult>;
};

type Ctx = {
  status: AuthStatus;
  profile: AuthenticatedProfile | null;
  session: SessionInfo | null;
  /** Aviso pendente para a tela de login (ex.: sessão expirada). */
  notice: AuthFailure | null;
  /** Saída pedida pelo usuário (não expiração): as rotas protegidas não guardam o destino. */
  signedOutByUser: boolean;
  clearNotice: () => void;
  /** Gera (ou reaproveita) o nonce da tentativa atual e devolve o HASH para o GIS. */
  prepareNonce: () => Promise<string>;
  /** Troca a credencial do GIS por uma sessão do Supabase. */
  signInWithGoogleCredential: (credential: unknown) => Promise<SignInResult>;
  signOut: () => Promise<void>;
  email: EmailAuthApi;
};

const AuthContext = createContext<Ctx | null>(null);

// Nonces só em memória (nunca em storage). Um por tentativa, uso único.
const vault = new NonceVault();
let current: { hashed: string; issuedAt: number } | null = null;
let preparingNonce: Promise<{ hashed: string; issuedAt: number }> | null = null;

function hasStoredSession() {
  try {
    return window.localStorage.getItem(AUTH_CONFIG.storageKey) !== null;
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(() =>
    !FEATURES.realAuth ? "disabled" : hasStoredSession() ? "loading" : "signedOut",
  );
  const [profile, setProfile] = useState<AuthenticatedProfile | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [notice, setNotice] = useState<AuthFailure | null>(null);
  const [signedOutByUser, setSignedOutByUser] = useState(false);
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
    if (!FEATURES.realAuth || !hasStoredSession()) return;
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

  // JWT do SUPABASE (nunca o ID token do Google) para a API FastAPI.
  // Registrado UMA vez, na montagem: os efeitos dos filhos (ex.: AccountProvider buscando
  // /v1/me logo após o login) rodam antes dos efeitos deste provider, então o provedor precisa
  // já existir. Só devolve token com sessão ativa (signedInRef).
  useEffect(() => {
    if (!FEATURES.realAuth) return;
    setAccessTokenProvider(async () => {
      if (!signedInRef.current) return null;
      const sb = await getSupabase();
      return (await sb.auth.getSession()).data.session?.access_token ?? null;
    });
    return () => setAccessTokenProvider(null);
  }, []);

  const prepareNonce = useCallback(async () => {
    const now = Date.now();
    // StrictMode/remontagem: reaproveita o nonce ainda não usado da tentativa atual.
    if (current && now - current.issuedAt < NONCE_MAX_AGE_MS / 2) return current.hashed;
    // Duas montagens/efeitos concorrentes compartilham a MESMA tentativa.
    // Só o hash vai ao GIS; o valor original fica exclusivamente no cofre em memória.
    preparingNonce ??= createNonce().then((pair) => {
      const issuedAt = Date.now();
      vault.remember(pair, issuedAt);
      current = { hashed: pair.hashed, issuedAt };
      return current;
    });
    try {
      return (await preparingNonce).hashed;
    } finally {
      preparingNonce = null;
    }
  }, []);

  const signInWithGoogleCredential = useCallback(
    (credential: unknown): Promise<SignInResult> => {
      // Ignora credenciais duplicadas enquanto uma troca está em andamento.
      if (inflight.current) return inflight.current;
      const run = (async (): Promise<SignInResult> => {
        if (FEATURES.googleAuth === "off") return { ok: false, failure: "provider_error" };
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
          setSignedOutByUser(false);
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
    // Antes de qualquer mudança de estado: RequireAuth da tela atual não deve gravar `next`.
    setSignedOutByUser(true);
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
    preparingNonce = null;
    if (userId) clearRoleIntent(userId);
    apply(null);
  }, [apply, client, profile?.id]);

  const clearNotice = useCallback(() => setNotice(null), []);

  /* ------------------------------ E-mail e senha ------------------------------ */
  const runEmail = useCallback(
    async (
      op: EmailOp,
      call: (sb: SupabaseClient) => Promise<{ error: unknown; data?: unknown }>,
    ): Promise<EmailResult> => {
      if (FEATURES.emailAuth === "off" || (op === "signup" && FEATURES.emailSignup === "off")) return { ok: false, failure: "not_available" };
      try {
        const sb = await client();
        const { data, error } = await call(sb);
        const failure = classifyEmailError(error as never, op);
        if (failure) return { ok: false, failure };
        const session = (data as { session?: Session | null } | null | undefined)?.session;
        if (session) {
          setNotice(null);
          setSignedOutByUser(false);
          apply(session);
        }
        return { ok: true };
      } catch {
        return { ok: false, failure: "network" };
      }
    },
    [apply, client],
  );

  const email = useMemo<EmailAuthApi>(() => {
    const link = (path: string) => new URL(path, window.location.origin).toString();
    return {
      signIn: (address, password) => runEmail("signin", (sb) => sb.auth.signInWithPassword({ email: normalizeEmail(address), password })),
      signUp: (address, password) =>
        runEmail("signup", (sb) =>
          sb.auth.signUp({ email: normalizeEmail(address), password, options: { emailRedirectTo: link(EMAIL_LINK_PATHS.confirm) } }),
        ),
      requestReset: (address) =>
        runEmail("reset", (sb) => sb.auth.resetPasswordForEmail(normalizeEmail(address), { redirectTo: link(EMAIL_LINK_PATHS.recovery) })),
      resendConfirmation: (address) =>
        runEmail("resend", (sb) =>
          sb.auth.resend({ type: "signup", email: normalizeEmail(address), options: { emailRedirectTo: link(EMAIL_LINK_PATHS.confirm) } }),
        ),
      exchangeLink: (code) => runEmail("link", (sb) => sb.auth.exchangeCodeForSession(code)),
      updatePassword: (password) => runEmail("update", (sb) => sb.auth.updateUser({ password })),
    };
  }, [runEmail]);

  const value = useMemo(
    () => ({ status, profile, session, notice, signedOutByUser, clearNotice, prepareNonce, signInWithGoogleCredential, signOut, email }),
    [status, profile, session, notice, signedOutByUser, clearNotice, prepareNonce, signInWithGoogleCredential, signOut, email],
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
  const { status, signedOutByUser } = useAuth();
  const location = useLocation();
  if (status === "loading") return <LoadingState label="Verificando sua sessão…" className="min-h-dvh" />;
  if (status !== "signedIn") {
    // Saída voluntária: volta à entrada sem destino (o próximo login segue o fluxo normal).
    if (signedOutByUser) return <Navigate to="/" replace />;
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
