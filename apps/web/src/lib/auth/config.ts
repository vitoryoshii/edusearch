/**
 * Configuração PÚBLICA da autenticação real (Google Identity Services + Supabase).
 *
 * Somente valores públicos, embutidos no bundle:
 * - VITE_SUPABASE_URL             URL do projeto
 * - VITE_SUPABASE_PUBLISHABLE_KEY chave publicável (sb_publishable_… ou anon)
 * - VITE_GOOGLE_CLIENT_ID         Client ID OAuth (Web) — público por natureza
 *
 * O login real só é ativado quando as três estão presentes e válidas. Sem elas
 * (padrão), o app continua 100% demonstração. Segredos são recusados:
 * service_role/sb_secret_ (Supabase) e GOCSPX-… (Client Secret do Google).
 */
const url = (import.meta.env.VITE_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
const publishableKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "").trim();
const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "").trim();

/** Chave secreta do Supabase (sb_secret_ ou JWT com role service_role)? */
export function looksSecretKey(key: string): boolean {
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

export const isGoogleClientId = (id: string) => /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(id);

const validUrl =
  /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url) || (import.meta.env.DEV && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(url));
const secret = (publishableKey !== "" && looksSecretKey(publishableKey)) || /^GOCSPX-/.test(googleClientId);

if (secret) {
  console.warn("[auth] Uma variável pública contém uma chave SECRETA. O login real foi desativado.");
}

const missing = [
  !validUrl && "VITE_SUPABASE_URL",
  !publishableKey && "VITE_SUPABASE_PUBLISHABLE_KEY",
  !isGoogleClientId(googleClientId) && "VITE_GOOGLE_CLIENT_ID",
].filter(Boolean) as string[];

export const AUTH_CONFIG = {
  supabaseUrl: url,
  publishableKey,
  googleClientId,
  /** Login real ativo neste build. */
  enabled: missing.length === 0 && !secret,
  /** Variáveis ausentes/inválidas (diagnóstico em desenvolvimento). */
  missing,
  /** Chave da sessão real (separada da sessão de demonstração). */
  storageKey: "edusearch-auth",
} as const;
