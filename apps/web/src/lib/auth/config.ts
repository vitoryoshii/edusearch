/**
 * Configuração PÚBLICA da autenticação real (Supabase Auth + Google).
 *
 * - Somente a URL do projeto e a chave PUBLICÁVEL (sb_publishable_… ou a
 *   antiga anon key). Nunca coloque service_role/secret keys no frontend.
 * - O login real só aparece com VITE_AUTH_GOOGLE_ENABLED=true. Sem a flag
 *   (padrão, inclusive na versão pública), o app continua 100% demonstração.
 */
const url = (import.meta.env.VITE_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
const publishableKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim();
const flag = import.meta.env.VITE_AUTH_GOOGLE_ENABLED === "true";

/** Recusa chaves secretas por engano (service_role JWT ou sb_secret_). */
function looksSecret(key: string): boolean {
  if (key.startsWith("sb_secret_")) return true;
  const payload = key.split(".")[1];
  if (!payload) return false;
  try {
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as { role?: string };
    return json.role === "service_role";
  } catch {
    return false;
  }
}

const validUrl = /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || (import.meta.env.DEV && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(url));
const secret = publishableKey !== "" && looksSecret(publishableKey);

if (secret) {
  // Falha visível em desenvolvimento; em produção o login real fica desligado.
  console.warn("[auth] VITE_SUPABASE_PUBLISHABLE_KEY parece uma chave SECRETA. O login real foi desativado.");
}

export const AUTH_CONFIG = {
  supabaseUrl: url,
  publishableKey,
  /** Login real habilitado e configurado corretamente. */
  enabled: flag && validUrl && publishableKey !== "" && !secret,
  /** Flag ligada, mas faltam variáveis (útil para mensagens de diagnóstico). */
  misconfigured: flag && (!validUrl || publishableKey === "" || secret),
  /** Chave de armazenamento da sessão real (separada da sessão de demonstração). */
  storageKey: "edusearch-auth",
} as const;
