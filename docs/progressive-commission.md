# Comissão progressiva — Fase 6.3

## Estado operacional

A Fase 6.3 cria a base auditável para comissão progressiva, mas **não ativa redução de comissão**.
Nos ambientes Sandbox e Production, a única política efetiva é `v1`, com uma única faixa de
`1500` basis points (15%). O piso técnico é `1000` bps (10%); nenhuma faixa consegue ficar abaixo
dele por restrição do banco.

`demo-v2` contém faixas somente como fixture de homologação (15%, 14%, 12,5% e 10%) e permanece
inativa. Não existe endpoint de administração nesta fase: qualquer futura ativação precisa ser uma
operação privilegiada, versionada e registrada em `private.commission_policy_audit_log`.

## Fonte de verdade e congelamento

- A política, a faixa e a taxa são escolhidas dentro de `private.payment_create_hold`; o frontend
  não envia taxa, política, faixa ou critério.
- `payment_intents.commission_policy_version`, `commission_bps`, `commission_cents` e
  `teacher_share_cents` são snapshots imutáveis da cobrança. Alterar uma política não recalcula
  cobranças históricas.
- A elegibilidade usa somente `payment_intents.status = 'paid'`, do mesmo professor e ambiente,
  dentro da janela `evaluation_days`, com base em `created_at`. Cancelamentos, falhas, expirações e
  reembolsos não contam; uma reserva possui uma única cobrança e não duplica a métrica.
- Sandbox e Production são filtrados pelo processo do servidor. Nem ambiente nem `teacher_id` são
  aceitos pelo endpoint.

## API

`GET /v1/me/commission-progress` exige JWT e o papel persistido `teacher`. Devolve a política ativa,
taxa vigente, contagem de aulas elegíveis, próxima faixa (quando existir) e período de avaliação.
O backend executa a leitura com as claims do JWT e a função privada também valida o `sub`, evitando
leitura de outro professor mesmo em caso de erro de chamada interna.

Exemplo de resposta enquanto somente a política `v1` estiver ativa:

```json
{
  "environment": "sandbox",
  "policy_version": "v1",
  "progression_active": false,
  "current_level": 0,
  "current_rate_bps": 1500,
  "next_rate_bps": null,
  "eligible_paid_lessons": 0,
  "next_level_paid_lessons": null,
  "lessons_remaining": null,
  "evaluation_days": 90,
  "eligibility": "no_next_level",
  "simulation_amount_cents": 10000,
  "simulation_commission_cents": 1500,
  "simulation_teacher_share_cents": 8500
}
```

Os três campos `simulation_*` são um exemplo educativo calculado pelo backend a partir da taxa
vigente; o frontend não replica a fórmula de comissão. Eles não representam saldo, repasse ou
ganho prometido.

O retorno é informativo: não representa saldo, promessa de redução, crédito, split, repasse ou saque.
No Sandbox, toda a interface identifica as cifras como simuladas.

## Evolução pendente de aprovação

Antes de ativar qualquer faixa real é necessário aprovar formalmente: metas, janela, tratamento de
estornos após pagamento, data de referência (`created_at` versus `paid_at`), governança do ator
administrativo e comunicação ao professor. Uma mudança deve criar uma nova versão; nunca editar a
política que já foi aplicada a cobranças.
