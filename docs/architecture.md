# Arquitetura — EduSearch

Visão breve da arquitetura aprovada. Princípio central: **custo fixo inicial de R$ 0**, usando apenas planos gratuitos e serviços open source.

```text
                ┌────────────────────┐        ┌────────────────────┐
  Visitante ──▶ │  Website público   │        │  App React (web)   │ ◀── Aluno / Professor
                │  apps/website      │        │  apps/web          │
                │  Cloudflare Pages  │        │  Cloudflare Pages  │
                └────────────────────┘        └─────────┬──────────┘
                                                        │ HTTPS / JSON
                                              ┌─────────▼──────────┐
                                              │  API FastAPI       │
                                              │  apps/api          │
                                              └─┬──────┬──────┬────┘
                         ┌──────────────────────┘      │      └───────────────────┐
                ┌────────▼─────────┐  ┌────────────────▼───┐  ┌──────────────────▼──┐
                │ Supabase         │  │ Google Gemini API  │  │ Google Calendar/Meet│
                │ PostgreSQL+Auth  │  │ (matching)         │  │ (agenda e aulas)    │
                │ (Google OAuth)   │  └────────────────────┘  └─────────────────────┘
                └──────────────────┘          ┌────────────────────┐
                                              │ AbacatePay         │
                                              │ (Pix, split)       │
                                              └────────────────────┘
```

## Componentes

| Componente            | Tecnologia                            | Responsabilidade                                                    |
| --------------------- | ------------------------------------- | ------------------------------------------------------------------- |
| Website público       | React, Vite, TypeScript, Tailwind CSS | Landing page institucional, apresentação da proposta                |
| Aplicativo React      | React, Vite, TypeScript, Tailwind CSS | Experiência de alunos e professores (busca, perfis, agenda)         |
| API                   | Python 3.13+, FastAPI, Pydantic       | Regras de negócio, orquestração das integrações, validação de dados |
| Banco de dados        | Supabase PostgreSQL                   | Usuários, professores, aulas, pagamentos                            |
| Autenticação          | Supabase Auth + Google OAuth          | Login com Google; a API valida o JWT emitido pelo Supabase          |
| Matching pedagógico   | Google Gemini API                     | Interpretar o objetivo do aluno e ranquear professores compatíveis  |
| Agenda e aulas        | Google Calendar + Google Meet         | Criação de eventos e links de aula                                  |
| Pagamentos            | AbacatePay (Pix)                      | Cobrança, split da comissão e repasse aos professores               |

Segredos de integrações ficam **somente na API** (variáveis de ambiente); o frontend usa apenas chaves públicas.

## Status

### Implementado (Fase 1)

- Monorepo pnpm com `apps/website`, `apps/web` e `apps/api`.
- Website institucional responsivo, pronto para Cloudflare Pages (`apps/website/wrangler.toml`).
- Base do aplicativo React com tela "em desenvolvimento".
- API FastAPI com `GET /health`, CORS para desenvolvimento local e testes automatizados.

### Fase 2.6A — fundação do backend (em revisão)

- Migrations versionadas (`supabase/migrations/`): perfis, papéis, alunos, professores e disciplinas, com RLS e privilégios mínimos — ver [database-design.md](database-design.md). **Ainda não aplicadas no projeto remoto.**
- FastAPI modular (routers, schemas, services, repositories, auth, config) com validação criptográfica do JWT do Supabase (JWKS, ES256) e consultas sob RLS (`SET LOCAL ROLE authenticated`).
- `GET /v1/me` e `PUT /v1/me/profile` — ver [api-contract.md](api-contract.md).
- Hook *Before User Created* (allowlist) preparado, **não** ativado.
- CI do backend (`.github/workflows/backend-ci.yml`): lint, testes, banco limpo, RLS e Security Advisor.

### Planejado (próximas fases)

- Aplicação controlada das migrations no Supabase e ativação do hook de admissão (com aprovação).
- Hospedagem da API e contratos de onboarding (`/v1/me/roles`, perfis de aluno e professor).
- Integração Gemini para o matching pedagógico.
- Google Calendar/Meet para agendamento e aulas.
- AbacatePay para Pix, split e repasse.
- Hospedagem gratuita da API (provedor compatível com FastAPI a definir).

Nenhuma dessas integrações está configurada no código atual.
