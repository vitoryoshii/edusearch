<div align="center">

# EduSearch

**Encontre o professor certo para você.**

Marketplace educacional inteligente que conecta estudantes a professores por meio de recomendações personalizadas.

[![HackBrasil 2026](https://img.shields.io/badge/HackBrasil-2026-146A7A)](#participação-no-hackbrasil-2026)
[![Trilha 03](https://img.shields.io/badge/Trilha_03-Acesso_à_Educação-14836E)](#participação-no-hackbrasil-2026)
[![Status](https://img.shields.io/badge/status-em_desenvolvimento-102E46)](#status-do-desenvolvimento)
[![Licença MIT](https://img.shields.io/badge/licença-MIT-146A7A)](LICENSE)

</div>

---

## Sumário

1. [Sobre o projeto](#sobre-o-projeto)
2. [Problema identificado](#problema-identificado)
3. [Solução proposta](#solução-proposta)
4. [Público-alvo](#público-alvo)
5. [Diferenciais e inovação](#diferenciais-e-inovação)
6. [Funcionalidades planejadas](#funcionalidades-planejadas)
7. [Modelo de negócio](#modelo-de-negócio)
8. [Stack tecnológica](#stack-tecnológica)
9. [Arquitetura resumida](#arquitetura-resumida)
10. [Estrutura do repositório](#estrutura-do-repositório)
11. [Como executar localmente](#como-executar-localmente)
12. [Deploy do website (Cloudflare Pages)](#deploy-do-website-cloudflare-pages)
13. [Status do desenvolvimento](#status-do-desenvolvimento)
14. [Participação no HackBrasil 2026](#participação-no-hackbrasil-2026)
15. [Licença](#licença)

---

## Sobre o projeto

O **EduSearch** é um marketplace educacional que conecta estudantes a professores com base em recomendações personalizadas. Em vez de escolher um professor apenas por disciplina ou preço, o estudante descreve o que precisa aprender e a plataforma, com apoio de inteligência artificial, sugere professores compatíveis com sua **necessidade de aprendizagem, disponibilidade, orçamento e metodologia de ensino preferida**.

## Problema identificado

- Encontrar um professor particular adequado ainda depende muito de indicação pessoal, o que limita o acesso de quem não tem essa rede.
- As buscas existentes costumam filtrar apenas por disciplina e preço, ignorando objetivo, nível e forma de aprender do estudante.
- Professores autônomos têm dificuldade em ser encontrados pelos alunos certos e em organizar agenda e recebimentos.
- Uma escolha ruim custa tempo e dinheiro e desmotiva o estudante.

## Solução proposta

Uma plataforma em que:

1. O estudante conta o que deseja aprender, seu objetivo, disponibilidade e orçamento.
2. Um **matching pedagógico com IA** recomenda professores compatíveis.
3. O estudante agenda a aula, que acontece online.
4. O pagamento é feito via Pix, com repasse automático ao professor.
5. O estudante acompanha sua evolução ao longo das aulas.

## Público-alvo

- **Estudantes** do ensino fundamental, médio, pré-vestibular, graduação e concursos, além de adultos em requalificação profissional.
- **Professores** particulares e autônomos que querem alcançar alunos compatíveis com sua especialidade e metodologia.
- **Responsáveis** que buscam apoio educacional para filhos e dependentes.

## Diferenciais e inovação

- **Matching pedagógico inteligente:** recomendação baseada em necessidades reais de aprendizagem, não apenas em disciplina.
- **Segurança e transparência:** perfis com informações e credenciais dos professores; regras claras de pagamento e repasse.
- **Aulas online:** agendamento integrado ao calendário e link de videochamada.
- **Aprendizado personalizado:** acompanhamento da evolução do estudante.
- **Custo inicial zero:** arquitetura construída sobre planos gratuitos, viabilizando o projeto desde o primeiro dia.

## Funcionalidades planejadas

> ⚠️ As funcionalidades abaixo representam o **escopo planejado** e **ainda não estão implementadas**. Veja [Status do desenvolvimento](#status-do-desenvolvimento).

| Funcionalidade                                  | Status       |
| ----------------------------------------------- | ------------ |
| Busca de professores por disciplina e objetivo  | Planejado    |
| Matching pedagógico com IA (Google Gemini)      | Planejado    |
| Perfis de professores com credenciais           | Planejado    |
| Agendamento de aulas                            | Planejado    |
| Aulas online com Google Meet                    | Planejado    |
| Login com Google                                | Planejado    |
| Acompanhamento do aprendizado                   | Planejado    |
| Pagamentos Pix com AbacatePay                   | Planejado    |
| Split de pagamento e repasse aos professores    | Planejado    |

## Modelo de negócio

- **Cadastro gratuito** para estudantes e professores no marketplace.
- **Monetização prevista por comissão** sobre as aulas realizadas pela plataforma.
- **Hipótese inicial de comissão: 10%** por aula (a ser validada).
- **Split de pagamentos via AbacatePay:** no pagamento Pix, a comissão é separada automaticamente da parte do professor.
- **Repasse aos professores** conforme as condições (prazos e tarifas) do provedor de pagamento.

## Stack tecnológica

| Camada              | Tecnologias                                                      |
| ------------------- | ---------------------------------------------------------------- |
| Website e frontend  | React, Vite, TypeScript, Tailwind CSS                            |
| Backend             | Python 3.13+, FastAPI, Pydantic                                  |
| Banco e autenticação| Supabase PostgreSQL, Supabase Auth com Google OAuth *(planejado)*|
| Inteligência artificial | Google Gemini API *(planejado)*                              |
| Agenda e aulas      | Google Calendar e Google Meet *(planejado)*                      |
| Pagamentos          | AbacatePay — Pix e split *(planejado)*                           |
| Hospedagem          | Cloudflare Pages (website); hospedagem gratuita compatível com FastAPI (API, a definir) |

**Restrição de projeto:** custo fixo inicial de **R$ 0**, sem contratação de serviços pagos.

## Arquitetura resumida

```text
Website (Cloudflare Pages) ─┐
                            │
App React (web) ──HTTPS──▶ API FastAPI ──▶ Supabase (PostgreSQL + Auth/Google)
                                       ├──▶ Google Gemini (matching)
                                       ├──▶ Google Calendar / Meet
                                       └──▶ AbacatePay (Pix + split)
```

Detalhes em [`docs/architecture.md`](docs/architecture.md).

## Estrutura do repositório

```text
edusearch/
├── apps/
│   ├── website/        # Website institucional (React + Vite + TS + Tailwind)
│   ├── web/            # Base do aplicativo React (em desenvolvimento)
│   └── api/            # API Python/FastAPI
├── assets/
│   └── branding/       # Identidade visual (paleta; logo oficial pendente)
├── docs/
│   └── architecture.md # Arquitetura resumida
├── .env.example        # Variáveis de ambiente de exemplo (sem segredos)
├── .gitignore
├── LICENSE             # MIT
├── package.json        # Scripts do monorepo
└── pnpm-workspace.yaml
```

## Como executar localmente

### Pré-requisitos

- Node.js 20+ e [pnpm](https://pnpm.io) 10 (ou `npx pnpm@10`)
- Python 3.13+

### Website e frontend

```bash
pnpm install

# Website institucional → http://localhost:5173
pnpm dev:website

# Aplicativo (base) → http://localhost:5174
pnpm dev:web

# Builds de produção (inclui verificação de tipos)
pnpm build:website
pnpm build:web
```

### Backend (API)

```bash
cd apps/api
python -m venv .venv
# Windows: .venv\Scripts\activate   |   Linux/macOS: source .venv/bin/activate
pip install -e ".[dev]"

uvicorn app.main:app --reload --port 8000   # http://localhost:8000/health
pytest                                      # testes
ruff check .                                # lint
```

Variáveis de ambiente: copie `.env.example` e ajuste conforme necessário. Nunca versione arquivos `.env`.

## Deploy do website (Cloudflare Pages)

O website é estático e roda no **plano gratuito** do Cloudflare Pages.

**Opção A — integração com o GitHub (recomendada)**

1. No painel da Cloudflare: *Workers & Pages → Create → Pages → Connect to Git* e selecione `vitoryoshii/edusearch`.
2. Configure:
   - **Framework preset:** None
   - **Build command:** `npx pnpm@10 install --frozen-lockfile && npx pnpm@10 build:website`
   - **Build output directory:** `apps/website/dist`
   - **Variável de ambiente:** `NODE_VERSION=22`
3. Salve. Cada push na `main` gera um novo deploy.

**Opção B — deploy manual via CLI**

```bash
pnpm build:website
npx wrangler login
npx wrangler pages deploy apps/website/dist --project-name edusearch
```

A configuração está em [`apps/website/wrangler.toml`](apps/website/wrangler.toml) e os cabeçalhos de segurança em `apps/website/public/_headers`.

## Status do desenvolvimento

**Fase atual: Fase 1 — Fundação do projeto.**

| Item                                                        | Status            |
| ----------------------------------------------------------- | ----------------- |
| Monorepo (pnpm workspaces)                                  | ✅ Implementado   |
| Website institucional responsivo                            | ✅ Implementado   |
| Base do aplicativo React (tela "em desenvolvimento")        | ✅ Implementado   |
| API FastAPI com `GET /health` e CORS de desenvolvimento     | ✅ Implementado   |
| Testes automatizados do `/health`                           | ✅ Implementado   |
| Configuração de deploy do website no Cloudflare Pages       | ✅ Preparado      |
| Logo e mockups oficiais no repositório                      | ⏳ Pendente       |
| Banco, autenticação, matching, agenda, pagamentos           | 🗓️ Próximas fases |

## Participação no HackBrasil 2026

O EduSearch é um projeto independente desenvolvido para o **HackBrasil 2026**, na **Trilha 03 — Acesso à Educação**. Todo o código deste repositório foi criado especificamente para o evento, utilizando apenas dependências open source.

## Licença

Distribuído sob a licença [MIT](LICENSE). Copyright (c) 2026 Equipe EduSearch.
