import type { SupabaseClient, SupportedStorage } from "@supabase/supabase-js";
import { AUTH_CONFIG } from "./config";
import { stripProviderTokens } from "./oauth";

/**
 * Cliente Supabase centralizado (único no app).
 *
 * Carregado sob demanda (import dinâmico): quem só usa a demonstração não
 * baixa o SDK. O login usa `signInWithIdToken` (ID token do Google Identity
 * Services), sem redirecionar o navegador para *.supabase.co.
 * - detectSessionInUrl false: o app não processa sessões vindas na URL
 *   automaticamente; os links de e-mail são tratados nas rotas /auth/*.
 * - flowType "pkce": links de confirmação e de nova senha trazem um código
 *   que só é trocado pela sessão no mesmo navegador que pediu o e-mail.
 * - autoRefreshToken: o JWT de acesso é renovado; se a renovação falhar, o
 *   SDK emite SIGNED_OUT e o app mostra "sessão expirada".
 * - storage: localStorage, removendo tokens de provedor antes de gravar.
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
  if (!AUTH_CONFIG.supabaseReady) return Promise.reject(new Error("Login real desabilitado neste ambiente."));
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
