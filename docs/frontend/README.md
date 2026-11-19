# Frontend — EduSearch

Documentação da frente de frontend (Fase 2): design system, website institucional e aplicativo PWA.

| Documento | Conteúdo |
| --------- | -------- |
| [design-system.md](design-system.md) | Tokens, temas, componentes e regras de uso do `@edusearch/ui` |
| [app.md](app.md) | Telas, navegação, dados de demonstração e PWA do `apps/web` |
| [calendar-meet-payments.md](calendar-meet-payments.md) | **Fase 2.3**: calendário, aula online, checkout Pix, comissão de 15% e incentivos — o que é demonstrativo e o que depende do backend |
| [demo-journey.md](demo-journey.md) | **Jornada de demonstração ponta a ponta**: roteiro para avaliadores, regras de reserva, matching, estado e testes |
| [../legal/termos-de-uso.md](../legal/termos-de-uso.md), [../legal/politica-de-privacidade.md](../legal/politica-de-privacidade.md), [../legal/checklist-publicacao.md](../legal/checklist-publicacao.md) | **Fase 2.5.1**: Termos de Uso e Política de Privacidade (rascunhos para revisão jurídica), checklist de publicação e decisões sobre menores. Páginas públicas geradas no website: `/termos-de-uso` e `/politica-de-privacidade` |
| [onboarding.md](onboarding.md) | **Fase 2.5**: entrada única (Google + demonstração), primeiro acesso e onboarding de aluno e professor sem persistência, pendências de backend |
| [auth-integration.md](auth-integration.md) | **Fase 2.4**: login real com Google Identity Services + Supabase Auth (sem redirecionar para o Supabase), conta do usuário, configurações pendentes, segurança e testes |
| [api-integration.md](api-integration.md) | Camada de dados, cliente HTTP e **necessidades de integração** com a API |
| [qa.md](qa.md) | Resultado de build, typecheck, acessibilidade, responsividade e CI |

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
| `VITE_SUPABASE_URL` | — | `https://pgltvnwdvatyihrozlvn.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | — | Chave **publicável** do Supabase (nunca a service_role) |
| `VITE_GOOGLE_CLIENT_ID` | — | Client ID Web do Google (nunca o Client Secret). Com as três variáveis, o login real é ativado |
| `VITE_LEGAL_TERMS_URL` / `VITE_LEGAL_PRIVACY_URL` | — | Links (https) dos documentos jurídicos — definir **só quando publicados** |
| `VITE_STAGE_GOOGLE_AUTH` / `VITE_STAGE_EMAIL_AUTH` / `VITE_STAGE_EMAIL_SIGNUP` | `testing` / `off` / `off` | Estágio de cada recurso (`off`, `testing`, `production`) — ver [auth-integration.md](auth-integration.md) |
| `VITE_APP_URL` (website) | — | Se definida, o website mostra o link "Ver demonstração" |

> O `.env.example` da raiz ainda cita `VITE_API_URL` (nome antigo). O app passou a usar `VITE_API_BASE_URL`. A raiz não foi alterada porque está fora do escopo desta frente.

## O que é demonstrativo

Tudo que depende de backend é **simulado no navegador** e identificado na interface (faixa "Modo demonstração", avisos contextuais e selos "Perfil fictício"):

- Entrada única (`/`): login com Google **real apenas no ambiente restrito de testes** (GIS + Supabase, área `/conta`); sem as variáveis, o botão fica desabilitado. Não há login por e-mail e senha. A demonstração continua acessível sem login — ver [onboarding.md](onboarding.md).
- Matching pedagógico: regras locais simples, **sem IA (Gemini não integrado)**.
- Agendamento, cancelamento, perfil, especialidades e disponibilidade: simulados no navegador e mantidos no `sessionStorage` da aba até sair da demonstração (ver [demo-journey.md](demo-journey.md)).
- Link da videochamada: **Google Meet não integrado** (botão "Entrar na aula" desabilitado).
- Pagamentos, split e repasse: **AbacatePay não integrado**; nenhum valor é cobrado. A comissão de 10% é hipótese.
- Professores, alunos, valores e anotações são **fictícios**. Não há avaliações (estrelas) inventadas.

A única chamada real disponível é `GET /health`, acessível em *Configurações → Verificar conexão*.
