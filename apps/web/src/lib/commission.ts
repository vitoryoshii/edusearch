/**
 * Regra comercial OFICIAL (demonstração): comissão padrão do EduSearch = 15%.
 *
 * - Percentuais em basis points inteiros (1500 = 15%) e valores em centavos
 *   inteiros: nenhum cálculo usa ponto flutuante.
 * - Tarifas do gateway (AbacatePay) são contabilizadas SEPARADAMENTE.
 * - No sistema definitivo o cálculo oficial ocorre no backend (FastAPI) e é
 *   aplicado ao fluxo financeiro; o frontend apenas exibe. Este módulo é usado
 *   pelo adapter de demonstração e para conferência na interface.
 *
 * Histórico: até a Fase 2.2 a demonstração usava a hipótese de 10%.
 */
export const STANDARD_COMMISSION_BPS = 1500;

/** Arredondamento "meio para cima" em inteiros: (valor × bps + 5000) ÷ 10000. */
export function commissionOf(grossCents: number, bps = STANDARD_COMMISSION_BPS): number {
  if (!Number.isInteger(grossCents) || !Number.isInteger(bps)) throw new Error("Use centavos e basis points inteiros.");
  return Math.floor((grossCents * bps + 5000) / 10000);
}

/** Divide o valor da aula em comissão EduSearch e parcela bruta do professor (soma sempre exata). */
export function splitLessonAmount(grossCents: number, bps = STANDARD_COMMISSION_BPS) {
  const commissionCents = commissionOf(grossCents, bps);
  return { commissionCents, teacherShareCents: grossCents - commissionCents };
}

/** 1500 → "15%"; 1250 → "12,5%". */
export function formatBps(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  return frac ? `${whole},${String(frac).padStart(2, "0").replace(/0$/, "")}%` : `${whole}%`;
}
