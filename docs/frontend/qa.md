# QA — frontend

Executado em 17/11/2026 sobre os builds de produção (`vite preview`).

## Build e tipos

| Verificação | Resultado |
| ----------- | --------- |
| `pnpm -r typecheck` (ui, website, web) | ✅ sem erros (TypeScript 7.0.2, `strict`) |
| `pnpm build:website` | ✅ |
| `pnpm build:web` | ✅ |
| Lint | ⚠️ **Não há linter configurado** no monorepo. Não foi adicionado nesta fase: `typescript-eslint` ainda não tem compatibilidade confirmada com o TypeScript 7. Recomendado como próximo passo. |

## Acessibilidade (axe-core 4.14, regras WCAG 2.0/2.1/2.2 A e AA)

| Escopo | Resultado |
| ------ | --------- |
| App: 22 rotas × 375px e 1440px, mais 3 telas no tema escuro | ✅ **0 violações** |
| Website: 375px e 1440px | ✅ **0 violações** |

Problemas encontrados e corrigidos durante o QA:

- Contraste de `fg-muted` sobre `surface-muted` e `soft` (4,25–4,34:1): token escurecido para `#5B6B7F`.
- Nome acessível do menu da conta diferente do texto visível (WCAG 2.5.3): `Dropdown` ganhou `triggerHasText`.
- Dias sem horário com `opacity` (2,3:1): substituído por borda tracejada e cor `fg-muted`.

Verificações manuais incluídas no código: navegação por teclado em abas, menus e diálogos; foco visível; "pular para o conteúdo"; foco movido ao trocar de tela; `prefers-reduced-motion`; alvos de toque ≥ 44px.

## Responsividade (375, 768 e 1440 px)

- 66 renderizações do app e 5 do website: **sem rolagem horizontal** e **sem erros de console**.
- Corrigidos no QA: estouro em 375px causado por *fieldset* com `min-width: min-content` e por grid sem `grid-cols-1`; avatar duplicado no mobile (conflito de `display`); abas cortadas em 375px.

## PWA

- Manifest válido (nome, `theme_color #146A7A`, 3 ícones).
- Service Worker validado no Chrome: `activated`, controla a página e cacheia apenas `index.html`, manifest, logos, ícones e `/assets/*` com hash. Nenhuma requisição da API é cacheada.
- Observação: no Chrome *headless* desta máquina, o `CacheStorage` falha com "Unexpected internal error" mesmo sem Service Worker, uma limitação do ambiente. Por isso a validação do SW foi feita no Chrome normal.

## Tamanho dos bundles (app, gzip)

- Carga inicial ≈ 116 KB de JS (React, React Router e design system) + 8 KB de CSS.
- Cada tela: 0,3–2,3 KB (carregada sob demanda).
- Fontes: apenas o subconjunto latino da Inter é baixado (via `unicode-range`).

## Capturas

Em [`screenshots/`](screenshots/): website (desktop, mobile e escuro), telas do aluno e do professor em 375, 768 e 1440 px, e estados de erro e vazio.

---

## Fase 2.1 — Premium UI/UX e experiência de login (17/11/2026)

### Execuções

| Verificação | Resultado |
| ----------- | --------- |
| `pnpm -r typecheck` | ✅ |
| `pnpm -r build` (inclui `check-effects` no app) | ✅ |
| `check-effects` | ✅ Também validado reintroduzindo o bug do `scrollTo`: a checagem falha, como esperado. |
| Smoke em **dev** (`localhost:5190`, StrictMode), 24 rotas | ✅ 0 erros. Com o bug reintroduzido: ❌ 39 problemas detectados. |
| Smoke em **produção** (`vite preview`), 24 rotas | ✅ 0 erros |
| axe-core WCAG 2.2 AA nas telas de acesso: 4 rotas × 320/375/390/768/1024/1440 × claro/escuro (48 renderizações) | ✅ 0 violações, 0 overflow, 0 erros de console |
| axe-core no aluno: 8 rotas × 375/1024/1440 × claro/escuro (48) | ✅ 0 violações |
| axe-core no professor: 6 rotas × 375/1024/1440 × claro/escuro (36) | ✅ 0 violações |
| Validação do cadastro (envio vazio, claro e escuro) | ✅ foco no 1º campo inválido, alerta "Revise os 4 campos destacados.", 4 campos com `aria-invalid`, 0 violações |

### Encontrado e corrigido

- A tabela de recebimentos era cortada em 1024px, porque a largura útil é menor que a tabela. Agora a tabela aparece só a partir de 1280px; abaixo disso, vira uma lista em duas colunas.
- `main.tsx` usava um efeito com retorno implícito (válido, mas ambíguo). Passou a usar `return` explícito, atendendo à regra.

### Bundles

As telas de acesso continuam leves: `Auth` 4,9 KB, `AuthShell` 2,8 KB e `Welcome` 2,5 KB, sem gzip. Nenhuma dependência nova.

### Capturas

Em [`screenshots/fase-2.1/`](screenshots/fase-2.1/):

- Comparativos antes/depois: `comparativo-login-*` e `comparativo-boas-vindas-*`.
- Login em claro e escuro (desktop e mobile).
- Cadastro: desktop, 320px e validação (claro e escuro).
- Boas-vindas: desktop e mobile, claro e escuro.
- Escolha de perfil (390px), aulas do aluno (mobile), início do aluno (escuro) e recebimentos (1024px).

---

## Fase 2.2 — Jornada funcional do marketplace

Executado no **servidor de desenvolvimento** (`localhost:5190`, React StrictMode) e no build de produção.

| Verificação | Resultado |
| ----------- | --------- |
| `pnpm -r typecheck` | ✅ |
| `pnpm --filter @edusearch/web lint` (`check-effects`) | ✅ |
| `pnpm -r build` | ✅ |
| `smoke` (24 rotas, dev) | ✅ 0 erros |
| `journey` (dev): jornada completa em 1440px claro e essencial em 768px claro, 375px claro/escuro e 1440px escuro | ✅ **29/29 etapas** |
| Teste de mutação: guarda de reserva duplicada desligada temporariamente | ❌ detectado pela etapa "conflito" (prova que o teste protege a regra) |
| axe-core WCAG 2.2 AA, aluno: 7 rotas × 375/768/1440 × claro/escuro (42) | ✅ 0 violações, 0 overflow, 0 erros de console |
| axe-core, professor: 4 rotas × 375/768/1440 × claro/escuro (24) | ✅ 0 violações |

### Cobertura do teste de jornada (`scripts/journey.mjs`)

1. Acesso em modo demonstração → perfil Aluno → dashboard com as ações de busca.
2. Busca: disciplina (3) → orçamento (2) → período "Noite" (1) → nível sem resultados (estado vazio) → limpar filtros (6). No mobile, filtros pelo painel inferior.
3. Matching: validação de dificuldade obrigatória → preferências → revisão → recomendações. A 1ª é a Profa. Marina, com 100%, motivo de dificuldade, ponto de atenção de orçamento e explicação dos critérios.
4. Perfil: especialidade, metodologia, preço e próximos horários; sem avaliações reais nem "verificado".
5. Reserva: horário pré-selecionado → resumo → confirmação → aviso de sucesso → "Nova reserva".
6. O horário reservado some da agenda (interface e dados).
7. Conflito: outra "aba" reserva o mesmo horário antes da confirmação. Resultado: 409, mensagem, botão desabilitado e atalho para outro horário.
8. O aluno não pode reservar duas aulas sobrepostas (professores diferentes).
9. Detalhes da aula (código, pagamento não cobrado) → cancelamento → o horário volta a ficar livre → aba Canceladas.
10. Troca para a visão do professor: a reserva aparece em Aulas e na Agenda semanal.
11. O cancelamento feito pela professora aparece para o aluno.
12. Persistência ao recarregar (`sessionStorage`).
13. Tema aplicado corretamente (claro e escuro), sem rolagem horizontal e sem erros de console em todas as etapas.

### Encontrado e corrigido durante o QA

- A rolagem horizontal entre 768 e 800px em *Configurações* foi causada pela nova seção "Dados da demonstração". Agora os cartões só ficam em linha a partir de 1024px.

### Capturas

Em [`screenshots/fase-2.2/`](screenshots/fase-2.2/), na ordem da jornada (1440, 768 e 375px, claro e escuro):

- Dashboard, busca filtrada e vazia, filtros mobile.
- Recomendações e perfil.
- Horário, resumo e conflito.
- Minhas aulas e detalhes.
- Aulas e agenda do professor.

---

## Fase 2.2 — Estabilização para o Pull Request

Todas as validações rodaram **em sequência**, com um único servidor de desenvolvimento (`localhost:5190`, StrictMode) e um Chrome headless por vez.

### Correções

| Problema | Correção |
| -------- | -------- |
| A visão do professor era fixa na Profa. Marina: reservas com outros professores não apareciam em nenhuma agenda | Professor exibido configurável (sessão `teacherId`). Perfil, especialidades e grade agora existem **por professor**. Horários de todos os professores vêm da grade editável. Novo seletor em *Escolha seu perfil* e *Configurações* e atalho *Ver na agenda do professor* |
| A troca de perfil para uma rota específica caía na home do professor: o guard da área antiga redirecionava antes do `navigate` assíncrono (encontrado pelo novo teste de jornada) | `switchRole(sessão, destino)`: a sessão e o destino mudam juntos e o `RequireRole` respeita o destino |
| Texto do aviso de reserva ("na agenda de Prof. Rafael Nogueira") | Primeiro nome: "na agenda de Rafael" |
| 4 servidores Vite órfãos de execuções anteriores (portas 4173, 4174, 5174 e 5190, ~160 MB) | Encerrados só os processos com `EDUSEARCH` na linha de comando. Daí em diante, um servidor e um teste por vez |

### Acessibilidade de componentes interativos (`a11y`: 29 verificações)

| Estado ou interação | Resultado |
| ------------------- | --------- |
| axe: escolha de perfil com seletor, menu da conta aberto, recomendações expandidas (claro e escuro), diálogo de detalhes (claro e escuro), confirmação de cancelamento, painel de filtros mobile, Configurações do professor | ✅ 0 violações |
| Menu da conta: `Enter` abre e foca o 1º item, `ArrowDown` move, `Escape` fecha e devolve o foco; `aria-expanded` e nome acessível | ✅ |
| Abas: `ArrowRight` seleciona e foca a próxima; `Home` volta à primeira | ✅ |
| `<summary>` dos critérios: `Enter` expande | ✅ |
| Diálogos: foco entra ao abrir, `Tab` não vai para o fundo, `Escape` fecha e devolve o foco ao gatilho; nome (`aria-labelledby`) e descrição (`aria-describedby`) presentes; `Escape` não confirma o cancelamento | ✅ |
| Avisos (toasts) em região `aria-live="polite"` | ✅ |

Durante a análise, o axe apontou contraste no diálogo escuro. Era um falso positivo: a medição ocorreu durante a animação de entrada (opacidade). Com a animação concluída, passa (`fg-muted` `#94A3B8` sobre `#102E46`, 5,46:1). Nenhuma mudança visual foi necessária.

### Validação final

| Verificação | Resultado |
| ----------- | --------- |
| `pnpm -r typecheck` | ✅ |
| `pnpm --filter @edusearch/web lint` (efeitos React) | ✅ |
| `pnpm -r build` | ✅ |
| `smoke` (24 rotas, dev) | ✅ 0 erros |
| `a11y` (dev) | ✅ 29/29 |
| `journey` (dev) | ✅ **31/31 etapas**, incluindo as 2 novas: reserva com o Prof. Rafael vai para a agenda dele e não para a da Marina; escolha da Profa. Luiza na tela de perfil |
| Responsividade e console: 15 rotas (4 públicas, 8 do aluno, 8 do professor) × 375/768/1440 × claro/escuro, 120 renderizações | ✅ 0 overflow, 0 violações axe, 0 erros de console |
| `apps/website`, `apps/api`, `supabase` e `docs/database-design.md` | ✅ sem alterações em relação à `main` |

### CI

`.github/workflows/frontend-ci.yml` foi criado e validado como YAML. **Ainda não foi executado no GitHub**, porque a branch não foi publicada. O lockfile contém os binários nativos para Linux (TypeScript 7, rolldown, Tailwind oxide, lightningcss). No CI, o Chrome roda com `--no-sandbox` (exigência dos runners Ubuntu 24.04), só quando `CI` está definido.

---

## Fase 2.3 — Validação (18/11/2026)

### Ambiente

A regra é rodar testes com navegador só com **≥ 3 GB de RAM livres**. A máquina ficou entre **1,6 e 1,7 GB livres** (de 16 GB) durante toda a validação, e na sessão anterior o servidor de desenvolvimento chegou a ser encerrado por pressão de memória. Por isso **não foram iniciados Vite nem Chrome**: só rodaram as verificações leves, em sequência. Não havia processos do EduSearch (Node ou Chrome) remanescentes.

### Verificações executadas

| Verificação | Resultado |
| ----------- | --------- |
| `pnpm -r typecheck` (ui, website, web) | ✅ |
| Lint (`check-effects`) | ✅ |
| Testes unitários (`node --test`): comissão de 15% em inteiros, calendário, conflitos, URL do Meet, estados da aula online | ✅ 10/10 |
| Build do app | ✅ (`Checkout` 12 KB, `OnlineLesson` 7,9 KB, `Benefits` 7,5 KB, `Agenda` 4 KB; carga inicial inalterada, ~76 KB gzip de JS principal) |
| Build do website | ✅ |
| Credenciais no código ou no bundle (`sk_*`, chaves Google/Gemini, service role, AbacatePay) | ✅ nenhuma |
| Payload Pix (BR Code/EMV `00020126`, `br.gov.bcb.pix`) | ✅ nenhum |
| Link concreto do Google Meet | ✅ nenhum (só o formato `xxx-xxxx-xxx` em um comentário de documentação, ausente do bundle) |
| Chamadas de rede fora do cliente HTTP central | ✅ nenhuma (sem chamadas diretas a AbacatePay ou Google) |
| `apps/api`, `supabase`, `apps/website` | ✅ sem alterações em relação à `main` |
| Comissão padrão | ✅ 15% (`STANDARD_COMMISSION_BPS = 1500`), coberta por teste unitário; nenhum outro percentual no código |

### Versão do Node

| Ambiente | Antes | Agora |
| -------- | ----- | ----- |
| Cloudflare Pages (README) | `NODE_VERSION=22` | inalterado |
| GitHub Actions | 24 (alterado nesta branch) | **22** |
| `apps/web` `engines` | — | `>=22.22.0` |

- O react-router 8.5.1 exige **Node ≥ 22.22.0** e o Vite 8, ≥ 22.12. Com Node 20, o app não funciona.
- Node 22 ≥ 22.18 executa os testes unitários em `.ts` (remoção de tipos padrão).
- **Recomendação:** versão única **Node 22 LTS (≥ 22.22)** no Cloudflare, no CI e localmente.
- O `engines` da raiz (`>=20`) deveria passar a `>=22.22.0`. Não foi alterado por estar fora das pastas desta frente.

### Bloqueado por memória (pendente)

1. Smoke test (rotas novas: aula online, checkout, benefícios).
2. Jornada completa no servidor de dev: reserva → checkout → confirmação simulada, falha, expiração, confirmação repetida, calendário por teclado, aula sem link do Meet, Google Agenda simulado e `.ics`, recebimentos de 15%, benefícios, bloqueio de dia e conflito, cancelamento coerente.
3. Auditoria de acessibilidade (axe e teclado) nas telas novas.
4. Responsividade em 375, 390, 768 e 1440 px, temas claro e escuro.
5. Capturas em `screenshots/fase-2.3/` e comparação visual final com o mockup.

Os testes 1 a 3 foram escritos e atualizados nesta fase, mas **ainda não rodaram**: falhas no primeiro uso são possíveis e devem ser corrigidas antes da aprovação. A comparação visual preliminar (375 px, tema claro) foi feita antes do bloqueio e motivou ajustes de layout e uma correção de overflow (ver `calendar-meet-payments.md`).
