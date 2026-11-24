# Financeiro V2

## Fontes de verdade

| Dado exibido | Fonte autorizada | Não representa |
|---|---|---|
| Bruto, comissão, parcela atribuída | `payment_intents`, via `GET /v1/me/teacher-finance` | saldo, saque ou recebimento |
| Saldo disponível e bloqueado | subconta AbacatePay, via `GET /v1/me/payout-balance` | estimativa das aulas |
| Histórico de saques | `withdrawal_requests`, via `GET /v1/me/withdrawals` | transferência concluída até webhook |

O professor é sempre derivado do JWT. O app não envia `teacher_id`, recebedor, comissão, valor
de repasse ou ambiente. Totais e histórico são isolados pelo ambiente ativo do servidor.

## Limites atuais

- O período do painel agregado segue `payment_intents.created_at` e suporta `7d`, `30d` e `90d`.
  Uma evolução para `paid_at`, mês atual/anterior ou intervalo personalizado exige contrato novo e
  não deve reinterpretar histórico silenciosamente.
- O extrato usa os pagamentos retornados pelo contrato atual; paginação/cursor ainda não existe.
- Saques reais continuam bloqueados por `API_SUBACCOUNT_WITHDRAWALS_ENABLED=false`.
- O status `pending` de saque não significa Pix concluído; somente webhook autenticado `transfer.completed` confirma o resultado.
