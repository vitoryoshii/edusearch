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

## Organização do código

```text
src/
├── app/            router, sessão de demonstração, tema
├── components/     AppShell, PageHeader, AsyncContent, TeacherCard, LessonCard, LessonTabs, SettingsPanel...
├── lib/
│   ├── api/        client.ts (HTTP), types.ts (modelos do frontend)
│   ├── data/       source.ts (interface), mock/ (fixtures + adapter), http/ (adapter real)
│   ├── hooks/      useAsync, useAction
│   ├── catalog.ts  catálogo provisório de disciplinas
│   └── format.ts   moeda, datas e rótulos em pt-BR
├── pages/          public/, student/, teacher/
└── pwa/            registro do Service Worker
```
