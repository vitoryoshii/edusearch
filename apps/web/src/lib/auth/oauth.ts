/**
 * Regras puras do login Google via Google Identity Services (GIS) + Supabase
 * (sem React, sem SDKs, sem `window`). Testadas em scripts/unit.test.mjs.
 *
 * Protocolo de nonce (documentado pelo Supabase para signInWithIdToken):
 *   1. o app gera um nonce ALEATÓRIO (Web Crypto, 256 bits);
 *   2. envia ao Google apenas o HASH SHA-256 em hexadecimal (`nonce` do GIS);
 *   3. o Google devolve um ID token cujo claim `nonce` é esse hash;
 *   4. o app envia ao Supabase o token + o nonce ORIGINAL; o Supabase calcula
 *      o hash e confere com o claim. Assim, um ID token capturado não pode ser
 *      reaproveitado sem o nonce original, que nunca sai da memória da aba.
 *
 * O ID token do Google nunca é gravado, registrado em log nem colocado em URL.
 */

/**
 * Escopos do login. O GIS (ID token) concede somente estes — não há como
 * pedir Google Agenda, Meet, Drive ou Gmail neste fluxo.
 */
export const GOOGLE_LOGIN_SCOPES = ["openid", "email", "profile"] as const;

/** Área da conta real (separada da demonstração). */
export const ACCOUNT_HOME = "/conta";

/** Validade de um nonce emitido (tempo máximo entre exibir o botão e concluir). */
export const NONCE_MAX_AGE_MS = 10 * 60 * 1000;

/** Emissores aceitos pelo Google para ID tokens. */
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

/** Normaliza o destino pós-login: só caminhos internos de /conta. */
export function sanitizeNext(next: unknown): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 200) return ACCOUNT_HOME;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return ACCOUNT_HOME;
  if (/[\u0000-\u001f\u007f]/.test(next) || /^\/[a-z][a-z0-9+.-]*:/i.test(next)) return ACCOUNT_HOME;
  const path = next.split(/[?#]/)[0] ?? "";
  if (path.split("/").some((seg) => seg === "..")) return ACCOUNT_HOME;
  return path === ACCOUNT_HOME || path.startsWith(`${ACCOUNT_HOME}/`) ? next : ACCOUNT_HOME;
}

/* --------------------------------- Nonce --------------------------------- */

type CryptoLike = Pick<Crypto, "getRandomValues"> & { subtle: Pick<SubtleCrypto, "digest"> };

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** SHA-256 em hexadecimal minúsculo (formato esperado pelo Supabase). */
export async function sha256Hex(value: string, cryptoImpl: CryptoLike = globalThis.crypto): Promise<string> {
  const digest = await cryptoImpl.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return toHex(new Uint8Array(digest));
}

export type NoncePair = { raw: string; hashed: string };

/** Nonce de 256 bits (base64url) e seu hash SHA-256 (hex). */
export async function createNonce(cryptoImpl: CryptoLike = globalThis.crypto): Promise<NoncePair> {
  const raw = toBase64Url(cryptoImpl.getRandomValues(new Uint8Array(32)));
  return { raw, hashed: await sha256Hex(raw, cryptoImpl) };
}

/**
 * Guarda os nonces emitidos SOMENTE em memória e entrega cada um uma única vez.
 * Indexado pelo hash (que volta no claim `nonce` do ID token).
 */
export class NonceVault {
  private readonly entries = new Map<string, { raw: string; issuedAt: number }>();
  private readonly maxAgeMs: number;

  constructor(maxAgeMs = NONCE_MAX_AGE_MS) {
    this.maxAgeMs = maxAgeMs;
  }

  remember(pair: NoncePair, now: number) {
    this.prune(now);
    this.entries.set(pair.hashed, { raw: pair.raw, issuedAt: now });
  }

  /** Devolve o nonce original e o invalida. `null` se desconhecido, expirado ou já usado. */
  consume(hashed: unknown, now: number): string | null {
    if (typeof hashed !== "string") return null;
    const entry = this.entries.get(hashed);
    this.entries.delete(hashed);
    this.prune(now);
    if (!entry || now - entry.issuedAt > this.maxAgeMs) return null;
    return entry.raw;
  }

  clear() {
    this.entries.clear();
  }

  get size() {
    return this.entries.size;
  }

  private prune(now: number) {
    for (const [k, v] of this.entries) if (now - v.issuedAt > this.maxAgeMs) this.entries.delete(k);
  }
}

/* ------------------------------ ID token (JWT) ------------------------------ */

export type GoogleIdClaims = {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
  nonce?: unknown;
  sub?: unknown;
};

/** Decodifica o payload do JWT SEM validar assinatura (quem valida é o Supabase). */
export function decodeJwtPayload(token: unknown): GoogleIdClaims | null {
  if (typeof token !== "string" || token.length > 8192) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return null;
  try {
    const b64 = parts[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4))) as unknown;
    return json && typeof json === "object" && !Array.isArray(json) ? (json as GoogleIdClaims) : null;
  } catch {
    return null;
  }
}

/**
 * Pré-verificação local da credencial recebida do GIS. NÃO é a fronteira de
 * segurança (o Supabase valida assinatura, emissor, público e nonce), mas
 * evita enviar ao servidor algo claramente inválido ou de outra tentativa.
 */
export function checkCredential(
  token: unknown,
  opts: { clientId: string; now: number },
): { ok: true; hashedNonce: string } | { ok: false; failure: "invalid_token" | "invalid_nonce" } {
  const claims = decodeJwtPayload(token);
  if (!claims) return { ok: false, failure: "invalid_token" };
  if (typeof claims.iss !== "string" || !GOOGLE_ISSUERS.has(claims.iss)) return { ok: false, failure: "invalid_token" };
  if (claims.aud !== opts.clientId) return { ok: false, failure: "invalid_token" };
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= opts.now) return { ok: false, failure: "invalid_token" };
  if (typeof claims.nonce !== "string" || !/^[0-9a-f]{64}$/.test(claims.nonce)) return { ok: false, failure: "invalid_nonce" };
  return { ok: true, hashedNonce: claims.nonce };
}

/* --------------------------------- Falhas --------------------------------- */

export type AuthFailure =
  | "invalid_token"
  | "invalid_nonce"
  | "not_allowed"
  | "network"
  | "gis_unavailable"
  | "provider_error"
  | "session_expired";

/** Classifica o erro devolvido pelo Supabase em signInWithIdToken. */
export function classifySupabaseError(error: { message?: unknown; code?: unknown; status?: unknown; name?: unknown } | null | undefined): AuthFailure {
  const text = `${String(error?.code ?? "")} ${String(error?.message ?? "")} ${String(error?.name ?? "")}`.toLowerCase();
  if (/nonce/.test(text)) return "invalid_nonce";
  if (/signup|not allowed|hook|user_banned|email_address_not_authorized/.test(text)) return "not_allowed";
  if (/fetch|network|retryable/.test(text) || error?.status === 0) return "network";
  if (/id token|id_token|bad_jwt|jwt|token|audience|issuer|expired/.test(text)) return "invalid_token";
  return "provider_error";
}

/** Mensagens em português (sem detalhes técnicos sensíveis). */
export const FAILURE_MESSAGES: Record<AuthFailure, { title: string; description: string }> = {
  invalid_token: {
    title: "Não foi possível validar sua conta Google",
    description: "A credencial recebida é inválida ou expirou. Tente entrar novamente.",
  },
  invalid_nonce: {
    title: "Login não confirmado por segurança",
    description: "Esta resposta não corresponde à tentativa de login desta página. Tente entrar novamente.",
  },
  not_allowed: {
    title: "Conta não liberada para testes",
    description: "O acesso real está restrito a usuários de teste autorizados. Você pode explorar a demonstração.",
  },
  network: {
    title: "Sem conexão com o servidor de login",
    description: "Verifique sua internet e tente novamente.",
  },
  gis_unavailable: {
    title: "Login do Google indisponível",
    description: "Não foi possível carregar o botão do Google. Verifique sua conexão ou bloqueadores e tente de novo.",
  },
  provider_error: {
    title: "Não foi possível concluir o login",
    description: "O serviço de login recusou a solicitação. Tente novamente em instantes.",
  },
  session_expired: {
    title: "Sua sessão expirou",
    description: "Por segurança, entre novamente com o Google.",
  },
};

/**
 * Remove tokens do provedor (Google) antes de persistir a sessão do Supabase.
 * No fluxo de ID token eles não costumam vir, mas a regra vale para qualquer fluxo.
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
