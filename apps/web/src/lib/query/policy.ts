/**
 * Política de cache das consultas REAIS (Fase 4B). Pura (sem React); testada em
 * scripts/unit.test.mjs. Tudo fica SÓ EM MEMÓRIA: nada é persistido em disco, localStorage ou
 * Service Worker, e o cache privado é descartado no logout e na troca de conta.
 */

/** Por quanto tempo um dado é considerado "fresco" (sem revalidar ao voltar à tela). */
export const STALE_MS = {
  /** Catálogo oficial de disciplinas: muda raramente. */
  subjects: 30 * 60_000,
  /** Conta (papéis, status do cadastro, aprovação). */
  me: 60_000,
  /** Minhas aulas: volta à tela sem novo carregamento por 30 s; depois, revalida em segundo plano. */
  lessons: 30_000,
  /** Catálogo de professores (inclui "próximo horário"): curto. */
  catalog: 60_000,
  teacherProfile: 5 * 60_000,
  /**
   * Horários livres: NUNCA confiáveis por muito tempo. 15 s evita refazer a busca a cada clique; a
   * garantia contra reserva duplicada é do servidor (409 + EXCLUDE), não do cache.
   */
  slots: 15_000,
  calendar: 60_000,
  availability: 5 * 60_000,
  studentProfile: 5 * 60_000,
  /** Pagamento: quase sempre consultado de novo (o estado muda pelo webhook, no servidor). */
  payment: 1_000,
  payments: 15_000,
  paymentsStatus: 5 * 60_000,
  payoutAccount: 60_000,
} as const;

/** Quanto tempo um dado sem uso fica em memória antes de ser descartado. */
export const GC_MS = 10 * 60_000;

type ErrorLike = { status?: number; code?: string; serverCode?: string } | null | undefined;

/**
 * Tentar de novo só o que é transitório: rede, tempo limite, 5xx, 408 e 429 (até 2 vezes).
 * Nunca 401/403 (sessão/permissão), 404, 409 (conflito de negócio), 422 ou cancelamento.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  const e = error as ErrorLike;
  if (e?.code === "aborted") return false;
  const status = e?.status;
  if (typeof status === "number" && status < 500 && status !== 408 && status !== 429) return false;
  return failureCount < 2;
}

/** 1 s, 2 s, 4 s… (máximo 8 s). */
export const retryDelay = (attempt: number) => Math.min(1000 * 2 ** attempt, 8000);
