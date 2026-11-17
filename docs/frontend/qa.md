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
