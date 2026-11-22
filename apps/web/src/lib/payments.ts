/**
 * Pagamentos Pix (Fase 5) — regras PURAS de exibição e de consulta (testadas em scripts/unit.test.mjs).
 *
 * O navegador NUNCA decide que uma aula foi paga: ele só pergunta ao servidor, que confirma pelo
 * webhook autenticado da AbacatePay ou consultando o gateway. Valor, comissão e recebedor vêm da API.
 */

export type PaymentStatus = "pending" | "paid" | "expired" | "cancelled" | "refunded" | "under_dispute" | "failed";

/** Estados que não mudam mais sozinhos: a consulta periódica para. */
export const FINAL_STATUSES: ReadonlySet<PaymentStatus> = new Set(["paid", "expired", "cancelled", "refunded", "failed"]);

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  pending: "Aguardando Pix",
  paid: "Pago",
  expired: "Pix expirado",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
  under_dispute: "Em contestação",
  failed: "Falhou",
};

export const PAYMENT_STATUS_TONE: Record<PaymentStatus, "success" | "warning" | "danger" | "neutral" | "primary"> = {
  pending: "warning",
  paid: "success",
  expired: "neutral",
  cancelled: "neutral",
  refunded: "primary",
  under_dispute: "danger",
  failed: "danger",
};

/** Centavos inteiros → "R$ 80,00" (sem ponto flutuante na conta). */
export function formatBRL(cents: number): string {
  if (!Number.isInteger(cents)) throw new Error("Use centavos inteiros.");
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const reais = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}R$ ${reais},${String(abs % 100).padStart(2, "0")}`;
}

/** Segundos restantes até expirar (nunca negativo). */
export function secondsLeft(expiresAt: string, now = Date.now()): number {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
}

/** 754 → "12:34"; 3725 → "1:02:05". */
export function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/**
 * Intervalo da próxima consulta do pagamento (backoff): 3 s, 3 s, 5 s, 8 s, 13 s… até 20 s.
 * Para de consultar em estado final. O servidor ainda limita a conciliação a 1 a cada 5 s.
 */
export function pollDelay(status: PaymentStatus | undefined, attempt: number, hidden = false): number | false {
  if (status && FINAL_STATUSES.has(status)) return false;
  const steps = [3000, 3000, 5000, 8000, 13000];
  const base = steps[Math.min(Math.max(attempt, 0), steps.length - 1)] ?? 20000;
  const delay = attempt >= steps.length ? 20000 : base;
  // Aba em segundo plano: consulta bem menos (o webhook continua confirmando no servidor).
  return hidden ? Math.max(delay, 30000) : delay;
}
