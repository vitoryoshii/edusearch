# EduSearch trust cron (`edusearch-trust-cron`)

Worker isolado que aciona o Trust Engine a cada 5 minutos chamando
`POST /v1/internal/trust/dispatch` na API (FastAPI, Vercel). Ele **não** processa documentos, não
acessa banco, Storage ou chaves privadas e não expõe endpoint HTTP (o handler `fetch` responde 404;
sem rota e sem `workers.dev`). Independente do `notifications-cron`, com segredo próprio.

| Item | Valor |
| --- | --- |
| Cron | `*/5 * * * *` |
| `EDUSEARCH_API_URL` | `https://api.edusearch.com.br` (somente `https`, sem credenciais na URL) |
| `TRUST_DISPATCH_SECRET` | secret do Worker, 32+ caracteres, igual a `API_TRUST_DISPATCH_SECRET` na Vercel |

Proteções: timeout de 25 s (`AbortController`), redirecionamentos não seguidos, logs só com
contadores inteiros ou um código de erro (`http_503`, `timeout`, `network_error`...), guarda de
execução única por isolate. A garantia forte contra concorrência fica no banco: leases com
`FOR UPDATE SKIP LOCKED` e idempotência por submissão.

A API processa no máximo `API_TRUST_DISPATCH_BUDGET_SECONDS` (padrão 8 s, abaixo dos 10 s da Vercel
Hobby); jobs restantes ficam com lease e são retomados no próximo disparo.

## Testes

```bash
node --test workers/trust-cron/test/dispatch.test.ts
```

## Implantação (exige autorização explícita; não executada nesta PR)

```bash
npx wrangler secret put TRUST_DISPATCH_SECRET --config workers/trust-cron/wrangler.jsonc
npx wrangler deploy --config workers/trust-cron/wrangler.jsonc
```

Pausar: remover o trigger (`"crons": []`) e reimplantar, ou excluir o Worker. A fila permanece
segura (jobs `pending`) e nenhum professor é aprovado sem o motor.
