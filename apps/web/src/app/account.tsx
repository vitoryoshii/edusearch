import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, LoadingState } from "@edusearch/ui";
import { accountApi, type AccountRole, type Me } from "../lib/api/account";
import { ApiError, describeError } from "../lib/api/client";
import type { AuthenticatedProfile } from "../lib/auth/profile";
import { FEATURES } from "../lib/features";
import { isForeignPrivateKey, queryKeys } from "../lib/query/keys";
import { STALE_MS } from "../lib/query/policy";
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
  const qc = useQueryClient();

  /*
   * Isolamento entre contas: toda chave privada leva o id da conta, então uma conta NUNCA lê o cache
   * de outra. Ao sair ou trocar de conta, o que não é da conta atual também sai da memória.
   */
  useEffect(() => {
    qc.removeQueries({ predicate: (q) => isForeignPrivateKey(q.queryKey, userId) });
  }, [qc, userId]);

  const me = useQuery({
    queryKey: queryKeys.me(userId ?? ""),
    queryFn: async ({ signal }) => {
      const data = await accountApi.me(signal);
      // Defesa extra: a resposta precisa ser do usuário da sessão atual.
      if (data.id !== userId) throw new ApiError("http", "Resposta de outra conta.", { status: 403 });
      return data;
    },
    enabled,
    staleTime: STALE_MS.me,
  });

  const reload = useCallback(() => void me.refetch(), [me]);
  const setMe = useCallback(
    (next: Me) => {
      if (next.id === userId) qc.setQueryData(queryKeys.me(next.id), next);
    },
    [qc, userId],
  );

  const value = useMemo<AccountState>(() => {
    if (!enabled) return { mode: "preview" };
    // Com dados em cache, a conta aparece na hora; erro só bloqueia sem dados — exceto 401 (sessão
    // expirada), que sempre bloqueia para não mostrar dados de uma sessão que já não vale.
    const expired = me.error instanceof ApiError && me.error.status === 401;
    const status = expired ? "error" : me.data ? "ready" : me.isError ? "error" : "loading";
    return { mode: "server", status, me: me.data ?? null, error: me.error, reload, setMe };
  }, [enabled, me.data, me.isError, me.error, reload, setMe]);

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
