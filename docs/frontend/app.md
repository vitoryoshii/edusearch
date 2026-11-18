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
/aluno/assistente               Matching pedagógico em 3 etapas (objetivo + dificuldades → preferências → revisão)
/aluno/recomendados             Professores recomendados com compatibilidade e motivos
/aluno/professores/:id          Perfil do professor + próximos horários disponíveis
/aluno/professores/:id/agendar  Seleção de dia e horário (?horario=<id> pré-seleciona)
/aluno/agendamento/resumo       Resumo e confirmação do agendamento
/aluno/aulas                    Minhas aulas: próxima aula, pagamento e progresso; Calendário (semana/mês) | Lista
/aluno/aulas/:id                Aula online (Google Meet, estados, preparação, Google Agenda simulado)
/aluno/pagamento/:lessonId      Checkout Pix (demonstração)
/aluno/progresso                Acompanhamento: metas, tempo de estudo, anotações
/aluno/perfil                   Perfil e configurações

/professor                      Dashboard: indicadores, próximas aulas, perfil completo
/professor/perfil               Perfil profissional (formulário validado)
/professor/especialidades       Disciplinas e níveis
/professor/disponibilidade      Disponibilidade semanal com validação de intervalos
/professor/agenda               Agenda semana/mês: aulas, horários livres, bloqueios e conflitos
/professor/aulas/:id            Aula online (mesma tela do aluno)
/professor/beneficios           Comissão (15%), metas, conquistas e indicações
/professor/aulas                Aulas agendadas
/professor/recebimentos         Comissão de 15%, parcela do professor, saldo estimado (só pagos) e detalhamento
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
  - Selo "Modo demonstração". Botão oficial "Continuar com o Google": desabilitado na versão pública; no ambiente restrito de testes faz login **real** (ver [auth-integration.md](auth-integration.md)).
  - `autocomplete` adequado: `username` e `current-password` no login; `name`, `email` e `new-password` no cadastro.
  - Senha com mostrar/ocultar. No cadastro, o indicador "Pelo menos 8 caracteres" muda em tempo real.
  - Validação ao sair do campo e ao enviar: o foco vai ao primeiro campo inválido e um alerta informa quantos campos revisar.
  - O botão "Continuar" leva à escolha de perfil. O texto deixa claro que nenhuma conta é criada e nenhum dado é enviado.
- **Escolha de perfil (`/perfil-de-acesso`):** layout simples, com logo e link "Início".

### Restrições da autenticação demonstrativa

- O formulário de e-mail e senha não autentica. O login real (Google via Supabase Auth) é separado, só existe com `VITE_AUTH_GOOGLE_ENABLED=true` e leva à área `/conta` — ver [auth-integration.md](auth-integration.md).
- A senha existe só no estado do formulário e nunca é persistida.
- A sessão de demonstração guarda apenas `{ role, name }` no `sessionStorage`.
- A sessão real nunca reutiliza a sessão nem os dados da demonstração; ao entrar com a conta real, a sessão de demonstração da aba é encerrada.

## Estados de cada tela

Todas as leituras passam por `useAsync` + `AsyncContent`: **carregando** (esqueleto ou spinner), **erro** (mensagem e "Tentar novamente"), **vazio** (orientação e ação) e **conteúdo**.

Para revisar sem backend, adicione à URL:

- `?demo=erro`: todas as leituras falham.
- `?demo=vazio`: as listas vêm vazias.

Ex.: `/aluno/buscar?demo=vazio`.

## Jornada de demonstração

A jornada completa (busca → matching → perfil → reserva → minhas aulas → agenda do professor), com regras e estado, está em [demo-journey.md](demo-journey.md).

## Sessão de demonstração

`sessionStorage` (`edusearch-demo-session`) guarda apenas `{ role, name }`. Nenhuma senha ou token é armazenado, e os formulários de login e cadastro descartam a senha. Para alternar entre aluno e professor, use o menu da conta (avatar) ou *Configurações*. Para escolher **qual professor fictício** é exibido, use *Escolha seu perfil*, *Configurações → Professor exibido* ou o atalho *Ver na agenda do professor* nos detalhes de uma aula. Sair da demonstração também restaura os dados fictícios.

Trocas de perfil usam `switchRole(sessão, destino)` (`src/app/session.tsx`). Usar `signIn` seguido de `navigate` falha: o guard da área antiga redireciona para a home do novo perfil antes da navegação assíncrona terminar.

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
- `pnpm --filter @edusearch/web journey [url] [pasta]` (`scripts/journey.mjs`): executa a jornada do marketplace pela interface em 1440, 768 e 375px, nos temas claro e escuro (29 etapas, ver [demo-journey.md](demo-journey.md)).
- `pnpm --filter @edusearch/web a11y [url]` (`scripts/a11y.mjs`), cerca de 1 minuto:
  - axe-core em estados interativos: diálogos abertos, menu da conta, painel de filtros, recomendações expandidas e seletor de professor, nos temas claro e escuro.
  - Teclado real: foco ao abrir, `Tab` contido, `Escape` fecha e devolve o foco, setas no menu e nas abas, `Enter` no `<summary>`.
  - Nomes acessíveis e regiões `aria-live`.
- **CI** (`.github/workflows/frontend-ci.yml`): em Pull Requests roda instalação com lockfile, typecheck, lint, build, smoke e a11y no servidor de dev. A jornada é complementar: roda manualmente (*Run workflow*) ou em PRs com o rótulo `journey`.
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
│   ├── demo.ts     identidades fictícias (Ana, professor padrão) e chave da sessão
│   ├── auth/       config.ts, supabase.ts (cliente único, sob demanda), oauth.ts (regras puras), providers.ts
│   ├── api/        client.ts (HTTP), types.ts (modelos do frontend)
│   ├── data/       source.ts (interface), mock/ (fixtures + adapter), http/ (adapter real)
│   ├── hooks/      useAsync, useAction
│   ├── catalog.ts  catálogo provisório de disciplinas
│   └── format.ts   moeda, datas e rótulos em pt-BR
├── pages/          public/, student/, teacher/
└── pwa/            registro do Service Worker
```

## Fase 2.3

Calendário, aula online, checkout Pix, comissão de 15% e incentivos: veja [calendar-meet-payments.md](calendar-meet-payments.md). Na navegação inferior do aluno ficam 4 itens (Início, Buscar, Aulas, Perfil), como no mockup. Assistente e Progresso aparecem na barra lateral, no menu "mais opções" e nos cartões do início e de *Minhas aulas*.
