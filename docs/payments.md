# Pagamentos Pix — AbacatePay API v2 (Fase 5)

Estado: **sandbox** (Modo Teste da AbacatePay). Nenhuma cobrança real, nenhum repasse real.
Produção depende de aprovação operacional, jurídica e financeira (ver "Checklist para produção").

## Escopo

- Aula paga: o aluno reserva → o horário fica **aguardando pagamento** com prazo → Pix (QR + copia e
  cola + contagem) → o **servidor** confirma (webhook autenticado ou conciliação) → aula agendada e
  evento com Google Meet → o app mostra o novo estado.
- Valor = `teacher_profiles.price_cents` (por aula, qualquer duração — regra do cadastro do
  professor; **validar com o negócio**). Comissão 15% / professor 85%, em centavos inteiros,
  **congelados na reserva**. Tarifa do gateway (`platformFee`) registrada à parte.
- Split para a subconta do professor (`data.splits`) **só quando habilitado** na conta pela
  AbacatePay. Sem habilitação: `split_status = unavailable` e nenhum repasse é simulado.
- Reembolsos: registrados como **solicitações** (`refund_requests`) para a operação executar.
  Não há reembolso automático.
- Aulas de teste do piloto (Fase 3A) continuam iguais (`is_test = true`, sem cobrança).

## Contrato da AbacatePay usado (conferido na documentação v2)

| Uso | Chamada |
|---|---|
| Criar Pix | `POST https://api.abacatepay.com/v2/transparents/create` `{"method":"PIX","data":{amount, description, expiresIn, externalId, metadata, splits?}}` |
| Consultar | `GET /v2/transparents/check?id=pix_char_…` |
| Simular pagamento (só Modo Teste) | `POST /v2/transparents/simulate-payment?id=…` |
| Subconta do professor | `POST /v2/sub-accounts/create` `{name, taxId, externalId}` |
| Reembolso (operação) | `POST /v2/transparents/refund` `{id, reason}` |

- O ambiente vem da **chave**: `abc_dev_…` = Modo Teste; `abc_prod_…` = produção.
- `externalId` = id da cobrança interna (`payment_intents.id`). A AbacatePay devolve a cobrança
  pendente existente para o mesmo `externalId`: **repetir a criação nunca duplica o Pix**.
- Nada da API v1 foi reaproveitado.

## Arquitetura

```
App (React)                 API (FastAPI, Vercel)                    Postgres (Supabase)
-----------                 ---------------------                    -------------------
POST /v1/payments/checkout ─► valida oferta/horário (como aluno) ──► private.payment_create_hold
  {teacher, subject,          (transação curta)                       aula awaiting_payment + intent
   starts_at, duration,                                               valor/comissão congelados
   idempotency_key}         ─► AbacatePay create (FORA da transação)
                            ─► private.payment_attach_charge ───────► br_code, QR, expiração
GET /v1/payments/{id}  ◄───── estado do banco; se pendente:
 (backoff 3 s → 20 s)         • sem cobrança → recria (mesmo externalId)
                              • com cobrança → check no gateway (≤ 1 a cada 5 s)
AbacatePay ─ webhook ─────► POST /v1/payments/webhooks/abacatepay
                              segredo + HMAC do corpo bruto ──────► payment_record_webhook (dedup)
                                                                    payment_confirm (FOR UPDATE)
                            ─► Google Agenda + Meet (falha não desfaz o pagamento)
```

- Todas as escritas financeiras passam por funções `SECURITY DEFINER` em `private`, executáveis
  **só** pelo papel da API (`edusearch_api`). `authenticated` só tem `SELECT` com RLS de
  participante. Ninguém altera valor, status, split ou reembolso pelo app ou pelo PostgREST.
- O webhook não tem usuário: roda em `Database.service_transaction()` (papel da API, sem claims),
  que só consegue executar as funções `payment_*`.

### Estados

```
                 checkout
                    │
                    ▼
   ┌──────────── pending ────────────┐───────────────┐
   │ (webhook PAID /    │ prazo vence │ aluno/prof.   │ gateway recusou
   │  conciliação)      ▼             │ cancela       ▼
   │                 expired          ▼             failed
   ▼                    │ PAID tardio cancelled
  paid ◄────────────────┘ (horário livre → aula volta; ocupado → paid + reembolso solicitado)
   │  └─► refunded / under_dispute (webhooks transparent.refunded / transparent.disputed)
   └─► aula cancelada depois de paga → reembolso solicitado (refund_requests)
```

Aula: `awaiting_payment → scheduled` (pago) · `→ expired` (Pix vencido) · `→ cancelled`.
O horário fica bloqueado (EXCLUDE) em `scheduled` e `awaiting_payment`.

### Casos difíceis (todos testados em `tests/db/test_payments_db.py`)

| Situação | Comportamento |
|---|---|
| Clique duplo / reenvio | mesma `idempotency_key` → mesma reserva e o mesmo Pix (200) |
| Dois alunos no mesmo horário | EXCLUDE no banco → 409 `slot_unavailable` |
| Rede cai após criar o Pix | intent fica pendente sem cobrança; a próxima consulta recupera pelo `externalId` (sem duplicar) |
| Gateway recusa a criação | intent `failed`, horário liberado, 503 para o app |
| Webhook forjado / sem assinatura / segredo errado | 401, nada muda |
| Webhook do outro ambiente (`devMode` ≠ estágio) | ignorado |
| Webhook repetido (mesmo id) | `duplicate`, nada repetido |
| Evento novo para cobrança já paga | `already_processed` |
| Confirmações simultâneas | serializadas por `FOR UPDATE`: uma confirma, as outras são `already_processed` |
| Valor pago ≠ valor congelado | `amount_mismatch`, **não confirma**, fica na auditoria |
| Pix pago depois de expirar | horário livre → `confirmed_late` (aula volta); ocupado → `paid_slot_lost` + reembolso solicitado |
| Pago depois de cancelar | `paid_after_cancel` + reembolso solicitado |
| Cancelamento de aula paga | intent pago + reembolso solicitado; pendente → `cancelled` |
| Google fora do ar após pagar | pagamento e aula ficam confirmados; evento com `calendar_sync_status = failed` e reenvio manual |
| URL/navegador diz "pago" | ignorado: o app só mostra o estado do servidor |

## Rotas da API

| Rota | Quem | O quê |
|---|---|---|
| `GET /v1/payments/status` | logado | estágio, comissão (bps), split habilitado, minutos de reserva |
| `POST /v1/payments/checkout` | aluno | reserva + Pix. Corpo: `teacher_id, subject, starts_at, duration_minutes, idempotency_key` (campos extras → 422). 201 criado / 200 repetido |
| `GET /v1/payments/{id}` | participantes | estado; pendente → recria/concilia. Pix (`br_code`, QR) só para o aluno e só enquanto pendente |
| `POST /v1/payments/{id}/simulate` | aluno, **só sandbox** | Modo Teste: simula o pagamento e concilia |
| `GET /v1/me/payments` | logado | histórico (aluno e professor) |
| `GET/PUT /v1/me/payout-account` | professor | subconta para split (CPF/CNPJ vai só ao gateway; guardamos os 4 últimos dígitos) |
| `POST /v1/payments/webhooks/abacatepay` | AbacatePay | público; autenticado por segredo + HMAC |

Erros: `payments_disabled` (403), `payments_not_configured` (503), `slot_unavailable` (409),
`idempotency_conflict` (409), `price_not_set` (409), `payment_gateway_error` (503),
`sandbox_only` (403), `split_unavailable` (409), `invalid_webhook` (401).

## Variáveis de ambiente

Nenhum valor real neste documento. Segredos só no painel do provedor, **nunca** no repositório.

### API — Vercel (projeto da API)

| Variável | Preview / testes | Produção (hoje) |
|---|---|---|
| `API_PAYMENTS_STAGE` | `sandbox` (só quando for testar) | **`off`** |
| `API_ABACATEPAY_API_KEY` | chave **`abc_dev_…`** (Modo Teste) — *Sensitive* | não cadastrar |
| `API_ABACATEPAY_WEBHOOK_SECRET` | ≥ 32 caracteres aleatórios — *Sensitive* | não cadastrar |
| `API_ABACATEPAY_WEBHOOK_PUBLIC_KEY` | chave pública HMAC da doc oficial (Webhooks → Segurança) | — |
| `API_ABACATEPAY_SPLIT_ENABLED` | `false` até o suporte habilitar | `false` |
| `API_PAYMENTS_PRODUCTION_APPROVED` | `false` | `false` (só com aprovação formal) |
| `API_PAYMENTS_HOLD_SECONDS` | `900` | `900` |

Salvaguardas no código (`app/config.py`): a API **não inicia** com chave `abc_prod_` fora de
`production`; `sandbox` exige `abc_dev_`; `production` exige `abc_prod_` **e**
`API_PAYMENTS_PRODUCTION_APPROVED=true`; o segredo do webhook precisa de ≥ 32 caracteres.
Sem chave, segredo e chave pública, os pagamentos ficam "não configurados" (503) e o webhook
recusa tudo.

### App — Cloudflare Pages (`edusearch-app`)

| Variável | Preview | Produção (hoje) |
|---|---|---|
| `VITE_STAGE_PAYMENTS` | `sandbox` | **`off`** |

A flag do app só mostra a interface. Não há segredo do gateway no app. Com `off`, as rotas
`/conta/pagamentos*` redirecionam e a reserva continua sendo a do piloto (sem cobrança).

### Webhook no painel da AbacatePay (Modo Teste)

- URL: `https://<host-da-api>/v1/payments/webhooks/abacatepay?webhookSecret=<mesmo segredo>`
- Eventos: `transparent.completed`, `transparent.refunded`, `transparent.disputed`.
- O segredo também é aceito no header `X-Webhook-Secret`. A assinatura `X-Webhook-Signature` é
  sempre exigida.

## Banco

Migrations `20261122120000_payments_lesson_status.sql` (novos estados da aula, em arquivo
separado porque valores de enum não podem ser usados na mesma transação) e
`20261122120100_payments_foundation.sql`:

- `public.payment_intents` (valor, comissão, parte do professor, ambiente, status, cobrança,
  Pix, expiração, pagamento, split), `public.payment_splits`, `public.teacher_payout_accounts`,
  `public.refund_requests` — RLS, só `SELECT` de participante.
- `private.payment_webhook_events` (id do evento, tipo, sha256 do corpo — **não** guarda o payload)
  e `private.payment_audit_log` (toda transição de estado, com origem).
- Gatilhos de `lessons`: aula paga só nasce pela função da API; `is_test` é imutável; o usuário só
  consegue **cancelar** (nunca confirmar) uma aula.

Rollback: `supabase/rollback/20261122_fase_5_down.sql` (testado: o catálogo volta idêntico ao da
3A). Apaga o histórico financeiro — só com backup, conciliação no gateway e aprovação.

## Segurança — revisão

- Valor, comissão e recebedor **nunca** vêm do app (schema `extra="forbid"` + cálculo no banco).
- Pagamento só é confirmado pelo servidor: webhook (segredo em tempo constante + HMAC-SHA256 do
  corpo bruto) ou consulta ao gateway. URL, redirecionamento e resposta do navegador são ignorados.
- Idempotência em três camadas: chave do aluno (reserva), `externalId` (gateway), id do evento
  (webhook). Concorrência resolvida por `FOR UPDATE` e EXCLUDE.
- Logs sem chave, sem Pix copia e cola, sem CPF e sem payload completo (só id da cobrança/estado).
  O webhook guarda só o hash do corpo.
- CPF/CNPJ do professor: enviado só ao gateway; guardamos os 4 últimos dígitos (pendente:
  revisão LGPD e termos de repasse).
- QR exibido só se for `data:image/png;base64,…`; `brCode` só para o aluno e só enquanto pendente.
- O app consulta em backoff e para em estado final; a API limita a conciliação a 1 a cada 5 s por
  cobrança.

## Testes

| Suíte | O quê |
|---|---|
| `apps/api/tests/test_payments_units.py` | comissão (0–20 000 centavos = frontend), HMAC/segredo, cliente v2 (contrato, erros tipados, timeout, resposta inválida), salvaguardas de chave/estágio, CPF/CNPJ |
| `apps/api/tests/db/test_payments_db.py` | banco real + AbacatePay falsa: checkout, idempotência, conflito, webhook (forjado, duplicado, outro ambiente, valor divergente, simultâneo), expiração e atraso, cancelamentos, Google fora, rede instável, simulação, conciliação, split habilitado e indisponível, RLS |
| `apps/api/tests/db/test_security.py` | inventário de grants/políticas atualizado |
| `apps/web/scripts/unit.test.mjs` | flag `VITE_STAGE_PAYMENTS`, BRL, contagem, backoff |
| `apps/web/scripts/payments.mjs` | navegador: checkout, clique duplo, QR/copia e cola, contagem, URL forjada, confirmação por consulta, simulação, gateway lento, expiração, 409, histórico, visão do professor, axe, 320–1440 px claro/escuro |

## Validação no sandbox (critério de aceite)

1. Na API (local ou Preview): `API_PAYMENTS_STAGE=sandbox`, chave `abc_dev_…`, segredo e chave
   pública; webhook cadastrado no painel em Modo Teste apontando para a API.
2. No app: `VITE_STAGE_PAYMENTS=sandbox` (com agenda real ligada).
3. Professor com preço definido, publicado e Google Agenda conectada.
4. Aluno autorizado: Explorar → professor → horário → **Reservar e pagar com Pix**.
5. Ver QR/copia e cola/contagem → **Simular pagamento (sandbox)** (ou simular no painel).
6. Esperado: pagamento "Pago", aula "Na Google Agenda" com link do Meet, auditoria com
   `pending → paid`. Nenhum dinheiro real.

## Checklist para produção (NÃO executar sem aprovação)

- [ ] Validação jurídica (termos de pagamento, reembolso, intermediação) e financeira.
- [ ] Preço por aula vs. por duração confirmado com o negócio.
- [ ] Split habilitado pelo suporte da AbacatePay e testado no Modo Teste.
- [ ] Revisão LGPD do CPF/CNPJ do professor.
- [ ] Chave `abc_prod_` cadastrada **só** na Vercel (Production), webhook de produção com segredo novo.
- [ ] `API_PAYMENTS_PRODUCTION_APPROVED=true` e `VITE_STAGE_PAYMENTS=production` (documentos publicados).
- [ ] Rotina de conciliação/reembolso operada e monitorada.

## Limitações conhecidas

- A chave pública HMAC da AbacatePay é configuração (`API_ABACATEPAY_WEBHOOK_PUBLIC_KEY`): copie
  da documentação oficial. Sem ela o webhook recusa tudo (falha fechada) e a confirmação acontece
  pela conciliação quando o app consulta.
- Reservas vencidas são liberadas quando alguém consulta horários/checkout (sem cron). A
  conciliação de cobranças esquecidas depende de consulta; um job periódico fica para a operação.
- Reembolsos são solicitações; a execução no gateway é manual (operação).
