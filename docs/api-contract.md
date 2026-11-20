# Contrato da API EduSearch

Contrato oficial entre o frontend (`apps/web`) e a API FastAPI (`apps/api`). Quando houver divergência com [frontend/api-integration.md](frontend/api-integration.md), **este documento prevalece**. O esquema OpenAPI gerado fica em `/openapi.json` e a documentação interativa em `/docs`.

| Status | Significado |
| ------ | ----------- |
| **Implementado** | Existe na API, com testes |
| **Planejado** | Contrato proposto para revisão. Não implementado e não integrado no frontend |

## Convenções

- **Versão no caminho:** `/v1/...`. Mudança incompatível = nova versão. `/health` fica fora do versionamento.
- **JSON** em UTF-8, campos em `snake_case`.
- **Datas:** ISO 8601 com fuso (UTC), ex.: `2026-11-19T12:00:00Z`.
- **Dinheiro:** centavos inteiros (BRL), campos `*_cents`.
- **Identificadores:** UUID (usuários) e `slug` (disciplinas).
- **Campos desconhecidos no corpo são recusados (422).** Isso impede enviar `id`, `status`, `roles` etc. por engano ou de propósito.
- **Cache:** respostas de `/v1/*` vêm com `Cache-Control: no-store`.

## Autenticação

```
Authorization: Bearer <access_token do Supabase Auth>
```

- O token é o **access token da sessão do Supabase** (`session.access_token`). **Nunca** o ID token do Google.
- A API valida a assinatura com o JWKS do projeto (`/auth/v1/.well-known/jwks.json`, ES256), além de `iss = https://<ref>.supabase.co/auth/v1`, `aud = authenticated`, `exp`/`iat`, `sub` (UUID) e `role = authenticated`. `HS256` e `none` são recusados. O JWKS fica em cache por até 10 min.
- A identidade é **sempre** o `sub` do token. A API ignora ids enviados em query, corpo ou cabeçalhos.
- Papéis e privilégios vêm do banco (`account_roles`), **nunca** de `user_metadata`/`app_metadata` do token.
- Usuários anônimos (`is_anonymous = true`) recebem 403.
- No banco, cada requisição roda como `authenticated` com as claims do token, então o RLS também protege a API.

## Erros

Todo erro segue o mesmo formato. `detail` é texto em português para exibir ao usuário (o `apiRequest` do frontend já usa esse campo), e `code` é estável para decisões no código.

```json
{ "detail": "Sua sessão expirou. Entre novamente.", "code": "token_expired" }
```

Erros de validação (422) acrescentam `errors` e **não** ecoam o valor enviado:

```json
{
  "detail": "Dados inválidos.",
  "code": "validation_error",
  "errors": [{ "loc": ["body", "status"], "msg": "Extra inputs are not permitted", "type": "extra_forbidden" }]
}
```

| HTTP | `code` | Quando |
| ---- | ------ | ------ |
| 401 | `not_authenticated` | Sem cabeçalho `Authorization` (`WWW-Authenticate: Bearer`) |
| 401 | `invalid_token` | Cabeçalho malformado, assinatura inválida, emissor/público errado, `kid` desconhecido, claims ausentes |
| 401 | `token_expired` | `exp` vencido (o front renova a sessão ou leva ao login) |
| 403 | `forbidden` | Recurso de outro usuário |
| 403 | `role_required` | O papel persistido não permite a ação |
| 403 | `anonymous_not_allowed` | Sessão anônima |
| 403 | `account_suspended` | Conta suspensa pelo servidor |
| 404 | `profile_not_found` | Token válido, mas a conta não tem perfil (ex.: conta removida) |
| 404 | `not_found` | Rota inexistente |
| 422 | `validation_error` | Corpo inválido ou com campos não permitidos |
| 422 | `avatar_host_not_allowed` | Foto fora dos hosts permitidos |
| 500 | `internal_error` | Erro inesperado (sem detalhes internos na resposta) |
| 503 | `auth_unavailable` | JWKS indisponível (`Retry-After`) |
| 503 | `auth_not_configured` | `API_SUPABASE_URL` ausente no servidor |
| 503 | `database_unavailable` | Banco fora do ar, pool esgotado ou tempo limite (`Retry-After`) |

## CORS

As origens são exatas e configuradas em `API_CORS_ORIGINS`: local `http://localhost:5173`, `:5174` e `:5190`; produção `https://app.edusearch.com.br` (somente após aprovação). Curingas não são aceitos. A API libera os métodos `GET`, `PUT` e `OPTIONS` e os cabeçalhos `Authorization` e `Content-Type`, sem cookies (`allow_credentials = false`).

---

## Implementado

### `GET /health`

Público. Não consulta o banco nem expõe configuração.

```json
200 { "status": "ok", "service": "edusearch-api", "version": "0.3.0" }
```

### `GET /v1/me`

Perfil do usuário autenticado, com **somente** os dados dele.

```json
200 {
  "id": "6f1c…-uuid",
  "email": "pessoa@example.com",
  "display_name": "Pessoa Fictícia",
  "avatar_url": "https://lh3.googleusercontent.com/a/…",
  "status": "onboarding",
  "roles": ["student"],
  "created_at": "2026-11-19T12:00:00Z",
  "updated_at": "2026-11-19T12:00:00Z"
}
```

| Campo | Tipo | Origem |
| ----- | ---- | ------ |
| `id` | UUID | `profiles.id` (= `auth.users.id` = `sub`) |
| `email` | string \| null | Claim `email` do token verificado (não fica em `profiles`) |
| `display_name` | string (1–80) | `profiles` |
| `avatar_url` | string \| null | `profiles` (https) |
| `status` | `onboarding` \| `active` \| `suspended` | `profiles.status`, definido pelo servidor |
| `roles` | `("student" \| "teacher")[]` | `account_roles`, definidos pelo servidor (vazio no primeiro acesso) |
| `created_at`, `updated_at` | ISO 8601 | `profiles` |

Erros: 401, 403 (`anonymous_not_allowed`), 404 `profile_not_found`, 503.

**Uso no frontend (futuro):** substituir a preferência local de papel (`localStorage['edusearch-account-role:<id>']`): `roles = []` leva às boas-vindas.

### `PUT /v1/me/profile`

Atualiza os campos de apresentação do próprio perfil. É substituição completa desses dois campos: `avatar_url` omitido ou `null` remove a foto.

```json
{ "display_name": "Novo Nome", "avatar_url": "https://lh3.googleusercontent.com/a/…" }
```

| Campo | Regra |
| ----- | ----- |
| `display_name` | Obrigatório. Espaços nas pontas são removidos e espaços repetidos viram um só. Após a limpeza, 1–80 caracteres, sem caracteres de controle ou de direção (ex.: U+202E) |
| `avatar_url` | Opcional/null. `https`, até 2048 caracteres, sem espaços, credenciais ou porta diferente de 443. Host de `*.googleusercontent.com` ou do Storage do projeto (`API_AVATAR_ALLOWED_HOST_SUFFIXES`); fora disso, 422 `avatar_host_not_allowed` |
| Qualquer outro campo | **422** (`id`, `user_id`, `email`, `status`, `role`, `roles`, `verification_status`, `is_published`, `created_at`, `app_metadata` etc.) |

Resposta: `200` com o mesmo corpo de `GET /v1/me`, já atualizado. Erros: 401, 403 (`account_suspended`, `anonymous_not_allowed`), 404, 422, 503.

O banco reforça a regra: `authenticated` só tem `UPDATE (display_name, avatar_url)` em `profiles`, e somente na própria linha.

---

## Implementado na Fase 2.6B: onboarding

### `POST /v1/me/roles`: escolher papel

```json
{ "role": "student" }
```

- Aceita **somente** `student` ou `teacher`. Qualquer outro valor ou campo extra devolve 422. Papéis administrativos nunca passam por aqui.
- **Idempotente:** devolve `201` quando o papel foi criado agora e `200` quando já existia. Em ambos os casos o corpo é o `MeResponse` atualizado.
- Uma conta pode ter os dois papéis. Escolher `teacher` **não** aprova nem publica nada.
- O papel é gravado pelo servidor, que conecta como `edusearch_api`. O RLS limita o INSERT ao `sub` do JWT verificado.
- Erros: 401, 403 `account_suspended`, 404 `profile_not_found`, 422, 503.

### Estado do cadastro em `GET /v1/me`

`MeResponse` ganhou o campo `onboarding`. A mudança é aditiva e compatível.

```json
"onboarding": {
  "student": { "status": "completed" },
  "teacher": { "status": "pending", "verification_status": null, "is_published": false }
}
```

| Valor | Significado |
| ----- | ----------- |
| `student`/`teacher` = `null` | A conta não tem esse papel |
| `status: "pending"` | Papel escolhido, cadastro ainda não salvo |
| `status: "completed"` | Cadastro salvo com sucesso no servidor |
| `verification_status` | `pending` \| `approved` \| `rejected`, definido pelo servidor (`null` até salvar) |
| `is_published` | Definido pelo servidor. Exige aprovação |

### `GET` e `PUT /v1/me/student-profile`: cadastro do aluno

Exige o papel `student` persistido; sem ele, a resposta é 403 `role_required`. Os dados são **privados**: nenhum endpoint os expõe a terceiros. O `PUT` cria ou substitui o cadastro inteiro numa única transação, e salvar significa cadastro concluído.

```json
{
  "learning_goal": "Passar no ENEM",          // 3–200, obrigatório
  "education_level": "medio",                 // fundamental | medio | pre-vestibular | graduacao | concursos | livre
  "subjects": ["matematica", "fisica"],       // 1–20 slugs de /v1/subjects, sem repetição
  "difficulty_areas": ["exercicios"],         // 0–5: base | exercicios | pratica | fala | organizacao
  "preferred_weekdays": ["seg", "qua"],       // 1–7: seg … dom
  "preferred_periods": ["noite"],             // 1–3: manha | tarde | noite
  "preferred_modality": "online",             // online | presencial | hibrido
  "budget_min_cents": 5000,                   // ao menos um dos dois; min <= max
  "budget_max_cents": 8000
}
```

A resposta tem o mesmo formato, mais `created_at` e `updated_at`. O `GET` devolve 404 `student_profile_not_found` enquanto nada foi salvo. Uma disciplina inexistente ou inativa resulta em 422 `unknown_subject`, e nada é gravado.

Faixas de valor do formulário (o frontend converte, sem perda):

| Faixa na tela | `budget_min_cents` | `budget_max_cents` |
| ------------- | ------------------ | ------------------ |
| Até R$ 50 | `null` | `5000` |
| R$ 50 a R$ 80 | `5000` | `8000` |
| R$ 80 a R$ 120 | `8000` | `12000` |
| Acima de R$ 120 | `12000` | `null` |

### `GET` e `PUT /v1/me/teacher-profile`: cadastro do professor

Exige o papel `teacher` persistido. O `PUT` cria ou substitui o cadastro e as disciplinas. As disciplinas mantidas conservam seus níveis; as removidas saem.

```json
{
  "headline": null,                           // opcional, 3–120
  "bio": "…",                                 // 30–600, obrigatório
  "subjects": ["matematica"],                 // 1–20 slugs
  "specialties": "ENEM, cálculo I",           // opcional, <= 200 ("" vira null)
  "academic_background": "Licenciatura …",    // 3–200
  "experience": "3-5",                        // menos-1 | 1-3 | 3-5 | 5-mais
  "teaching_methods": ["exercicios"],         // 1–5: pratica | teorica | exercicios | conversacao | projetos
  "methodology": "Como são minhas aulas…",    // opcional, <= 400
  "price_cents": 8000,                        // 2000–100000
  "lesson_durations_minutes": [45, 60],       // 1–4 de: 30 | 45 | 60 | 90
  "modality": "online",
  "available_weekdays": ["ter", "qui"],       // 1–7 (visão geral; horários detalhados virão da agenda)
  "available_periods": ["tarde", "noite"]     // 1–3
}
```

A resposta traz o corpo enviado mais os campos **somente leitura**:

- `lesson_duration_minutes`: a duração principal, que é a menor das oferecidas;
- `verification_status`: `pending` no primeiro envio;
- `is_published` (`false`) e `published_at`;
- `created_at` e `updated_at`.

Enviar `verification_status`, `is_published`, `published_at`, `verified_at` ou `lesson_duration_minutes` devolve **422**. Salvar de novo **não** altera a verificação: um perfil rejeitado continua rejeitado, e um aprovado continua aprovado. Revisar a reanálise após edição de um perfil aprovado fica para uma fase futura. O `GET` devolve 404 `teacher_profile_not_found` enquanto nada foi salvo.

### `GET /v1/subjects`: catálogo

Público, sem token. Devolve `[{ "slug": "matematica", "name": "Matemática" }, …]` com as disciplinas ativas, em ordem alfabética. Roda no banco como `anon`.

### Novos códigos de erro

| HTTP | `code` | Quando |
| ---- | ------ | ------ |
| 403 | `role_required` | Cadastro de aluno/professor sem o papel correspondente |
| 404 | `student_profile_not_found` / `teacher_profile_not_found` | Papel escolhido, cadastro ainda não salvo |
| 422 | `unknown_subject` | Slug inexistente ou inativo |

CORS: `GET`, `POST`, `PUT` e `OPTIONS` (somente os métodos implementados).

### Ainda sem contrato

Busca de professores, matching (Gemini), horários, agendamento, Pix e Google Agenda/Meet continuam como necessidades em [frontend/api-integration.md](frontend/api-integration.md). Esta fase não os define.

## Histórico

| Versão | Fase | Mudanças |
| ------ | ---- | -------- |
| 0.3.0 | 2.6B | `POST /v1/me/roles`, cadastros de aluno e professor, `GET /v1/subjects`, `onboarding` em `/v1/me` |
| 0.2.0 | 2.6A | `GET /v1/me`, `PUT /v1/me/profile`, formato de erro, autenticação JWT (JWKS/ES256) |
| 0.1.0 | 1 | `GET /health` |
