/**
 * Regras puras do acesso por e-mail e senha (Supabase Auth).
 * Sem React, sem SDK, sem `window`. Testadas em scripts/unit.test.mjs.
 *
 * Princípios:
 * - Senhas só existem no estado do formulário e no corpo HTTPS enviado ao
 *   Supabase. Nunca em storage, URL ou log. O Supabase guarda apenas o hash.
 * - Mensagens não permitem descobrir se um e-mail tem conta: cadastro e
 *   recuperação sempre respondem de forma genérica; login errado não diz se
 *   o problema é o e-mail ou a senha.
 */

export const PASSWORD_MIN = 8;
/** Limite do bcrypt usado pelo Supabase (bytes). */
export const PASSWORD_MAX_BYTES = 72;
/** Intervalo mínimo entre reenvios de e-mail (reduz abuso; o Supabase também limita). */
export const RESEND_COOLDOWN_MS = 60_000;

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function emailIssue(value: string): string | null {
  const v = value.trim();
  if (!v) return "Informe seu e-mail.";
  if (v.length > 254 || !EMAIL_RE.test(v)) return "Confira o e-mail. Exemplo: nome@email.com";
  return null;
}

/** Regras para CRIAR ou TROCAR senha. No login, só se exige que não esteja vazia. */
export function newPasswordIssue(value: string): string | null {
  if (!value) return "Crie uma senha.";
  if (value.trim().length === 0) return "A senha não pode ter só espaços.";
  if ([...value].length < PASSWORD_MIN) return `Use pelo menos ${PASSWORD_MIN} caracteres.`;
  if (new TextEncoder().encode(value).length > PASSWORD_MAX_BYTES) return "Use uma senha mais curta (até 72 bytes).";
  return null;
}

export type EmailOp = "signin" | "signup" | "reset" | "update" | "resend" | "link";

export type EmailFailure =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "weak_password"
  | "same_password"
  | "rate_limited"
  | "not_available"
  | "link_invalid"
  | "network"
  | "unknown";

type ErrorLike = { message?: unknown; code?: unknown; status?: unknown; name?: unknown } | null | undefined;

/**
 * Classifica erros do Supabase. Para cadastro e recuperação, "e-mail já existe"
 * ou "usuário não encontrado" NÃO viram erro visível (resposta genérica).
 * Retorna null quando a operação deve ser tratada como sucesso genérico.
 */
export function classifyEmailError(error: ErrorLike, op: EmailOp): EmailFailure | null {
  if (!error) return null;
  const code = String(error.code ?? "").toLowerCase();
  const text = `${code} ${String(error.message ?? "")} ${String(error.name ?? "")}`.toLowerCase();

  if (error.status === 429 || /rate_limit|rate limit|too many/.test(text)) return "rate_limited";
  if (/retryable|failed to fetch|network/.test(text) || error.status === 0) return "network";

  if ((op === "signup" || op === "reset" || op === "resend") && /user_already_exists|already registered|email_exists|user_not_found|not found/.test(text)) {
    return null; // sem enumeração: resposta genérica de sucesso
  }
  if (op === "signin" && /invalid_credentials|invalid login credentials|user_not_found/.test(text)) return "invalid_credentials";
  if (/email_not_confirmed|email not confirmed/.test(text)) return op === "signin" ? "email_not_confirmed" : "unknown";
  if (/weak_password|password should|password is too/.test(text)) return "weak_password";
  if (/same_password|different from the old/.test(text)) return "same_password";
  if (/signup_disabled|email_provider_disabled|not allowed|hook|user_banned/.test(text)) return "not_available";
  if (op === "link" && /otp_expired|expired|invalid|flow_state|code_verifier|not found/.test(text)) return "link_invalid";
  return "unknown";
}

export const EMAIL_MESSAGES: Record<EmailFailure, string> = {
  invalid_credentials: "E-mail ou senha incorretos.",
  email_not_confirmed: "Confirme seu e-mail para entrar. Se não encontrou a mensagem, reenvie a confirmação.",
  weak_password: "Essa senha é fraca. Use uma combinação mais longa e difícil de adivinhar.",
  same_password: "A nova senha precisa ser diferente da anterior.",
  rate_limited: "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.",
  not_available: "O acesso por e-mail não está disponível para esta conta no momento.",
  link_invalid: "Este link expirou, já foi usado ou foi aberto em outro navegador. Solicite um novo.",
  network: "Sem conexão com o servidor de login. Verifique sua internet.",
  unknown: "Não foi possível concluir agora. Tente novamente em instantes.",
};

/** Mensagens genéricas (iguais existindo conta ou não). */
export const GENERIC_SENT = {
  signup: "Se este e-mail puder ser usado, você receberá uma mensagem para confirmar o endereço e ativar a conta.",
  reset: "Se houver uma conta com este e-mail, você receberá um link para criar uma nova senha.",
  resend: "Se houver um cadastro pendente, enviaremos uma nova mensagem de confirmação.",
} as const;

/** Rotas de retorno dos links enviados por e-mail (precisam estar na allowlist do Supabase). */
export const EMAIL_LINK_PATHS = {
  confirm: "/auth/confirmacao",
  recovery: "/auth/nova-senha",
} as const;

export type EmailLink = { kind: "code"; code: string } | { kind: "error"; failure: EmailFailure } | { kind: "none" };

/** Lê o retorno de um link de e-mail (PKCE: ?code=…; erros em ?error= ou #error=). */
export function parseEmailLink(search: string, hash: string): EmailLink {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const h = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const err = q.get("error") ?? h.get("error");
  if (err) {
    const code = q.get("error_code") ?? h.get("error_code") ?? err;
    return { kind: "error", failure: classifyEmailError({ code, message: q.get("error_description") ?? h.get("error_description") ?? "" }, "link") ?? "link_invalid" };
  }
  const code = q.get("code");
  if (code && /^[A-Za-z0-9._~-]{8,512}$/.test(code)) return { kind: "code", code };
  return { kind: "none" };
}
