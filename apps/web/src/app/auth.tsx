import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LoadingState } from "@edusearch/ui";
import { setAccessTokenProvider } from "../lib/api/client";
import { AUTH_CONFIG } from "../lib/auth/config";
import {
  GOOGLE_LOGIN_SCOPES,
  buildRedirectTo,
  createIntent,
  parseCallback,
  parseIntent,
  randomNonce,
  sanitizeNext,
  toIdentity,
  verifyIntent,
  type AccountIdentity,
  type AuthFailure,
} from "../lib/auth/oauth";
import { getSupabase } from "../lib/auth/supabase";

/**
 * Sessão AUTENTICADA (Supabase Auth + Google OAuth).
 *
 * Totalmente separada da sessão de demonstração (src/app/session.tsx):
 * - chaves de armazenamento diferentes;
 * - a área real (/conta) não lê nem grava dados fictícios;
 * - nada da demonstração é migrado para o Supabase.
 *
 * Autenticação ≠ autorização: este contexto só diz QUEM é o usuário. O que ele
 * pode fazer será decidido pela API FastAPI, que valida o JWT do Supabase.
 * Papel escolhido na tela e user_metadata NUNCA concedem permissão.
 */
export type AuthStatus = "disabled" | "loading" | "signedOut" | "signedIn";

type Ctx = {
  status: AuthStatus;
  identity: AccountIdentity | null;
  /** Inicia o OAuth com o Google (redireciona a página). */
  signInWithGoogle: (next?: string) => Promise<void>;
  /** Conclui o retorno do OAuth. Idempotente por código (StrictMode). */
  completeCallback: (search: string, hash: string) => Promise<{ ok: true; next: string } | { ok: false; failure: AuthFailure }>;
  signOut: () => Promise<void>;
};

const INTENT_KEY = "edusearch-auth-intent";
const AuthContext = createContext<Ctx | null>(null);

/** Há sessão real gravada? Evita baixar o SDK para quem nunca entrou. */
function hasStoredSession() {
  try {
    return window.localStorage.getItem(AUTH_CONFIG.storageKey) !== null;
  } catch {
    return false;
  }
}

// Em StrictMode o efeito do callback roda duas vezes: reaproveita a mesma troca.
const exchanges = new Map<string, Promise<{ ok: true; next: string } | { ok: false; failure: AuthFailure }>>();

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(() =>
    !AUTH_CONFIG.enabled ? "disabled" : hasStoredSession() ? "loading" : "signedOut",
  );
  const [identity, setIdentity] = useState<AccountIdentity | null>(null);
  const subscribed = useRef<SupabaseClient | null>(null);

  const apply = useCallback((user: Parameters<typeof toIdentity>[0] | null | undefined) => {
    if (user) {
      setIdentity(toIdentity(user));
      setStatus("signedIn");
    } else {
      setIdentity(null);
      setStatus("signedOut");
    }
  }, []);

  /** Carrega o cliente e assina as mudanças de sessão (uma única vez). */
  const client = useCallback(async () => {
    const sb = await getSupabase();
    if (subscribed.current !== sb) {
      subscribed.current = sb;
      sb.auth.onAuthStateChange((_event, session) => {
        // Não chamar outros métodos do Supabase aqui dentro (risco de deadlock do SDK).
        apply(session?.user);
      });
    }
    return sb;
  }, [apply]);

  // Restaura a sessão gravada.
  useEffect(() => {
    if (!AUTH_CONFIG.enabled || !hasStoredSession()) return;
    let active = true;
    (async () => {
      try {
        const sb = await client();
        const { data } = await sb.auth.getSession();
        if (!active) return;
        apply(data.session?.user);
        if (data.session) {
          // Confirma no servidor que o usuário ainda existe/é válido.
          const { error } = await sb.auth.getUser();
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

  // Disponibiliza o JWT para a futura API FastAPI (validação no servidor).
  useEffect(() => {
    if (status !== "signedIn") return;
    setAccessTokenProvider(async () => {
      const sb = await getSupabase();
      return (await sb.auth.getSession()).data.session?.access_token ?? null;
    });
    return () => setAccessTokenProvider(null);
  }, [status]);

  const signInWithGoogle = useCallback(
    async (next?: string) => {
      if (!AUTH_CONFIG.enabled) throw new Error("disabled");
      const sb = await client();
      const intent = createIntent(next, Date.now(), randomNonce());
      window.sessionStorage.setItem(INTENT_KEY, JSON.stringify(intent));
      const { error } = await sb.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: buildRedirectTo(window.location.origin, intent.nonce),
          scopes: GOOGLE_LOGIN_SCOPES.join(" "),
          // Sem access_type=offline: o app não precisa de refresh token do Google.
          queryParams: { prompt: "select_account" },
        },
      });
      if (error) {
        window.sessionStorage.removeItem(INTENT_KEY);
        throw error;
      }
    },
    [client],
  );

  const completeCallback = useCallback<Ctx["completeCallback"]>(
    (search, hash) => {
      const parsed = parseCallback(search, hash);
      const key = parsed.kind === "code" ? parsed.code : `${search}${hash}`;
      const existing = exchanges.get(key);
      if (existing) return existing;

      const run = (async () => {
        let rawIntent: string | null = null;
        try {
          rawIntent = window.sessionStorage.getItem(INTENT_KEY);
          window.sessionStorage.removeItem(INTENT_KEY); // uso único
        } catch {
          /* sem sessionStorage: a validação abaixo falha com invalid_state */
        }
        if (!AUTH_CONFIG.enabled) return { ok: false as const, failure: "disabled" as const };
        if (parsed.kind === "error") return { ok: false as const, failure: parsed.failure };

        const intent = parseIntent(rawIntent);
        const invalid = verifyIntent(intent, parsed.state, Date.now());
        if (invalid) return { ok: false as const, failure: invalid };

        try {
          const sb = await client();
          const { data, error } = await sb.auth.exchangeCodeForSession(parsed.code);
          if (error || !data.session) {
            const msg = `${error?.code ?? ""} ${error?.message ?? ""}`;
            if (/fetch|network/i.test(msg) && !error?.status) return { ok: false as const, failure: "network" as const };
            if (/signup|not allowed|hook/i.test(msg)) return { ok: false as const, failure: "not_allowed" as const };
            return { ok: false as const, failure: "exchange_failed" as const };
          }
          apply(data.session.user);
          return { ok: true as const, next: sanitizeNext(intent?.next) };
        } catch {
          return { ok: false as const, failure: "network" as const };
        }
      })();
      exchanges.set(key, run);
      return run;
    },
    [apply, client],
  );

  const signOut = useCallback(async () => {
    const userId = identity?.id;
    try {
      const sb = await client();
      // "local": encerra a sessão deste dispositivo e revoga o refresh token dele.
      await sb.auth.signOut({ scope: "local" });
    } catch {
      /* mesmo offline, limpamos o estado local */
      try {
        window.localStorage.removeItem(AUTH_CONFIG.storageKey);
      } catch {
        /* ignora */
      }
    }
    if (userId) clearRoleIntent(userId);
    apply(null);
  }, [apply, client, identity?.id]);

  const value = useMemo(
    () => ({ status, identity, signInWithGoogle, completeCallback, signOut }),
    [status, identity, signInWithGoogle, completeCallback, signOut],
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
    const next = encodeURIComponent(sanitizeNext(location.pathname));
    return <Navigate to={`/entrar?next=${next}`} replace />;
  }
  return <>{children}</>;
}

/* ---------------------- Papel pretendido (não é permissão) ---------------------- */

export type RoleIntent = "student" | "teacher";
const roleKey = (userId: string) => `edusearch-account-role:${userId}`;

/**
 * Papel ESCOLHIDO na tela, guardado só neste navegador até existir a API de
 * perfil. É uma preferência de interface: o backend decidirá o papel efetivo.
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
