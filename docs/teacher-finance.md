# Painel financeiro do professor — Fase 6.1/6.2

## Objetivo e limites

`GET /v1/me/teacher-finance?period=7d|30d|90d` oferece uma visão de leitura para o
professor autenticado. A API deriva a identidade exclusivamente do JWT e executa a consulta em
transação de usuário, sob as políticas RLS já aplicadas a `payment_intents`.

O painel não cria cobrança, split, saque, transferência ou reembolso. Em Sandbox, todas as cifras
exibidas são explicitamente simuladas. `teacher_share_cents` é a parcela atribuída pela regra da
aula paga; **não é saldo disponível, repasse confirmado ou valor sacável**.

## Contrato

```json
{
  "period": "30d",
  "environment": "sandbox",
  "commission_bps": 1500,
  "summary": {
    "gross_cents": 9000,
    "commission_cents": 1350,
    "teacher_share_cents": 7650,
    "gateway_fee_cents": 80,
    "paid_lessons": 1,
    "pending_lessons": 0,
    "cancelled_lessons": 0,
    "refunded_lessons": 0
  },
  "payout_account": { "status": "split_unavailable" },
  "payments": []
}
```

- Valores monetários são inteiros em centavos BRL.
- `commission_bps` é a regra vigente para novas aulas; cada cobrança preserva também sua regra
  congelada para uma futura evolução de faixas.
- `gross_cents`, comissão, parcela e tarifas somam somente `payment_intents.status = paid`.
- Cancelamentos incluem `cancelled`, `expired` e `failed`; reembolsos usam `refunded`.
- A conta de recebimentos é somente o estado já registrado. Não há formulário de repasse quando o
  split está desabilitado.
- Contas sem papel `teacher` recebem `403 role_required`; a rota não aceita `teacher_id`.

## Evolução prevista

Fase 6.3 poderá introduzir uma política versionada de comissão progressiva, com vigência e trilha
de auditoria. O painel continuará recebendo os valores congelados por cobrança, em vez de
recalcular histórico com uma regra nova.

Fase 6.4 poderá introduzir indicações qualificadas somente após definir elegibilidade, antifraude,
consentimento e auditoria. Por enquanto a UI informa “em desenvolvimento” e não cria metas,
créditos ou recompensas.
