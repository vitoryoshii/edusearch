// Lógica pura do acionamento do Trust Engine: sem dependências do runtime do Worker para ser
// testável com `node --test`. O Worker NÃO processa documentos nem acessa banco/Storage: apenas
// chama o endpoint interno da API, que faz todo o processamento sob RLS e leases.

export interface TrustCronEnv {
  EDUSEARCH_API_URL: string;
  TRUST_DISPATCH_SECRET: string;
}

export type DispatchSummary = Record<string, number>;

export type DispatchOutcome =
  | { ok: true; status: number; summary: DispatchSummary }
  | { ok: false; reason: string };

export const DISPATCH_PATH = "/v1/internal/trust/dispatch";
export const DEFAULT_TIMEOUT_MS = 25_000;
const MIN_SECRET_LENGTH = 32;

/** Valida a configuração antes de qualquer rede; nunca devolve o segredo. */
export function configError(env: Partial<TrustCronEnv>): string | null {
  if (!env.TRUST_DISPATCH_SECRET || env.TRUST_DISPATCH_SECRET.length < MIN_SECRET_LENGTH) {
    return "secret_missing_or_short";
  }
  let url: URL;
  try {
    url = new URL(env.EDUSEARCH_API_URL ?? "");
  } catch {
    return "api_url_invalid";
  }
  if (url.protocol !== "https:" || url.username || url.password) return "api_url_invalid";
  return null;
}

/** Apenas contadores inteiros conhecidos voltam para o log (nada de corpo bruto). */
export function sanitizeSummary(body: unknown): DispatchSummary {
  const out: DispatchSummary = {};
  if (!body || typeof body !== "object") return out;
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (/^[a-z_]{1,32}$/.test(key) && Number.isInteger(value)) out[key] = value as number;
  }
  return out;
}

export async function dispatchTrust(
  env: Partial<TrustCronEnv>,
  fetcher: typeof fetch = fetch,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<DispatchOutcome> {
  const invalid = configError(env);
  if (invalid) return { ok: false, reason: invalid };
  const base = new URL(env.EDUSEARCH_API_URL as string);
  const target = new URL(DISPATCH_PATH, base);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(target.toString(), {
      method: "POST",
      headers: { "X-Trust-Dispatch-Secret": env.TRUST_DISPATCH_SECRET as string },
      redirect: "manual",
      signal: controller.signal,
    });
    if (!response.ok) return { ok: false, reason: `http_${response.status}` };
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      return { ok: false, reason: "invalid_json" };
    }
    return { ok: true, status: response.status, summary: sanitizeSummary(body) };
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown";
    return { ok: false, reason: name === "AbortError" ? "timeout" : "network_error" };
  } finally {
    clearTimeout(timer);
  }
}

/** Guarda por isolate: um disparo não começa enquanto o anterior do mesmo isolate não terminou. */
export function createSingleFlight<T>(run: () => Promise<T>): () => Promise<T | "skipped"> {
  let running = false;
  return async () => {
    if (running) return "skipped";
    running = true;
    try {
      return await run();
    } finally {
      running = false;
    }
  };
}
