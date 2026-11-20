import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, ErrorState, LoadingState } from "@edusearch/ui";
import { accountApi, type AccountRole, type Me } from "../lib/api/account";
import { ApiError, describeError } from "../lib/api/client";
import type { AuthenticatedProfile } from "../lib/auth/profile";
import { FEATURES } from "../lib/features";
import { useAuth } from "./auth";

/**
 * Estado da CONTA REAL vindo do servidor (Fase 2.6B).
 *
 * - "preview": persistência desligada (VITE_STAGE_PROFILE_PERSISTENCE=off, padrão). O
 *   onboarding continua como prévia sem envio e a escolha de papel é só uma preferência local.
 * - "server": papel, cadastro, nome e foto vêm de GET /v1/me. A interface NUNCA usa a
 *   preferência do localStorage como fonte de papel/autorização neste modo.
 *
 * Separado da demonstração: nada aqui lê ou grava dados fictícios.
 */
export type AccountState =
  | { mode: "preview" }
  | {
      mode: "server";
      status: "loading" | "error" | "ready";
      me: Me | null;
      error: unknown;
      reload: () => void;
      /** Substitui o Me após uma gravação bem-sucedida (resposta da API). */
      setMe: (me: Me) => void;
    };

const AccountContext = createContext<AccountState>({ mode: "preview" });

export const persistenceEnabled = () => FEATURES.profilePersistence !== "off";

export function AccountProvider({ children }: { children: ReactNode }) {
  const { status: authStatus, profile } = useAuth();
  const userId = authStatus === "signedIn" ? (profile?.id ?? null) : null;
  const enabled = persistenceEnabled() && userId !== null;

  const [state, setState] = useState<{ userId: string | null; status: "loading" | "error" | "ready"; me: Me | null; error: unknown }>({
    userId: null,
    status: "loading",
    me: null,
    error: null,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    setState({ userId, status: "loading", me: null, error: null });
    accountApi
      .me(controller.signal)
      .then((me) => {
        // Defesa extra: a resposta precisa ser do usuário da sessão atual.
        if (me.id !== userId) throw new ApiError("http", "Resposta de outra conta.", { status: 403 });
        setState({ userId, status: "ready", me, error: null });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setState({ userId, status: "error", me: null, error });
      });
    return () => controller.abort();
  }, [enabled, userId, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  const setMe = useCallback((me: Me) => setState((s) => (s.userId === me.id ? { ...s, status: "ready", me, error: null } : s)), []);

  const value = useMemo<AccountState>(() => {
    if (!enabled) return { mode: "preview" };
    // Troca de usuário: nunca exibe o Me da conta anterior.
    const current = state.userId === userId ? state : { status: "loading" as const, me: null, error: null };
    return { mode: "server", status: current.status, me: current.me, error: current.error, reload, setMe };
  }, [enabled, state, userId, reload, setMe]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  return useContext(AccountContext);
}

/** Me já carregado (use dentro de <RequireAccount> no modo servidor). */
export function useServerMe(): Me | null {
  const a = useAccount();
  return a.mode === "server" && a.status === "ready" ? a.me : null;
}

/** Papéis persistidos no servidor (modo servidor). */
export function hasRole(me: Me | null, role: AccountRole) {
  return Boolean(me?.roles.includes(role));
}

/**
 * Perfil para EXIBIÇÃO: no modo servidor, nome e foto salvos na API (avatar_url null = sem
 * foto, sem voltar à do Google); senão, os dados do Google (Supabase Auth).
 */
export function useDisplayProfile(): AuthenticatedProfile | null {
  const { profile } = useAuth();
  const me = useServerMe();
  return useMemo(() => {
    if (!profile) return null;
    if (!me) return profile;
    const avatar = me.avatar_url && /^https:\/\//.test(me.avatar_url) ? me.avatar_url : null;
    return { ...profile, displayName: me.display_name, avatarUrl: avatar };
  }, [profile, me]);
}

/** No modo servidor, só mostra a conta depois de GET /v1/me (carregando, erro e nova tentativa). */
export function RequireAccount({ children }: { children: ReactNode }) {
  const account = useAccount();
  const { signOut } = useAuth();
  if (account.mode === "preview" || account.status === "ready") return <>{children}</>;
  if (account.status === "loading") return <LoadingState label="Carregando sua conta…" className="min-h-[50dvh]" />;

  const unauthorized = account.error instanceof ApiError && account.error.status === 401;
  return (
    <div className="mx-auto max-w-lg py-10" data-testid="account-error">
      <ErrorState
        title={unauthorized ? "Sua sessão expirou" : "Não foi possível carregar sua conta"}
        description={describeError(account.error)}
        onRetry={unauthorized ? undefined : account.reload}
      />
      {unauthorized && (
        <div className="mt-4 flex justify-center">
          <Button onClick={() => void signOut()}>Entrar novamente</Button>
        </div>
      )}
    </div>
  );
}
