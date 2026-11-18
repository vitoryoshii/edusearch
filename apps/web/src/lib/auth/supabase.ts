import type { SupabaseClient, SupportedStorage } from "@supabase/supabase-js";
import { AUTH_CONFIG } from "./config";
import { stripProviderTokens } from "./oauth";

/**
 * Cliente Supabase centralizado (único no app).
 *
 * Carregado sob demanda (import dinâmico): quem só usa a demonstração não
 * baixa o SDK. Configuração:
 * - flowType "pkce": o código de autorização só vale junto do code_verifier
 *   guardado neste navegador.
 * - detectSessionInUrl false: a troca do código é feita explicitamente na
 *   rota /auth/callback, depois de validar a intenção de login (ver oauth.ts).
 * - storage: localStorage com remoção dos tokens do Google antes de gravar.
 */
let clientPromise: Promise<SupabaseClient> | null = null;

const safeStorage: SupportedStorage = {
  getItem: (key) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key, value) => {
    try {
      window.localStorage.setItem(key, stripProviderTokens(value));
    } catch {
      /* sem armazenamento: sessão só em memória */
    }
  },
  removeItem: (key) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignora */
    }
  },
};

export function getSupabase(): Promise<SupabaseClient> {
  if (!AUTH_CONFIG.enabled) return Promise.reject(new Error("Login real desabilitado neste ambiente."));
  clientPromise ??= import("@supabase/supabase-js").then(({ createClient }) =>
    createClient(AUTH_CONFIG.supabaseUrl, AUTH_CONFIG.publishableKey, {
      auth: {
        flowType: "pkce",
        detectSessionInUrl: false,
        persistSession: true,
        autoRefreshToken: true,
        storageKey: AUTH_CONFIG.storageKey,
        storage: safeStorage,
      },
    }),
  );
  return clientPromise;
}
