# Banco de dados: modelagem e segurança (Fase 2.6A)

PostgreSQL do Supabase (`edusearch-db`, ref. `pgltvnwdvatyihrozlvn`). Esta fase cria a fundação de perfis de alunos e professores, o catálogo de disciplinas, as políticas RLS e o controle de admissão de usuários de teste.

> **Estado:** as migrations estão versionadas em `supabase/migrations/` e foram validadas em banco local e no CI. **Elas não foram aplicadas no projeto remoto.** A aplicação depende de aprovação explícita (ver [Aplicação controlada](#aplicação-controlada-no-projeto-remoto)).

## Migrations

| Arquivo | Conteúdo |
| ------- | -------- |
| `20261119120000_profiles_foundation.sql` | Tipos, tabelas, constraints, índices, `updated_at`, trigger que cria o perfil a partir de `auth.users`, backfill das contas existentes e catálogo inicial de disciplinas |
| `20261119120100_rls_policies.sql` | Revoga o acesso padrão da Data API e concede privilégios mínimos (por coluna quando necessário), além das políticas RLS |
| `20261119120200_signup_admission_hook.sql` | Allowlist `private.signup_allowlist` e função `public.hook_before_user_created` (o hook **não** é ligado) |
| `20261119120300_harden_rls_auto_enable.sql` | Revoga EXECUTE de `public.rls_auto_enable()` para PUBLIC, anon e authenticated, e fixa o `search_path` |
| `20261120013704_disable_unused_pg_graphql.sql` | `drop extension if exists pg_graphql` (sem CASCADE). Não faz nada no remoto, que não tem a extensão |

O rollback fica em `supabase/rollback/20261119_fase_2_6a_down.sql`, fora da pasta de migrations.

## Diagrama

```mermaid
erDiagram
    AUTH_USERS ||--|| PROFILES : "id (cascade)"
    PROFILES ||--o{ ACCOUNT_ROLES : "user_id (cascade)"
    PROFILES ||--o| STUDENT_PROFILES : "user_id (cascade)"
    PROFILES ||--o| TEACHER_PROFILES : "user_id (cascade)"
    TEACHER_PROFILES ||--o{ TEACHER_SUBJECTS : "teacher_id (cascade)"
    SUBJECTS ||--o{ TEACHER_SUBJECTS : "subject_id (restrict)"

    AUTH_USERS { uuid id PK "Supabase Auth: e-mail, provedor, identidades" }
    PROFILES {
        uuid id PK "= auth.users.id"
        text display_name "1-80, sem controle"
        text avatar_url "https, <= 2048"
        profile_status status "onboarding | active | suspended (servidor)"
        timestamptz created_at
        timestamptz updated_at
    }
    ACCOUNT_ROLES {
        uuid user_id PK
        account_role role PK "student | teacher (servidor)"
        timestamptz created_at
    }
    STUDENT_PROFILES {
        uuid user_id PK
        text learning_goal "3-200"
        education_level education_level
        text difficulties "<= 500"
        weekday_array preferred_weekdays
        day_period_array preferred_periods
        lesson_modality preferred_modality
        int budget_min_cents
        int budget_max_cents
    }
    TEACHER_PROFILES {
        uuid user_id PK
        text headline "3-120"
        text bio "30-600"
        text academic_background "3-200"
        experience_range experience
        text methodology "<= 400"
        int price_cents "2000-100000"
        smallint lesson_duration_minutes "30|45|60|90"
        lesson_modality modality
        teacher_verification_status verification_status "servidor"
        timestamptz verified_at "servidor"
        bool is_published "servidor"
        timestamptz published_at "servidor"
    }
    SUBJECTS {
        smallint id PK "identity"
        text slug UK
        text name UK
        bool is_active
    }
    TEACHER_SUBJECTS {
        uuid teacher_id PK
        smallint subject_id PK
        education_level_array levels
    }
```

## Decisões

| Decisão | Motivo |
| ------- | ------ |
| `profiles.id` é o próprio `auth.users.id` (FK com `on delete cascade`) | A identidade fica no Supabase Auth. Não se copia e-mail, telefone, provedor ou identidades. Excluir a conta remove todos os dados de perfil |
| Perfil criado por trigger `after insert on auth.users` (`private.handle_new_auth_user`, `security definer`) | Toda conta tem perfil, e o cliente não precisa (nem pode) inserir em `profiles`. A migration também cria perfis para contas já existentes (backfill) |
| Nome e foto iniciais vêm de `raw_user_meta_data` | Só para **exibição**. Caracteres de controle são removidos e foto que não seja https é descartada. Nenhuma autorização usa metadados |
| Papéis em `account_roles` (PK `user_id, role`) | Uma conta pode ser aluno e professor. O usuário **não** grava papéis: a atribuição é do servidor (futuro `POST /v1/me/roles` ou operação administrativa) |
| Sem papel administrativo no banco nesta fase | Aprovação e publicação de professores são feitas pelo servidor ou operador (`service_role`/SQL). Privilégios nunca vêm de `user_metadata` nem de `app_metadata` do token |
| Aprovação e publicação: `verification_status`, `verified_at`, `is_published`, `published_at` | Constraints garantem coerência: só se publica perfil `approved`, e `verified_at`/`published_at` acompanham os estados. O professor não tem GRANT nessas colunas |
| Dinheiro em centavos (`integer`) | Sem ponto flutuante. Valor da aula de R$ 20,00 a R$ 1.000,00, a mesma regra do onboarding |
| Uma duração por professor (`lesson_duration_minutes`) | O pedido define "duração da aula". O onboarding aceita várias durações; quando for necessário, o modelo evolui para uma tabela de ofertas |
| Enums com o vocabulário do frontend (`medio`, `manha`, `seg`, `presencial`, `hibrido`…) | Evita tradução entre camadas (`apps/web/src/lib/onboarding.ts` e `src/lib/api/types.ts`) |
| `subjects` com `slug` único e `id smallint identity` | Catálogo pequeno e estável. `teacher_subjects.subject_id` usa `on delete restrict`: disciplina em uso não some (use `is_active = false`) |
| Índice `teacher_subjects(subject_id)` e índice parcial de publicados | A PK cobre a busca por professor; o índice cobre "professores de uma disciplina" e a FK |
| Schema `private` para funções e tabelas internas | Não é exposto pela Data API. anon/authenticated não têm USAGE |
| `set search_path = ''` em todas as funções | Evita sequestro de `search_path` (lint 0011) |
| Interesses do aluno (disciplinas) ainda não modelados | Ficam para o contrato de onboarding do aluno, com tabela `student_subjects` e FK para `subjects` |
| Dados de menores | Não há data de nascimento nem documento. **Não usar dados reais de menores de idade** em desenvolvimento ou testes: só contas fictícias (`@example.com`) |
| Segredos | Nenhuma tabela guarda senha, Client Secret, token do Google ou chave. Tokens OAuth do Google Agenda, quando existirem, ficarão em armazenamento próprio (Vault), fora destas tabelas |

## Segurança: privilégios e RLS

No Supabase, toda tabela nova em `public` nasce com **todos** os privilégios para `anon` e `authenticated`. A migration de RLS começa revogando tudo e concede somente o necessário. O RLS está ligado em todas as tabelas (inclusive a allowlist).

| Tabela | anon | authenticated: leitura | authenticated: escrita |
| ------ | ---- | ---------------------- | ---------------------- |
| `profiles` | — | só a própria linha | `UPDATE (display_name, avatar_url)` da própria linha. Sem INSERT/DELETE |
| `account_roles` | — | só os próprios papéis | nenhuma |
| `subjects` | `SELECT` das ativas | `SELECT` das ativas | nenhuma |
| `student_profiles` | — | só a própria linha (**privado**) | INSERT/UPDATE da própria linha, **somente com papel `student` persistido**. Colunas do servidor fora do GRANT |
| `teacher_profiles` | — | própria linha **ou** perfis `is_published` | INSERT/UPDATE da própria linha, **somente com papel `teacher` persistido**. Sem GRANT em `verification_status`, `verified_at`, `is_published`, `published_at` |
| `teacher_subjects` | — | do próprio professor ou de professores publicados | INSERT/UPDATE (`levels`)/DELETE das próprias linhas |
| `private.signup_allowlist` | — | — | — (só o dono; o hook lê via `security definer`) |

Garantias verificadas nos testes (`apps/api/tests/db/test_rls.py`):

- Um aluno não lê nem edita o perfil de outro aluno (0 linhas). Um professor não edita o perfil de outro professor.
- Dados de aluno não são visíveis para outros usuários nem para anon.
- O professor não se aprova nem se publica (erro de privilégio). O perfil só fica visível a outros usuários depois de aprovado **e** publicado pelo servidor, e nunca para anon.
- Ninguém grava, altera ou remove papéis pela Data API. Claims de papel no token (`user_metadata`/`app_metadata`) não concedem nada.
- Nenhuma política usa `user_metadata`/`raw_user_meta_data`. Nenhuma função `security definer` é executável por anon/authenticated.
- `auth.uid()` é usado como `(select auth.uid())` nas políticas (lint 0003), e há uma política SELECT por tabela (lint 0006).

### Conexão da API

A FastAPI conecta ao Postgres e, **para cada requisição**, abre uma transação com `SET LOCAL ROLE authenticated` e `request.jwt.claims` = claims do JWT **já verificado** (`apps/api/app/db.py`). Assim `auth.uid()` e o RLS valem também para a API (defesa em profundidade): um bug que consulte o id de outro usuário devolve vazio.

Papel de conexão recomendado no projeto remoto (criar manualmente, com senha forte guardada no gerenciador de segredos do provedor da API):

```sql
create role edusearch_api login password '<gerada-fora-do-git>' noinherit;
grant authenticated to edusearch_api;     -- permite SET ROLE authenticated; nada além disso
grant usage on schema public to edusearch_api;
```

Use a string de conexão do **pooler** (Supavisor, modo transação, porta 6543) com `sslmode=require`. A API desliga prepared statements (`prepare_threshold=None`) para ser compatível com o pooler. Não use a senha do `postgres` nem a `service_role` na API.

## Controle de admissão (Before User Created Hook)

A lista de *Test users* do Google Cloud **não basta**: quem obtiver um ID token válido para o Client ID consegue criar conta no Supabase. O hook roda no servidor de Auth **antes** de inserir em `auth.users` e vale para qualquer método (Google, e-mail etc.).

- Função: `public.hook_before_user_created(event jsonb)`, com `security definer` e `search_path = ''`. Devolve `{}` quando o e-mail (normalizado) está em `private.signup_allowlist`. Caso contrário devolve `{"error": {"http_code": 403, "message": "Cadastro restrito a usuários de teste autorizados."}}`. O app já mostra "Conta não liberada para testes".
- EXECUTE somente para `supabase_auth_admin`. Revogado de PUBLIC, anon e authenticated.
- A allowlist fica em `private` (fora da Data API). O `supabase_auth_admin` não recebe acesso à tabela, só à função.

**Ativação (manual, após aprovação. Nada disso é feito pelas migrations):**

1. Aplicar as migrations (seção seguinte).
2. Cadastrar as contas de teste (somente e-mails de testadores adultos que concordaram com o teste):
   ```sql
   insert into private.signup_allowlist (email, note) values ('testador@exemplo.com', 'QA fase 2.6');
   ```
3. *Authentication → Hooks → Before User Created* → Postgres function → `public.hook_before_user_created` → **Enable**.
4. Validar com uma conta **fora** da lista (deve ser recusada) e com uma conta **da** lista (deve entrar).
5. Somente depois disso, e com os demais requisitos do checklist jurídico, considerar o cadastro aberto ao público. Até lá, mantenha *Allow new users to sign up* conforme a política atual do projeto. Localmente, `supabase/config.toml` mantém `enable_signup = false` e o hook comentado.

Desativar: desligar o hook no painel. A função pode permanecer.

## GraphQL (`pg_graphql`) desativado

O EduSearch não usa GraphQL: nenhum código em `apps/web`, `apps/api` ou nas migrations o referencia. A imagem local do Supabase instala `pg_graphql` por padrão, e com ela toda tabela com SELECT para anon/authenticated aparece no schema GraphQL (lints `0026_pg_graphql_anon_table_exposed` e `0027_pg_graphql_authenticated_table_exposed`). O projeto remoto `edusearch-db` não tem a extensão.

- A migration `20261120013704_disable_unused_pg_graphql.sql` executa `drop extension if exists pg_graphql`. **Sem CASCADE**: se algo depender da extensão, ela falha em vez de apagar o objeto.
- `supabase/config.toml` expõe só `public` em `[api].schemas` (retirado `graphql_public`).
- GRANTs e políticas RLS **não mudam**. Os testes `test_table_grants_match_expected_matrix` e `test_policies_match_expected_set` fixam a matriz exata, e `test_pg_graphql_is_not_installed` confere a remoção.
- O Security Advisor continua bloqueando qualquer WARN/ERROR novo no CI.
- **Rollback** (só se GraphQL vier a ser adotado conscientemente): `create extension if not exists pg_graphql with schema graphql;` e devolver `graphql_public` a `[api].schemas`. Antes, revise quais tabelas ficarão visíveis no GraphQL.

## `public.rls_auto_enable()`

A função existe no projeto remoto (event trigger que liga o RLS em tabelas novas), mas não aparece nas migrations porque foi criada fora delas. Problemas apontados: EXECUTE padrão para PUBLIC/anon/authenticated (lints 0028/0029 quando é `security definer`) e possível `search_path` mutável (lint 0011).

Correção (`20261119120300_harden_rls_auto_enable.sql`), condicional e idempotente:

- revoga EXECUTE de PUBLIC, anon e authenticated. **O mecanismo continua funcionando:** event triggers são disparados pelo servidor e não conferem EXECUTE de quem executa o DDL. Isso foi verificado no PostgreSQL 17: uma tabela criada por um papel sem EXECUTE recebeu RLS. A suíte também cobre o caso em `test_rls_auto_enable_hardening_migration`;
- fixa `search_path = ''`.

**Antes de aplicar no remoto**, confira o corpo e os privilégios atuais:

```sql
select p.prosecdef, p.proconfig, p.proacl, pg_get_functiondef(p.oid)
  from pg_proc p where p.oid = 'public.rls_auto_enable()'::regprocedure;
select evtname, evtevent, evtenabled from pg_event_trigger where evtfoid = 'public.rls_auto_enable()'::regprocedure;
```

Se o corpo usar nomes **sem schema** (fora de `pg_catalog`), troque `search_path = ''` por `search_path = pg_catalog, public` na migration antes de aplicar. Mesmo com o event trigger, toda migration do EduSearch liga o RLS explicitamente.

## Aplicação controlada no projeto remoto

Nenhum passo abaixo foi executado. Cada um exige aprovação explícita do responsável.

**Pré-requisitos**

1. PR aprovado e CI do backend verde (migrations aplicadas em banco limpo, testes de RLS e lints do Security Advisor).
2. Backup recente: *Database → Backups* (ou `supabase db dump --linked -f backup.sql` + `--data-only`), guardado fora do repositório.
3. Conferir `rls_auto_enable()` (seção anterior) e o Security Advisor atual (capturar a lista de alertas existentes para comparação).

**Aplicar**

```bash
supabase login                      # conta com acesso ao projeto edusearch-db
supabase link --project-ref pgltvnwdvatyihrozlvn
supabase db push --dry-run          # deve listar exatamente as 5 migrations da 2.6A
supabase db push                    # somente após a aprovação
```

**Validar**

1. *Advisors → Security Advisor*: nenhum alerta novo relacionado a `profiles`, `account_roles`, `subjects`, `student_profiles`, `teacher_profiles`, `teacher_subjects`, `private.*` ou `hook_before_user_created`. Os alertas de `rls_auto_enable` devem sumir. Confirme também que `select extname from pg_extension where extname = 'pg_graphql'` continua vazio.
2. SQL:
   ```sql
   select relname, relrowsecurity from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r' order by 1;  -- todas true
   select count(*) from public.profiles;                                       -- = nº de contas
   select grantee, table_name, privilege_type from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated') order by 1, 2;
   ```
3. Com um usuário de teste: `GET /v1/me` pela API retorna o próprio perfil. Pela Data API, `select` em `profiles` com a chave publicável e o JWT do usuário retorna uma linha, e sem JWT (anon) retorna erro de permissão.

**Rollback**

1. Se o problema for só de política ou privilégio, prefira uma migration corretiva nova.
2. Rollback completo (apaga as tabelas e os dados de perfil, sem tocar em `auth.users`): restaurar backup **ou** executar `supabase/rollback/20261119_fase_2_6a_down.sql` no SQL Editor. O script também remove as versões de `supabase_migrations.schema_migrations`.
3. Desligar o hook no painel, se estiver ativo, **antes** de remover a função.

## Ambiente local e CI

- **CI** (`.github/workflows/backend-ci.yml`): `supabase db start` (imagem oficial, só o Postgres) cria o banco do zero com as migrations, depois roda `supabase db lint`, os testes `apps/api/tests/db` e os lints do Security Advisor ([splinter](https://github.com/supabase/splinter), commit fixo e SHA-256 conferido). Depois `supabase db reset` recria tudo e repete os testes. Sem credenciais reais.
- **Local com Docker:** `supabase db start`, depois `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pytest tests/db` em `apps/api`.
- **Local sem Docker:** qualquer PostgreSQL 15+ **descartável** e vazio. Os testes aplicam `apps/api/tests/db/supabase_shim.sql` (papéis, `auth.users`, `auth.uid()` e os privilégios padrão do Supabase) e as migrations. O shim existe só para testes.
