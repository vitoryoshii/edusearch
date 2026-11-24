# Resend — integração transacional

## Estado

`API_NOTIFICATIONS_STAGE=off` por padrão. A outbox persistente e o cliente Resend existem, mas
nenhum despachante é habilitado enquanto a operação não aprovar o agendador e a flag. Uma falha de
e-mail nunca pode cancelar uma reserva ou alterar um pagamento/saque.

## Arquitetura aprovada para ativação futura

1. `private.notification_outbox` guarda chave de idempotência única, estado, lease, tentativas e erro sanitizado.
2. Funções privadas concedidas somente a `edusearch_api` fazem enqueue, claim, confirmação e retry.
3. O cliente envia `POST /emails` com o alias publicado, variáveis validadas e `Idempotency-Key`.
4. Retry exponencial é limitado a oito tentativas; leases expirados voltam à fila.
5. Um cron/worker persistente ainda é obrigatório antes de ativar o dispatch. Lembretes seguem desabilitados.

## Templates publicados

Os aliases e suas variáveis obrigatórias são validados no backend. Não há template publicado para
saque; esse evento permanece fora do dispatch até existir contrato aprovado.

## Domínio e DNS

Remetente proposto: `EduSearch <notificacoes@mail.edusearch.com.br>`. Crie e verifique o domínio
no painel Resend e copie para a Cloudflare os registros SPF, DKIM e DMARC **exatamente** como
fornecidos pelo Resend. Não há valores DNS genéricos ou automação de DNS neste repositório.

## Eventos futuros

Boas-vindas, reserva, confirmação de pagamento/aula, cancelamento, Meet e saque deverão ser
enfileirados somente quando a respectiva fonte de verdade estiver confirmada. Pagamento e saque
não podem ser anunciados a partir de UI, resposta HTTP intermediária ou valor atribuído.
