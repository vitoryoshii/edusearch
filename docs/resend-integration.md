# Resend — integração transacional planejada

## Estado

`API_NOTIFICATIONS_STAGE=off` por padrão. Esta fase prepara as configurações e não ativa envio
porque ainda não existe outbox persistente nem agendador confiável no ambiente atual. Uma falha de
e-mail nunca pode cancelar uma reserva ou alterar um pagamento/saque.

## Arquitetura aprovada para ativação futura

1. Criar `private.notification_outbox`, com chave de idempotência única, tentativas, estado e erro sanitizado.
2. Enfileirar **após** o commit do evento de domínio; nunca dentro da transação financeira.
3. Enviar pelo endpoint Resend `/emails` no backend, com timeout curto e `Idempotency-Key`.
4. Reprocessar apenas por job autenticado e aprovado. Lembretes ficam desabilitados sem agendador confiável.

## Domínio e DNS

Remetente proposto: `EduSearch <notificacoes@mail.edusearch.com.br>`. Crie e verifique o domínio
no painel Resend e copie para a Cloudflare os registros SPF, DKIM e DMARC **exatamente** como
fornecidos pelo Resend. Não há valores DNS genéricos ou automação de DNS neste repositório.

## Eventos futuros

Boas-vindas, reserva, confirmação de pagamento/aula, cancelamento, Meet e saque deverão ser
enfileirados somente quando a respectiva fonte de verdade estiver confirmada. Pagamento e saque
não podem ser anunciados a partir de UI, resposta HTTP intermediária ou valor atribuído.
