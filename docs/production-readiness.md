# Production readiness — Finance V2

## Estado seguro desta fase

Pagamentos e saques reais continuam **desligados**. A API falha fechada para produção sem chave
`abc_prod_`, aprovação operacional e split AbacatePay habilitado. A flag de saque continua
`false`; o app nunca transforma parcela atribuída em saldo disponível.

| Variável exata | Origem | Destino | Finalidade | Obrigatória | Preenchimento seguro |
|---|---|---|---|---|---|
| `API_PAYMENTS_STAGE` | operação | Vercel API | estágio do checkout | sim | `off` até homologação; depois `production` |
| `API_ABACATEPAY_API_KEY` | AbacatePay | Vercel API | gateway Pix | em uso | secret `abc_dev_` ou `abc_prod_`, conforme estágio |
| `API_ABACATEPAY_WEBHOOK_SECRET` | operação | Vercel API + painel AbacatePay | autentica webhook | em uso | segredo aleatório de 32+ caracteres |
| `API_ABACATEPAY_WEBHOOK_PUBLIC_KEY` | AbacatePay | Vercel API | HMAC do webhook | em uso | copiar da documentação oficial |
| `API_ABACATEPAY_SPLIT_ENABLED` | operação | Vercel API | libera split | sim em produção | `false` até confirmação do provedor |
| `API_PAYMENTS_PRODUCTION_APPROVED` | operação | Vercel API | aprovação explícita | sim em produção | `false` até autorização formal |
| `API_SUBACCOUNT_WITHDRAWALS_ENABLED` | operação | Vercel API | libera saques | não | manter `false` |
| `API_NOTIFICATIONS_STAGE` | operação | Vercel API | controla notificações | não | manter `off` até outbox homologada |
| `API_RESEND_API_KEY` | Resend | Vercel API | credencial de e-mail | quando ativado | secret do painel Resend |
| `API_RESEND_FROM` | Resend | Vercel API | remetente verificado | quando ativado | `EduSearch <notificacoes@mail.edusearch.com.br>` após verificação |
| `VITE_STAGE_PAYMENTS` | operação | Cloudflare Pages | interface do checkout | sim | não é secret; manter alinhado ao backend |

## Checklist operacional

1. Cadastrar segredos somente nos escopos Production da Vercel; nunca no app ou GitHub.
2. Confirmar suporte a split e permissões `TRANSPARENT:CREATE`, `SUB_ACCOUNT:READ` antes de usar produção.
3. Validar uma subconta Production do professor de homologação e o webhook com segredo distinto do Sandbox.
4. Somente após aprovação formal, habilitar checkout; manter saques desabilitados.
5. Fazer Pix real de baixo valor, conferir split, auditoria e conciliação antes de ampliar acesso.
6. Para Resend, verificar o domínio no painel e copiar **exatamente** os registros DNS fornecidos para Cloudflare. Não há valores DNS inferidos neste repositório.

## Procedimento de transição e rollback

Com `API_PAYMENTS_STAGE=sandbox`, uma chave `abc_prod_` é corretamente recusada na inicialização:
isso mantém recursos não financeiros disponíveis apenas após a chave ser corrigida para `abc_dev_`
ou após a transição formal para produção. A transição exige, nesta ordem: confirmação de split,
`abc_prod_`, segredo/HMAC de produção, `API_ABACATEPAY_SPLIT_ENABLED=true` e aprovação explícita.
Para rollback, desative a aprovação e o split (ou retorne ao Sandbox com chave `abc_dev_`); não
apague intenções, webhooks ou registros de auditoria.

## Limitações deliberadas

A outbox existe, porém não há agendador confiável configurado para o despachante. Portanto
notificações e lembretes automáticos seguem desligados; uma falha de e-mail não pode afetar
pagamento ou reserva.
