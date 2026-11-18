import { ApiError } from "../api/client";

/**
 * Provedores de autenticação do app.
 *
 * Estado atual: NENHUM provedor real está integrado. Não há OAuth, tokens,
 * escopos nem chamadas ao Google. O acesso é feito pelo modo demonstração
 * (src/app/session.tsx).
 *
 * Integração futura (equipe responsável): Supabase Auth com Google OAuth.
 * Passos esperados:
 *   1. Implementar `signInWithGoogle` com o SDK do Supabase
 *      (`supabase.auth.signInWithOAuth({ provider: "google" })`).
 *   2. Marcar `google.available = true`.
 *   3. Registrar o JWT da sessão com `setAccessTokenProvider` (src/lib/api/client.ts)
 *      para que a API FastAPI valide as requisições.
 * Nenhuma chave secreta deve existir no frontend.
 */
export const AUTH_PROVIDERS = {
  google: {
    available: false,
    statusMessage: "O acesso com Google estará disponível após a integração.",
  },
} as const;

export async function signInWithGoogle(): Promise<never> {
  throw new ApiError("not_implemented", AUTH_PROVIDERS.google.statusMessage);
}
