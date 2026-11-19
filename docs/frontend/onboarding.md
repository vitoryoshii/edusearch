# Entrada única e onboarding (Fases 2.5 e 2.5.1)

Uma única experiência de entrada (Google como método principal) e o onboarding da conta real, preparados **sem alterar o backend**. A autenticação continua sendo a da Fase 2.4 (Google Identity Services + Supabase Auth, `signInWithIdToken`, nonce de uso único) — ver [auth-integration.md](auth-integration.md).

> **Prévia sem persistência.** As respostas do onboarding vivem só no estado da tela: **não são enviadas nem gravadas** (nem em `localStorage`/`sessionStorage`) e são descartadas ao sair. Isso vale até existir a API de perfis com persistência segura, Política de Privacidade publicada e fluxo de tratamento de dados aprovado.

## Fluxo do usuário

```text
                 ┌──────────────────────────── /  (entrada única) ────────────────────────────┐
                 │  Logo · "Conectando alunos e professores."                                  │
                 │  [ Continuar com o Google ]  (botão oficial GIS)                            │
                 │  [ Explorar demonstração ]   → /perfil-de-acesso (dados fictícios, sem login)│
                 │  Termos de Uso e Política de Privacidade (em elaboração)                    │
                 └────────────────────────────────────────────────────────────────────────────┘
/entrar, /cadastro ─▶ /  (preservam ?next= interno e seguro)
/conta/* sem sessão ─▶ /?next=/conta/...

Google ─▶ Supabase valida o ID token ─▶ sessão
   ├─ cadastro recusado (fora da lista de testes) ─▶ "Conta não liberada para testes" (sem sessão)
   └─ sessão válida ─▶ next (padrão /conta)
         ├─ primeiro acesso (sem papel escolhido) ─▶ /conta/boas-vindas
         │      ├─ Quero aprender ─▶ /conta/cadastro/aluno     (5 etapas)
         │      └─ Quero ensinar  ─▶ /conta/cadastro/professor (6 etapas)
         └─ papel já escolhido ─▶ /conta  ("Conclua seu cadastro de …" · Cadastro em análise)

Sessão existente ao abrir "/" ─▶ "Continuar como <nome>" (próxima etapa) · "Sair da conta"
Sessão expirada/revogada ─▶ "/" com "Sua sessão expirou"
```

## Entrada única (`/`)

> **Fase 2.5.1:** título = logo oficial (h1 "EduSearch"), subtítulo "Conectando alunos e professores.", botões em pílula (GIS com `shape: "pill"`), "Continuar com e-mail" como acesso secundário (estágio próprio, desligado por padrão), link "Explorar demonstração" e o texto "Ao continuar, você poderá consultar nossos Termos de Uso e nossa Política de Privacidade." — os nomes viram links só com os documentos publicados. Mensagens de marketing (HackBrasil) saíram da tela; os avisos de fase de testes e de dados fictícios continuam.

| Elemento | Detalhe |
| -------- | ------- |
| Logo | `Logo` oficial do `@edusearch/ui` (claro/escuro), centralizado |
| Mensagem | "Conectando alunos e professores." (único `h1`) |
| Fundo | `bg` (branco-gelo `#F8FAFC` no claro, azul profundo no escuro) com curvas em `petroleo` (`#146A7A`) e `esmeralda` (`#14836E`) nos cantos — SVG decorativo (`aria-hidden`), opacidade menor no escuro |
| Botão principal | Botão **oficial** renderizado pelo Google Identity Services (`continue_with`, pt-BR, `outline` no claro, `filled_black` no escuro). Sem configuração: botão desabilitado do design system com explicação |
| Ação secundária | *Explorar demonstração* (`/perfil-de-acesso`) ou *Continuar demonstração* com sessão demo ativa |
| Rodapé | Links de Termos/Privacidade **somente** quando `VITE_LEGAL_TERMS_URL` e `VITE_LEGAL_PRIVACY_URL` (https) estiverem definidas; antes disso, "em elaboração". **Nunca há aceite fictício** |
| Desktop | Mesma composição centralizada (coluna de ~22 rem) com espaçamento generoso; sem painel institucional |

Arquivos: `src/pages/public/Entry.tsx`, `src/components/EntryBackdrop.tsx`, `src/lib/legal.ts`. Removidos: `pages/public/Welcome.tsx`, `pages/public/Auth.tsx` (formulário demonstrativo de e-mail/senha) e `components/AuthShell.tsx`.

## Boas-vindas (`/conta/boas-vindas`)

Primeiro acesso de uma sessão válida (nenhum papel escolhido neste navegador). Duas opções:

- **Quero aprender** — Encontrar professores · Agendar aulas · Acompanhar meu aprendizado.
- **Quero ensinar** — Apresentar especialidades · Disponibilizar horários · Receber solicitações de alunos.

A escolha é gravada **apenas** como preferência de interface (`localStorage['edusearch-account-role:<id>']`, limpa no logout). Ela **não concede permissões**, não é enviada ao servidor e não é apresentada como cadastro concluído (o início da conta mostra "Cadastro em análise" e "Continuar cadastro").

## Onboarding do aluno (`/conta/cadastro/aluno`)

| Etapa | Campos | Obrigatório |
| ----- | ------ | ----------- |
| 1. Este é você? | Nome, e-mail e foto do Google (somente leitura) | — |
| 2. O que você quer aprender? | Objetivo (3–200 caracteres) · Nível atual | Sim |
| 3. Disciplinas e dificuldades | Disciplinas de interesse · Principais dificuldades | Disciplinas |
| 4. Quando e como estudar | Dias · Períodos · Modalidade (online/presencial/ambos) · Faixa de valor por aula | Sim |
| 5. Revisão | Resumo · *Salvar perfil* bloqueado | — |

## Onboarding do professor (`/conta/cadastro/professor`)

| Etapa | Campos | Obrigatório |
| ----- | ------ | ----------- |
| 1. Apresente-se | Nome e foto do Google · Biografia profissional (30–600) | Biografia |
| 2. O que você ensina | Disciplinas · Especialidades · Formação acadêmica · Experiência | Exceto especialidades |
| 3. Suas aulas | Metodologia · Notas · **Valor da aula** (R$ 20–1.000) · Duração (30/45/60/90) · Modalidade | Exceto notas |
| 4. Disponibilidade | Dias · Períodos (visão geral; horários detalhados na agenda) | Sim |
| 5. Verificação de formação | **Somente informativa**: não envie documentos; sem upload; sem aprovação automática; sem selo de verificado | — |
| 6. Revisão | Resumo ("Verificação: Pendente") · *Salvar perfil* bloqueado | — |

Valor da aula: convertido para centavos sem ponto flutuante (`parsePriceToCents`). A prévia mostra a **comissão padrão de 15%** (`splitLessonAmount`, a mesma regra da demonstração): R$ 80,00 → R$ 12,00 EduSearch e R$ 68,00 ao professor. Descontos progressivos, indicações qualificadas e premiações aparecem como **planejados**, sem aplicar taxa reduzida. Nenhum pagamento real.

## Interação e acessibilidade

- Etapas curtas com progresso ("Etapa 2 de 5" + barra), *Voltar* e *Continuar*.
- Ao avançar ou voltar, o foco vai para o título da etapa (leitores de tela anunciam a nova etapa).
- *Continuar* nunca fica silenciosamente desabilitado: se faltar algo, um `role="alert"` explica o quê.
- Seleções por `Chip` (`aria-pressed`) dentro de `role="group"` rotulado; campos do `@edusearch/ui` com rótulo e dica.
- Rodapé de ações fixo no mobile (respeita a safe area), estático a partir de 640 px.
- Claro e escuro; sem rolagem horizontal de 320 a 1440 px (verificado no CI).

Arquivos: `src/lib/onboarding.ts` (regras puras, testadas), `src/components/Onboarding.tsx` (layout, fluxo, chips, revisão), `src/pages/account/{Welcome,StudentOnboarding,TeacherOnboarding}.tsx`, `src/pages/account/Dashboard.tsx` (redireciona o primeiro acesso).

## O que este fluxo não faz (por decisão)

- Não grava dados pessoais adicionais em nenhum armazenamento (nem demonstrativo).
- Não pede upload de documentos nem exibe selo de verificado.
- Não concede permissões a partir do papel escolhido.
- Não cria aceite de Termos/Política nem afirma que estão publicados.
- Não migra dados da demonstração para a conta real.
- Não cria login por e-mail e senha.

## Pendências de backend

| Necessidade | Uso no frontend |
| ----------- | --------------- |
| Controle de admissão (hook *Before User Created* com allowlist) | Hoje o app só exibe "Conta não liberada para testes" quando o Supabase recusa o cadastro |
| API de perfis (ex.: `GET /me`, `PUT /me/profile`, papel definido pelo servidor) | Substituir a preferência local de papel e liberar *Salvar perfil* |
| Persistência dos rascunhos de onboarding (com RLS) | Retomar o cadastro entre sessões |
| Armazenamento privado + fluxo de verificação de documentos | Habilitar a etapa 5 do professor |
| Catálogo oficial de disciplinas (`listSubjects`) | Substituir o catálogo provisório |
| Termos de Uso e Política de Privacidade publicados | Definir `VITE_LEGAL_TERMS_URL`/`VITE_LEGAL_PRIVACY_URL` |

## Testes

| Teste | Onde | Cobertura |
| ----- | ---- | --------- |
| `test:unit` | local e CI | Próxima etapa após login, valor da aula (formatos aceitos/recusados), etapas e validação do aluno e do professor, seleção por chips |
| `scripts/auth.mjs` | GitHub Actions | Entrada pública e com Google; rotas legadas e protegidas (`next` seguro); login autorizado e **não autorizado**; cancelamento, token/nonce inválidos, replay, rede; primeiro acesso → boas-vindas; onboarding completo do aluno e do professor (validação, foco, voltar, comissão de 15%, documentos sem upload e sem selo); nada gravado nem enviado; sessão existente; avatar presente/ausente/quebrado; logout; sessão expirada; demonstração independente; **axe** nas telas novas; **sem rolagem horizontal em 320/375/390/768/1440 px, claro e escuro**; capturas (artefato `screenshots-fase-2.5`) |
| `scripts/a11y.mjs` | GitHub Actions | axe na entrada única |
| `scripts/smoke.mjs` | GitHub Actions | `/`, rotas legadas e rotas da conta sem erros |
| `scripts/journey.mjs` | GitHub Actions | Jornada demonstrativa completa a partir de "Explorar demonstração" |

## Capturas

Destino: `docs/frontend/screenshots/fase-2.5/` (ver o README da pasta). São geradas pelo CI no artefato `screenshots-fase-2.5`: entrada pública e com Google, erro, não autorizado, sessão ativa, boas-vindas, etapas do aluno e do professor, início da conta — em 320/375/390/768/1440 px (conforme a tela), claro e escuro.
