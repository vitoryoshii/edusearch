# API em Cloudflare Python Workers + Hyperdrive (Fase 2.6C)

A mesma FastAPI de `apps/api/app` roda em **Cloudflare Python Workers** (Pyodide/WebAssembly) e se conecta ao Supabase `edusearch-db` pelo **Hyperdrive**. A arquitetura de autorização não muda: JWT do Supabase validado no servidor, `SET LOCAL ROLE authenticated`/`anon`, claims verificadas em `request.jwt.claims` e RLS.

```text
App (Cloudflare Pages)
   │  HTTPS + Bearer <access token do Supabase>
   ▼
Worker edusearch-api (Python, FastAPI via workers.asgi)
   ├─ JWKS do Supabase (fetch assíncrono, cache ≤ 10 min)
   └─ psycopg 3 (psycopg-binary para Pyodide) → binding HYPERDRIVE (cache DESLIGADO)
                                                  │  pool em modo transação, RESET ao devolver
                                                  ▼
                                    Supabase Postgres como edusearch_api (sem SUPERUSER/BYPASSRLS)
```

## Estado

| Item | Situação |
| ---- | -------- |
| Compatibilidade no runtime Workers (`workerd` local, `pywrangler dev`) | ✅ Validada. FastAPI 0.165, Pydantic 2.14, PyJWT, cryptography 47 (ES256), psycopg 3.3.5 + psycopg-binary (Pyodide) |
| Contratos, 401/403/404/422, RLS, isolamento A/B e 40 requisições concorrentes intercaladas | ✅ `worker/e2e.py local` no workerd (CI: job `worker`) |
| `DirectDatabase` (uma conexão por transação) | ✅ Testes com banco: sem vazamento de papel/claims entre transações |
| Worker isolado na Cloudflare (`*.workers.dev`), Hyperdrive real e contas reais | ⏳ Depende das etapas com aprovação abaixo |
| `api.edusearch.com.br`, variáveis do Pages e acesso restrito ao `testing` | ⏳ Só depois da validação técnica |

## O que precisou ser adaptado (e por quê)

| Incompatibilidade no Pyodide | Solução (só no entrypoint do Worker; local/uvicorn não muda) |
| ---------------------------- | ------------------------------------------------------------ |
| `psycopg` puro procura a `libpq` nativa | Dependência `psycopg[binary]`, que tem build oficial para Pyodide |
| `psycopg_pool` usa threads | `DirectDatabase`: uma conexão por transação, fechada ao final. O pool é o do Hyperdrive |
| FastAPI roda rotas síncronas em thread pool (`RuntimeError: can't start new thread`) | O entrypoint executa funções síncronas inline. Os sockets do runtime não bloqueiam o event loop |
| JWKS buscado com httpx dentro de código síncrono | O entrypoint busca o JWKS com o `fetch` assíncrono do runtime **antes** de a requisição entrar na FastAPI (cache ≤ 10 min). O resolver só lê o cache |
| Lifespan ASGI roda a cada requisição em `workers.asgi` | O papel de conexão é conferido uma vez por isolate no entrypoint: superusuário/BYPASSRLS → 503 em tudo |

O modelo de autorização não foi alterado: as mesmas dependências, os mesmos serviços e o mesmo SQL.

## Segurança específica do Hyperdrive

- **Cache de consultas: DESLIGADO (obrigatório).** O cache do Hyperdrive vem ligado por padrão e não é invalidado em escritas. As leituras da API dependem do papel e das claims da transação, então uma resposta em cache poderia ir para outro usuário. Crie a configuração com `--caching-disabled`.
- **Modo transação:** a documentação garante que `SET` dentro de `BEGIN/COMMIT` vale e que a conexão passa por `RESET` ao voltar ao pool. A API sempre usa `SET LOCAL` e `set_config(..., true)` dentro de uma transação explícita, e nunca `SET` de sessão. O teste `test_no_session_state_leaks_between_transactions` cobre isso.
- **Sem prepared statements nomeados** (`prepare_threshold=None`).
- **Respostas privadas:** `Cache-Control: no-store` em `/v1/*`. O Worker não usa Cache API.

## Etapas remotas — cada uma exige aprovação explícita

> Nenhuma destas etapas foi executada. As senhas são geradas e digitadas **pelo responsável**, nunca passam pelo repositório nem por este documento.

1. **Backup verificável (antes de qualquer mudança no banco):** *Database → Backups* no painel. Para um backup lógico local, use `supabase db dump --linked -f backup-schema.sql` e `--data-only -f backup-data.sql`, guardados fora do Git. Confira que os arquivos abrem e contêm as 7 tabelas de `public`.
2. **Ativar o login do `edusearch_api`** (SQL Editor do Supabase):
   ```sql
   alter role edusearch_api with login password '<gerada no gerenciador de senhas, 32+ caracteres>';
   select rolname, rolsuper, rolbypassrls, rolcanlogin, rolinherit
     from pg_roles where rolname = 'edusearch_api';   -- esperado: f, f, t, f
   ```
3. **Login na Cloudflare:** `npx wrangler login` (interativo, pelo responsável).
4. **Hyperdrive sem cache** (a senha vai só para a Cloudflare):
   ```bash
   npx wrangler hyperdrive create edusearch-api-db --caching-disabled \
     --connection-string="postgresql://edusearch_api.pgltvnwdvatyihrozlvn:<senha>@<host-do-pooler>:5432/postgres?sslmode=require"
   ```
   Use o **pooler do Supabase em modo sessão** (porta 5432, endereço IPv4 em *Connect → Session pooler*), já que a conexão direta `db.<ref>.supabase.co` pode ser só IPv6. Copie o `id` gerado para `apps/api/worker/wrangler.jsonc`. O id não é segredo.
5. **Deploy do Worker isolado** (sem rota/domínio; o app público não aponta para ele):
   ```bash
   cd apps/api/worker && uv run python sync_app.py && uv run pywrangler deploy
   ```
6. **Testes reais** com duas contas adultas de teste autorizadas. Os tokens vêm de um login real (app local com `VITE_API_BASE_URL=<url do workers.dev>` e `VITE_STAGE_PROFILE_PERSISTENCE=testing`) e nunca vão para o Git:
   ```bash
   E2E_TOKEN_A=... E2E_TOKEN_B=... python apps/api/worker/e2e.py remote https://edusearch-api-staging.<conta>.workers.dev
   ```
7. **Domínio e publicação (depois da validação):** *Workers → Domains* com `api.edusearch.com.br`. Ajuste `API_CORS_ORIGINS` para `https://app.edusearch.com.br` e `API_ENVIRONMENT=production`, e defina `VITE_API_BASE_URL` no projeto `edusearch-app`. `VITE_STAGE_PROFILE_PERSISTENCE` continua `off` em produção.

## Acesso restrito ao modo `testing`

Variáveis `VITE_*` são públicas e **não** controlam acesso. Para liberar a persistência só à equipe:

- **Quem pode criar conta:** hook *Before User Created* com allowlist (já existe no banco, **desligado**). Antes de ligá-lo, inclua os testadores na allowlist e valide a entrada deles.
- **Quem pode abrir o app de testes:** um deployment separado do Pages com `VITE_STAGE_PROFILE_PERSISTENCE=testing` (ex.: branch `testing`), protegido por **Cloudflare Access** (Zero Trust, gratuito até 50 usuários) com os e-mails da equipe. Essa é a barreira efetiva na borda.
- **A API em si:** só aceita JWT válido do Supabase e o RLS isola cada conta. Uma conta indevida só vê os próprios dados, mas não deveria existir, e é isso que o hook garante.

## Achado de segurança em aberto

As configurações públicas de Auth do `edusearch-db` mostram `disable_signup: false` com os provedores **google e email habilitados** (consulta de leitura em `/auth/v1/settings`). Se o hook *Before User Created* não estiver ativo, **qualquer pessoa consegue criar conta hoje** (Google ou e-mail com confirmação). Confira em *Authentication → Hooks* e *Sign In / Providers* e decida, com aprovação, entre:

- ativar o hook com a allowlist (depois de cadastrar e testar os testadores); ou
- desativar novos cadastros até a abertura.

## Limites e custos (planos gratuitos)

| Recurso | Free | Observação |
| ------- | ---- | ---------- |
| Workers | 100.000 req/dia, **10 ms de CPU** por requisição, 128 MB, 1 s de inicialização, 6 conexões simultâneas | Tempo de espera de rede não conta como CPU. Python tem cold start maior, mitigado pelo snapshot de memória no deploy. **A CPU real por rota precisa ser medida no deploy** (observability). Se exceder, o plano Workers Paid custa US$ 5/mês |
| Hyperdrive | Disponível no Free: 10 configurações, ~20 conexões com a origem | Suficiente para testes. Monitorar o pool do Supabase |
| Rate limiting | Binding opcional `RATE_LIMITER` (por IP, janela de 10/60 s, aproximado) | A disponibilidade no Free não está documentada. Sem o binding, o Worker não limita |
| Bundle | ~36 MB de módulos (limite de 64 MiB) | — |

## Desenvolvimento local do Worker

```bash
cd apps/api/worker
uv sync && uv run python sync_app.py
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://edusearch_api:<local>@127.0.0.1:54322/postgres
uv run pywrangler dev --port 8787 --var API_SUPABASE_URL:http://127.0.0.1:54400
# em outro terminal (apps/api):
E2E_ADMIN_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres python worker/e2e.py local http://127.0.0.1:8787
```
