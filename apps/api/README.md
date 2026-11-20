# EduSearch API

API Python/FastAPI do EduSearch. Contrato: [docs/api-contract.md](../../docs/api-contract.md). Banco e RLS: [docs/database-design.md](../../docs/database-design.md).

| Rota | Autenticação | Descrição |
| ---- | ------------ | --------- |
| `GET /health` | — | Verifica se a API está no ar |
| `GET /v1/me` | Bearer (JWT do Supabase) | Perfil do usuário autenticado |
| `PUT /v1/me/profile` | Bearer | Atualiza nome e foto do próprio perfil |
| `POST /v1/me/roles` | Bearer | Escolhe aprender/ensinar (idempotente; só `student`/`teacher`) |
| `GET`/`PUT /v1/me/student-profile` | Bearer + papel `student` | Cadastro do aluno (privado) |
| `GET`/`PUT /v1/me/teacher-profile` | Bearer + papel `teacher` | Cadastro do professor (verificação/publicação só do servidor) |
| `GET /v1/subjects` | — | Catálogo de disciplinas |

## Estrutura

```text
app/
  main.py            create_app(): CORS, erros, rotas, ciclo de vida (pool do banco)
  config.py          Settings (variáveis API_*), validação de CORS/URLs/algoritmos
  errors.py          ApiError e formato único de erro {detail, code}
  db.py              Pool psycopg + user_transaction (SET LOCAL ROLE authenticated + claims → RLS)
  auth/jwt.py        JwksKeyResolver (cache ≤ 10 min) e TokenVerifier (ES256, iss, aud, exp, sub)
  auth/dependencies.py  require_user, get_user_roles, require_role, ensure_owner
  routers/           health, me
  schemas/           contratos Pydantic (MeResponse, ProfileUpdate, ErrorResponse)
  services/          regras (DbProfileService)
  repositories/      SQL (ProfileRepository)
scripts/security_advisor.py   lints do Security Advisor (splinter) no CI
tests/               unitários (sem banco) e tests/db (com banco descartável)
```

## Executar localmente

```bash
cd apps/api
python -m venv .venv
# Windows: .venv\Scripts\activate   |   Linux/macOS: source .venv/bin/activate
pip install -c constraints.txt -e ".[dev]"
cp .env.example .env               # preencha; .env é ignorado pelo Git
uvicorn app.main:app --reload --port 8000
```

- Sem `API_SUPABASE_URL`, as rotas autenticadas respondem 503 `auth_not_configured`. Sem `API_DATABASE_URL`, respondem 503 `database_unavailable`. `/health` funciona sempre.
- Documentação interativa: <http://localhost:8000/docs>.

### Com o Supabase local (Docker)

```bash
supabase start                      # na raiz do repositório; aplica supabase/migrations
```

Configure `API_SUPABASE_URL=http://127.0.0.1:54321` e `API_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres`. A API só aceita tokens **assimétricos** (como no projeto remoto, ES256). Se o Auth local emitir HS256, gere uma chave com `supabase gen signing-key --algorithm ES256` e aponte `auth.signing_keys_path` no `supabase/config.toml` (não commite o arquivo da chave).

## Testes e lint

```bash
ruff check . && ruff format --check .
pytest                                           # testes de banco são pulados
TEST_DATABASE_URL=postgresql://... pytest tests/db   # banco DESCARTÁVEL
```

- **Sem banco:** JWT válido, inválido, expirado, forjado, HS256/`none`, ID token do Google, `kid` desconhecido, JWKS fora do ar; `/v1/me` e `PUT /v1/me/profile` (próprio usuário, ids de terceiros ignorados, campos proibidos, validação); banco não configurado ou inalcançável (503); erros sem vazamento; CORS; papéis e propriedade.
- **Com banco** (`tests/db`): RLS com dois usuários e anon, privilégios por coluna, aprovação e publicação de professores, cascade e restrict, hook de admissão, endurecimento de `rls_auto_enable`, verificações no estilo do Security Advisor e API de ponta a ponta sob RLS.
- Em um PostgreSQL vazio sem Supabase, os testes aplicam `tests/db/supabase_shim.sql` e as migrations automaticamente.

O CI (`.github/workflows/backend-ci.yml`) roda tudo isso, sem credenciais reais.

## Configuração

Todas as variáveis estão em [.env.example](.env.example). As principais:

| Variável | Padrão | Descrição |
| -------- | ------ | --------- |
| `API_CORS_ORIGINS` | `http://localhost:5173,…:5174,…:5190` | Origens exatas (sem curinga). Produção: `https://app.edusearch.com.br` |
| `API_SUPABASE_URL` | — | Origem do projeto. Define o emissor e o JWKS |
| `API_JWT_ALGORITHMS` | `ES256` | Somente assimétricos (`ES256`, `RS256`, `EdDSA`) |
| `API_DATABASE_URL` | — | Segredo. Conecta como `edusearch_api` (menor privilégio; ver database-design.md → "Conexão da API") |
| `API_ENVIRONMENT` | `development` | Em `production`, a API não inicia com papel de conexão superusuário/BYPASSRLS |
| `API_AVATAR_ALLOWED_HOST_SUFFIXES` | `googleusercontent.com` | Hosts aceitos para foto (o do projeto Supabase é incluído) |

Dependências: faixas em `pyproject.toml` e versões exatas em `constraints.txt`. Não há Redis, Celery nem outra infraestrutura paga.
