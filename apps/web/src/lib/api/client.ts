/**
 * Cliente HTTP centralizado para a API FastAPI do EduSearch.
 *
 * - Base em VITE_API_BASE_URL (variável pública; nunca coloque segredos aqui).
 * - Timeout, parse de JSON e erros normalizados em ApiError.
 * - O token de acesso (Supabase Auth) é injetado por `setAccessTokenProvider`
 *   (AuthProvider, com sessão real). Nunca o ID token do Google.
 * - Erros da API seguem { detail, code } (docs/api-contract.md): `serverCode` guarda o code.
 */

export const API_BASE_URL: string = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000").replace(/\/+$/, "");

export type ApiErrorCode =
  | "network"
  | "timeout"
  | "http"
  | "parse"
  | "not_implemented"
  | "aborted";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status?: number;
  readonly details?: unknown;
  /** Código estável da API (ex.: "role_required", "token_expired"), quando houver. */
  readonly serverCode?: string;

  constructor(code: ApiErrorCode, message: string, opts: { status?: number; details?: unknown; serverCode?: string } = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = opts.status;
    this.details = opts.details;
    this.serverCode = opts.serverCode;
  }
}

/** Mensagem em português para exibir ao usuário a partir de qualquer erro. */
export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "network":
        return "Não foi possível conectar ao servidor. Verifique sua conexão.";
      case "timeout":
        return "O servidor demorou para responder. Tente novamente.";
      case "not_implemented":
        return "Este recurso ainda não está disponível na API.";
      case "http":
        if (error.status === 401) return "Sua sessão expirou. Entre novamente.";
        // 403/404/422 da API trazem mensagem em português própria para o usuário.
        if (error.serverCode && error.status && error.status < 500 && error.message) return error.message;
        if (error.status === 403) return "Você não tem permissão para acessar este conteúdo.";
        if (error.status === 404) return "Conteúdo não encontrado.";
        if (error.status && error.status >= 500) return "O servidor encontrou um problema. Tente novamente em instantes.";
        return error.message;
      default:
        return error.message;
    }
  }
  return "Algo deu errado. Tente novamente.";
}

type TokenProvider = () => Promise<string | null> | string | null;
let accessTokenProvider: TokenProvider | null = null;

/** Ponto de extensão para a autenticação futura (ex.: sessão do Supabase). */
export function setAccessTokenProvider(provider: TokenProvider | null) {
  accessTokenProvider = provider;
}

export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
};

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, signal, timeoutMs = 15_000, headers = {} } = opts;

  const url = new URL(API_BASE_URL + (path.startsWith("/") ? path : `/${path}`));
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort("timeout"), timeoutMs);
  const onAbort = () => controller.abort("aborted");
  signal?.addEventListener("abort", onAbort);

  const finalHeaders: Record<string, string> = { Accept: "application/json", ...headers };
  if (body !== undefined) finalHeaders["Content-Type"] = "application/json";
  const token = accessTokenProvider ? await accessTokenProvider() : null;
  if (token) finalHeaders.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: finalHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      credentials: "omit",
    });
  } catch (err) {
    if (controller.signal.aborted) {
      const reason = controller.signal.reason;
      throw new ApiError(reason === "timeout" ? "timeout" : "aborted", "Requisição interrompida.");
    }
    throw new ApiError("network", err instanceof Error ? err.message : "Falha de rede.");
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }

  const text = await response.text();
  let data: unknown = undefined;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      if (response.ok) throw new ApiError("parse", "Resposta inválida do servidor.", { status: response.status });
    }
  }

  if (!response.ok) {
    // FastAPI retorna erros no formato { "detail": ... }.
    const detail = (data as { detail?: unknown } | undefined)?.detail;
    const serverCode = (data as { code?: unknown } | undefined)?.code;
    const message = typeof detail === "string" ? detail : `Erro ${response.status}`;
    throw new ApiError("http", message, {
      status: response.status,
      details: (data as { errors?: unknown } | undefined)?.errors ?? detail,
      serverCode: typeof serverCode === "string" ? serverCode : undefined,
    });
  }

  return data as T;
}
