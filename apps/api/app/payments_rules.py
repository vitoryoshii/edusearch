"""Regra comercial (Fase 5): comissão de 15% em basis points e centavos inteiros (sem float).

Espelha EXATAMENTE a conta feita no banco (private.payment_create_hold) e no frontend
(apps/web/src/lib/commission.ts): arredondamento "meio para cima" = (valor × bps + 5000) ÷ 10000.
O banco é quem congela os valores na reserva; esta função serve para exibição e testes.
"""

from dataclasses import dataclass

COMMISSION_BPS = 1500  # 15% EduSearch; 85% professor. Tarifa do gateway é contabilizada à parte.


@dataclass(frozen=True)
class Split:
    amount_cents: int
    commission_cents: int
    teacher_share_cents: int


def split_amount(amount_cents: int, bps: int = COMMISSION_BPS) -> Split:
    if not isinstance(amount_cents, int) or isinstance(amount_cents, bool) or amount_cents < 0:
        raise ValueError("use centavos inteiros não negativos")
    commission = (amount_cents * bps + 5000) // 10000
    return Split(amount_cents, commission, amount_cents - commission)
