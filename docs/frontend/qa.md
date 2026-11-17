# QA — frontend (Fase 2)

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
