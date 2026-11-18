/**
 * Regras puras do fluxo OAuth (sem React, sem Supabase, sem `window`).
 * Testadas em scripts/unit.test.mjs.
 *
 * Segurança:
 * - O destino pós-login (`next`) é sempre um caminho RELATIVO da própria
 *   origem e dentro de uma lista de prefixos permitidos (evita open redirect).
 * - Antes de ir ao Google, o app grava uma "intenção" com um valor aleatório
 *   (`nonce`) e o horário. O callback só troca o código pela sessão se essa
 *   intenção existir, for recente e coincidir com o `nonce` devolvido na URL
 *   de retorno. Isso complementa o PKCE do Supabase (code_verifier), que já
 *   impede que um código interceptado seja trocado em outro navegador.
 * - Os tokens do provedor (Google) nunca são persistidos no navegador.
 */

/** Escopos básicos de login. NÃO incluir Google Agenda neste fluxo. */
export const GOOGLE_LOGIN_SCOPES = ["openid", "email", "profile"] as const;

/** Rota de retorno do OAuth (precisa estar na allowlist de Redirect URLs do Supabase). */
export const AUTH_CALLBACK_PATH = "/auth/callback";

/** Área da conta real (separada da demonstração). */
export const ACCOUNT_HOME = "/conta";

/** Prefixos aceitos como destino após o login real. */
const ALLOWED_NEXT_PREFIXES = [ACCOUNT_HOME];

/** Validade da intenção de login (ida e volta ao Google). */
export const INTENT_MAX_AGE_MS = 10 * 60 * 1000;

/** Normaliza o destino pós-login. Qualquer valor suspeito vira ACCOUNT_HOME. */
export function sanitizeNext(next: unknown): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 200) return ACCOUNT_HOME;
  // Só caminhos absolutos da própria origem: "/x", nunca "//host", "/\host", "http:" etc.
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return ACCOUNT_HOME;
  // Sem caracteres de controle e sem esquemas embutidos.
  if (/[\u0000-\u001f\u007f]/.test(next) || /^\/[a-z][a-z0-9+.-]*:/i.test(next)) return ACCOUNT_HOME;
  const path = next.split(/[?#]/)[0] ?? "";
  if (path.split("/").some((seg) => seg === "..")) return ACCOUNT_HOME;
  const allowed = ALLOWED_NEXT_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
  return allowed ? next : ACCOUNT_HOME;
}

export type LoginIntent = { nonce: string; next: string; createdAt: number };

/** Gera um valor aleatório URL-safe (16 bytes). */
export function randomNonce(cryptoImpl: Pick<Crypto, "getRandomValues"> = globalThis.crypto): string {
  const bytes = cryptoImpl.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function createIntent(next: unknown, now: number, nonce: string): LoginIntent {
  return { nonce, next: sanitizeNext(next), createdAt: now };
}

/** Lê a intenção gravada (JSON) com validação de forma. */
export function parseIntent(raw: string | null): LoginIntent | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<LoginIntent>;
    if (typeof v.nonce !== "string" || !/^[0-9a-f]{32}$/.test(v.nonce)) return null;
    if (typeof v.createdAt !== "number" || !Number.isFinite(v.createdAt)) return null;
    return { nonce: v.nonce, next: sanitizeNext(v.next), createdAt: v.createdAt };
  } catch {
    return null;
  }
}

/** URL absoluta de retorno, com o nonce da intenção. */
export function buildRedirectTo(origin: string, nonce: string): string {
  const url = new URL(AUTH_CALLBACK_PATH, origin);
  url.searchParams.set("s", nonce);
  return url.toString();
}

/** Códigos de falha exibidos na tela de callback/login. */
export type AuthFailure =
  | "access_denied"
  | "provider_error"
  | "missing_code"
  | "invalid_state"
  | "expired_state"
  | "exchange_failed"
  | "not_allowed"
  | "disabled"
  | "network";

export type CallbackParams =
  | { kind: "code"; code: string; state: string | null }
  | { kind: "error"; failure: AuthFailure; detail: string | null };

/**
 * Interpreta a URL de retorno. Erros podem vir na query (`?error=`) ou no
 * fragmento (`#error=`), dependendo do ponto em que o fluxo falhou.
 */
export function parseCallback(search: string, hash: string): CallbackParams {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const h = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const error = q.get("error") ?? h.get("error");
  if (error) {
    const description = q.get("error_description") ?? h.get("error_description");
    const code = q.get("error_code") ?? h.get("error_code");
    return { kind: "error", failure: classifyProviderError(error, code, description), detail: description?.slice(0, 300) ?? null };
  }
  const code = q.get("code");
  if (!code || !/^[A-Za-z0-9._~-]{8,512}$/.test(code)) return { kind: "error", failure: "missing_code", detail: null };
  return { kind: "code", code, state: q.get("s") };
}

function classifyProviderError(error: string, code: string | null, description: string | null): AuthFailure {
  if (error === "access_denied" && !/signup|not allowed|hook/i.test(`${code ?? ""} ${description ?? ""}`)) return "access_denied";
  if (/signup_disabled|user_not_allowed|not allowed|hook/i.test(`${code ?? ""} ${description ?? ""}`)) return "not_allowed";
  return "provider_error";
}

/** Confere a intenção gravada contra o `s` devolvido na URL. */
export function verifyIntent(intent: LoginIntent | null, state: string | null, now: number): AuthFailure | null {
  if (!intent || !state || intent.nonce !== state) return "invalid_state";
  if (now - intent.createdAt > INTENT_MAX_AGE_MS || now < intent.createdAt - 60_000) return "expired_state";
  return null;
}

/** Mensagens em português para cada falha (sem detalhes técnicos sensíveis). */
export const FAILURE_MESSAGES: Record<AuthFailure, { title: string; description: string }> = {
  access_denied: {
    title: "Acesso cancelado",
    description: "Você cancelou o login com o Google. Nenhum dado foi compartilhado.",
  },
  provider_error: {
    title: "O Google não concluiu o login",
    description: "O provedor recusou ou interrompeu o acesso. Tente novamente em instantes.",
  },
  missing_code: {
    title: "Retorno de login incompleto",
    description: "Não recebemos o código de autorização. Inicie o login novamente pelo botão do Google.",
  },
  invalid_state: {
    title: "Não foi possível validar este login",
    description:
      "Este retorno não corresponde a um login iniciado neste navegador. Por segurança, inicie o login novamente.",
  },
  expired_state: {
    title: "O login expirou",
    description: "Demorou mais de 10 minutos para concluir. Inicie o login novamente.",
  },
  exchange_failed: {
    title: "Não foi possível concluir o login",
    description: "O código de autorização é inválido ou já foi usado. Inicie o login novamente.",
  },
  not_allowed: {
    title: "Conta não liberada para testes",
    description:
      "O cadastro real está restrito a usuários de teste autorizados. Use a demonstração ou fale com a equipe EduSearch.",
  },
  disabled: {
    title: "Login real indisponível",
    description: "O login com Google ainda não está habilitado neste ambiente. Você pode explorar a demonstração.",
  },
  network: {
    title: "Sem conexão com o servidor de login",
    description: "Verifique sua conexão e tente novamente.",
  },
};

/**
 * Remove tokens do provedor (Google) antes de persistir a sessão.
 * O Supabase inclui `provider_token`/`provider_refresh_token` na sessão logo
 * após o OAuth; o app não precisa deles (Google Agenda será via backend).
 */
export function stripProviderTokens(serialized: string): string {
  try {
    const v = JSON.parse(serialized) as Record<string, unknown> | null;
    if (!v || typeof v !== "object" || Array.isArray(v)) return serialized;
    if (!("provider_token" in v) && !("provider_refresh_token" in v)) return serialized;
    const { provider_token: _a, provider_refresh_token: _b, ...rest } = v;
    return JSON.stringify(rest);
  } catch {
    return serialized;
  }
}

/** Dados básicos exibidos na conta (somente exibição — nunca usados para autorização). */
export type AccountIdentity = {
  id: string;
  email: string | null;
  name: string;
  avatarUrl: string | null;
  provider: string;
  emailVerified: boolean;
};

type UserLike = {
  id: string;
  email?: string | null;
  email_confirmed_at?: string | null;
  app_metadata?: { provider?: unknown } | null;
  user_metadata?: Record<string, unknown> | null;
};

/** Converte o usuário do Supabase em dados de exibição. */
export function toIdentity(user: UserLike): AccountIdentity {
  const meta = user.user_metadata ?? {};
  const str = (k: string) => (typeof meta[k] === "string" && (meta[k] as string).trim() ? (meta[k] as string).trim() : null);
  const email = user.email ?? str("email");
  const name = str("full_name") ?? str("name") ?? (email ? email.split("@")[0]! : "Usuário");
  const avatar = str("avatar_url") ?? str("picture");
  return {
    id: user.id,
    email,
    name: name.slice(0, 80),
    // Só aceita fotos servidas por HTTPS do Google (evita URLs arbitrárias no <img>).
    avatarUrl: avatar && /^https:\/\/[a-z0-9-]+\.googleusercontent\.com\//i.test(avatar) ? avatar : null,
    provider: typeof user.app_metadata?.provider === "string" ? user.app_metadata.provider : "desconhecido",
    emailVerified: Boolean(user.email_confirmed_at),
  };
}
