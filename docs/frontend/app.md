# Aplicativo — `apps/web`

React 19 + Vite + TypeScript + Tailwind v4, React Router 8. Cada tela é um chunk carregado sob demanda.

## Navegação

```text
/                               Apresentação inicial
/entrar                         Login (demonstração)
/cadastro                       Cadastro (demonstração)
/perfil-de-acesso               Escolha entre aluno e professor

/aluno                          Início: busca rápida, assistente, próxima aula, destaques
/aluno/buscar                   Busca + filtros (disciplina, nível, metodologia, período, valor); filtros na URL
/aluno/assistente               Matching pedagógico em 3 etapas (objetivo → preferências → revisão)
/aluno/recomendados             Professores recomendados com compatibilidade e motivos
/aluno/professores/:id          Perfil do professor
/aluno/professores/:id/agendar  Seleção de dia e horário
/aluno/agendamento/resumo       Resumo e confirmação do agendamento
/aluno/aulas                    Minhas aulas (próximas / concluídas / canceladas), cancelamento
/aluno/progresso                Acompanhamento: metas, tempo de estudo, anotações
/aluno/perfil                   Perfil e configurações

/professor                      Dashboard: indicadores, próximas aulas, perfil completo
/professor/perfil               Perfil profissional (formulário validado)
/professor/especialidades       Disciplinas e níveis
/professor/disponibilidade      Disponibilidade semanal com validação de intervalos
/professor/agenda               Agenda semanal navegável
/professor/aulas                Aulas agendadas
/professor/recebimentos         Bruto, comissão (hipótese de 10%), líquido e detalhamento
/professor/configuracoes        Configurações
```

- **Mobile/tablet (< 1024px):** barra superior com logo, menu "mais opções" e menu da conta, e barra inferior com 5 destinos. **Desktop:** barra lateral.
- Áreas logadas protegidas por `RequireRole`. Sem sessão de demonstração, o usuário vai para `/perfil-de-acesso`; com o perfil errado, volta à sua área.
- Ao navegar: título da aba atualizado, rolagem ao topo e foco no conteúdo principal. Link "Pular para o conteúdo" disponível.
- Rotas inexistentes mostram a tela 404. Falhas de carregamento de chunk sugerem recarregar.

## Telas de acesso (Fase 2.1)

- **Layout `AuthShell`:**
  - Desktop (≥ 1024px): painel institucional sobre o azul profundo (logo, slogan e três pontos de valor) ao lado da coluna de acesso.
  - Mobile: só a coluna, com o logo no topo e respeitando as safe areas do PWA.
- **Boas-vindas (`/`):**
  - Ações: *Começar agora* (cadastro), *Já tenho uma conta* (login) e *Explorar demonstração* (escolha de perfil).
  - Desktop: o título "Encontre o professor certo para você." fica no painel, e a coluna mostra "Comece por aqui".
  - Com sessão ativa, aparece "Continuar como …".
- **Login (`/entrar`) e cadastro (`/cadastro`):**
  - Selo "Modo demonstração" e botão do Google desabilitado, com aviso discreto.
  - `autocomplete` adequado: `username` e `current-password` no login; `name`, `email` e `new-password` no cadastro.
  - Senha com mostrar/ocultar. No cadastro, o indicador "Pelo menos 8 caracteres" muda em tempo real.
  - Validação ao sair do campo e ao enviar: o foco vai ao primeiro campo inválido e um alerta informa quantos campos revisar.
  - O botão "Continuar" leva à escolha de perfil. O texto deixa claro que nenhuma conta é criada e nenhum dado é enviado.
- **Escolha de perfil (`/perfil-de-acesso`):** layout simples, com logo e link "Início".

### Restrições da autenticação demonstrativa

- Não há OAuth, tokens, escopos nem chamadas ao Google ou ao Supabase.
- A senha existe só no estado do formulário e nunca é persistida.
- A sessão de demonstração guarda apenas `{ role, name }` no `sessionStorage`.
- Ponto de integração futura: `src/lib/auth/providers.ts` (`AUTH_PROVIDERS.google.available`, `signInWithGoogle`) e `setAccessTokenProvider` em `src/lib/api/client.ts`.

## Estados de cada tela

Todas as leituras passam por `useAsync` + `AsyncContent`: **carregando** (esqueleto ou spinner), **erro** (mensagem e "Tentar novamente"), **vazio** (orientação e ação) e **conteúdo**.

Para revisar sem backend, adicione à URL:

- `?demo=erro`: todas as leituras falham.
- `?demo=vazio`: as listas vêm vazias.

Ex.: `/aluno/buscar?demo=vazio`.

## Sessão de demonstração

`sessionStorage` (`edusearch-demo-session`) guarda apenas `{ role, name }`. Nenhuma senha ou token é armazenado, e os formulários de login e cadastro descartam a senha. Em *Configurações* é possível alternar entre aluno e professor.

## PWA

- `public/manifest.webmanifest`: nome EduSearch, `theme_color #146A7A`, `background_color #F8FAFC`, `display: standalone`, ícones 192/512 e *maskable*, atalhos para Busca e Minhas aulas.
- `public/sw.js`: registrado **somente no build de produção**.
  - Intercepta apenas `GET` da própria origem. Requisições à API (outra origem), com `Authorization` ou de escrita **nunca** são cacheadas.
  - Navegação usa rede primeiro, com *fallback* para o app shell offline.
  - `/assets/*` (com hash) usa cache primeiro; ícones e logos usam *stale-while-revalidate*.
  - Respostas `no-store`/`private`, opacas ou com erro não são guardadas.
  - Para invalidar, incremente `VERSION`.
- `public/_headers` (Cloudflare Pages): `sw.js` e `index.html` sem cache, `/assets/*` imutável, cabeçalhos de segurança.

## Proteção contra regressões

- `pnpm --filter @edusearch/web lint` (`scripts/check-effects.mjs`): falha se algum `useEffect`/`useLayoutEffect` tiver corpo de expressão ou for `async`. O build do app roda essa checagem antes do `tsc`.
- `pnpm --filter @edusearch/web smoke [url]` (`scripts/smoke.mjs`): abre 24 rotas no Chrome headless e falha em caso de erro de console, exceção, tela de erro de rota, estado de erro inesperado ou rolagem horizontal. A URL padrão é `http://localhost:5190`. Rode contra o **servidor de desenvolvimento** para cobrir o React StrictMode.

```bash
pnpm --filter @edusearch/web dev -- --port 5190
pnpm --filter @edusearch/web smoke
```

## Organização do código

```text
src/
├── app/            router, sessão de demonstração, tema
├── components/     AppShell, PageHeader, AsyncContent, TeacherCard, LessonCard, LessonTabs, SettingsPanel...
├── lib/
│   ├── auth/       providers.ts (ponto de integração Supabase + Google; hoje indisponível)
│   ├── api/        client.ts (HTTP), types.ts (modelos do frontend)
│   ├── data/       source.ts (interface), mock/ (fixtures + adapter), http/ (adapter real)
│   ├── hooks/      useAsync, useAction
│   ├── catalog.ts  catálogo provisório de disciplinas
│   └── format.ts   moeda, datas e rótulos em pt-BR
├── pages/          public/, student/, teacher/
└── pwa/            registro do Service Worker
```
