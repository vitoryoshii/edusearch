# Frontend — EduSearch

Documentação da frente de frontend (Fase 2): design system, website institucional e aplicativo PWA.

| Documento | Conteúdo |
| --------- | -------- |
| [design-system.md](design-system.md) | Tokens, temas, componentes e regras de uso do `@edusearch/ui` |
| [app.md](app.md) | Telas, navegação, dados de demonstração e PWA do `apps/web` |
| [api-integration.md](api-integration.md) | Camada de dados, cliente HTTP e **necessidades de integração** com a API |
| [qa.md](qa.md) | Resultado de build, typecheck, acessibilidade e responsividade |

## Estrutura

```text
packages/ui/          # @edusearch/ui — tokens (theme.css) e componentes React compartilhados
apps/website/         # Landing page institucional (usa @edusearch/ui)
apps/web/             # Aplicativo PWA (aluno e professor), dados de demonstração
docs/frontend/        # Esta documentação e capturas de tela
```

## Executar

```bash
pnpm install
pnpm dev:website     # http://localhost:5173
pnpm dev:web         # http://localhost:5174
pnpm typecheck       # todos os pacotes
pnpm build           # todos os pacotes
```

Variáveis públicas do app: copie `apps/web/.env.example` para `apps/web/.env`.

| Variável | Padrão | Uso |
| -------- | ------ | --- |
| `VITE_API_BASE_URL` | `http://localhost:8000` | URL da API FastAPI |
| `VITE_DATA_SOURCE` | `mock` | `mock` (demonstração) ou `api` |
| `VITE_APP_URL` (website) | — | Se definida, o website mostra o link "Ver demonstração" |

> O `.env.example` da raiz ainda cita `VITE_API_URL` (nome antigo). O app passou a usar `VITE_API_BASE_URL`. A raiz não foi alterada porque está fora do escopo desta frente.

## O que é demonstrativo

Tudo que depende de backend é **simulado no navegador** e identificado na interface (faixa "Modo demonstração", avisos contextuais e selos "Perfil fictício"):

- Login e cadastro (validam o formulário, não autenticam). Login com Google: **não integrado**.
- Matching pedagógico: regras locais simples, **sem IA (Gemini não integrado)**.
- Agendamento, cancelamento, perfil, especialidades e disponibilidade: estado em memória, perdido ao recarregar.
- Link da videochamada: **Google Meet não integrado** (botão "Entrar na aula" desabilitado).
- Pagamentos, split e repasse: **AbacatePay não integrado**; nenhum valor é cobrado. A comissão de 10% é hipótese.
- Professores, alunos, valores e anotações são **fictícios**. Não há avaliações (estrelas) inventadas.

A única chamada real disponível é `GET /health`, acessível em *Configurações → Verificar conexão*.
