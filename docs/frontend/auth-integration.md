# Autenticação real — Google OAuth via Supabase Auth (Fase 2.4)

Este documento descreve o login **real** com Google no app PWA (`apps/web`), o que precisa ser configurado **manualmente** no Google Cloud e no Supabase, e o que ainda falta para abrir o cadastro ao público.

> **Estado:** pronto para um **ambiente restrito de testes**. A versão pública continua só com a demonstração: o login real fica **desligado** enquanto `VITE_AUTH_GOOGLE_ENABLED` não for `true`.
>
> **O cadastro público NÃO está liberado.** Isso depende de: revisão de RLS, API de perfis com autorização no FastAPI, Termos de Uso e Política de Privacidade publicados e aprovação do responsável pelo produto.

## Visão geral do fluxo

```text
/entrar ── "Continuar com o Google"
   │  1. grava a intenção { nonce, next, createdAt } no sessionStorage
   │  2. supabase.auth.signInWithOAuth({ provider: "google", scopes: "openid email profile",
   │       redirectTo: <origem>/auth/callback?s=<nonce> })   ← PKCE (code_challenge S256)
   ▼
https://pgltvnwdvatyihrozlvn.supabase.co/auth/v1/authorize  →  Google (consentimento)
   ▼
https://pgltvnwdvatyihrozlvn.supabase.co/auth/v1/callback   (redirect URI registrada no Google)
   ▼
<origem>/auth/callback?code=…&s=<nonce>
   │  3. lê e APAGA a intenção (uso único); confere nonce e validade (10 min)
   │  4. supabase.auth.exchangeCodeForSession(code)  ← só funciona com o code_verifier deste navegador
   │  5. remove código da barra de endereços; encerra a sessão de demonstração da aba
   ▼
/conta  (rota protegida: dados básicos, papel pretendido, conclusão do cadastro, sair)
```

## Arquivos

| Arquivo | Papel |
| ------- | ----- |
| `apps/web/src/lib/auth/config.ts` | Lê as variáveis públicas; liga o login real só com a flag; **recusa chaves secretas** (`sb_secret_…` ou JWT `service_role`) |
| `apps/web/src/lib/auth/supabase.ts` | Cliente Supabase **único**, carregado sob demanda (o SDK não é baixado por quem só usa a demonstração). `flowType: "pkce"`, `detectSessionInUrl: false`, armazenamento que **descarta tokens do Google** |
| `apps/web/src/lib/auth/oauth.ts` | Regras puras e testadas: escopos, `redirectTo`, saneamento do destino (`next`), intenção/nonce, leitura do callback, mensagens de erro, identidade de exibição |
| `apps/web/src/app/auth.tsx` | `AuthProvider`/`useAuth`: restauração da sessão, login, callback idempotente, logout, `RequireAuth`, papel pretendido (preferência local) e registro do JWT para a API |
| `apps/web/src/pages/account/Callback.tsx` | Tela `/auth/callback` com carregamento e estados de erro |
| `apps/web/src/pages/account/Account.tsx` | Tela `/conta` (sessão autenticada) |
| `apps/web/src/pages/public/Auth.tsx` | Botão oficial "Continuar com o Google" (`GoogleButton` do `@edusearch/ui`, conforme as diretrizes de marca do Google) |

## Variáveis de ambiente (públicas)

Copie `apps/web/.env.example` para `apps/web/.env` (o `.env` é ignorado pelo Git).

| Variável | Valor | Observação |
| -------- | ----- | ---------- |
| `VITE_AUTH_GOOGLE_ENABLED` | `true` só no ambiente de testes | Padrão `false`. Sem ela o botão fica desabilitado e nenhum código do Supabase é carregado |
| `VITE_SUPABASE_URL` | `https://pgltvnwdvatyihrozlvn.supabase.co` | Projeto `edusearch-db` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | chave **publicável** | *Project Settings → API Keys → Publishable key* (`sb_publishable_…`). A `anon` key legada também funciona. **Nunca** a `service_role`/`secret` |

Todas as variáveis `VITE_*` vão para o bundle do navegador — por isso só valores públicos.

**Cloudflare Pages:** defina as três variáveis **apenas no ambiente _Preview_** (ou em um projeto de testes separado). Deixe o ambiente _Production_ sem `VITE_AUTH_GOOGLE_ENABLED` — assim a versão pública não muda.

## Configuração manual pendente — Google Cloud (projeto EduSearch)

Nenhum Client ID ou Client Secret foi criado ou versionado. Passos (console em *Google Auth Platform*):

1. **Branding:** nome do app "EduSearch", e-mail de suporte e e-mail do desenvolvedor. Evite enviar logo por enquanto (logo exige verificação da marca).
   - **Domínios autorizados:** `pgltvnwdvatyihrozlvn.supabase.co` e o domínio do app de testes.
   - Links de Política de Privacidade e Termos: obrigatórios **antes de publicar** o app (hoje em elaboração).
2. **Público-alvo (Audience):** tipo **Externo**, status de publicação **Testing (em teste)**.
   - Adicione cada conta autorizada em **Test users** (máx. 100). Em modo de teste, **somente essas contas conseguem concluir o login** — é a principal barreira do ambiente restrito.
   - **Não** clique em "Publish app" sem aprovação.
3. **Acesso a dados (Data access / escopos):** somente `openid`, `.../auth/userinfo.email` e `.../auth/userinfo.profile` (não sensíveis). **Não** adicione escopos do Google Calendar neste fluxo.
4. **Clientes → Criar cliente OAuth:** tipo **Aplicativo da Web**, nome "EduSearch – Supabase Auth".
   - **URIs de redirecionamento autorizados:** `https://pgltvnwdvatyihrozlvn.supabase.co/auth/v1/callback`
   - Origens JavaScript: não são necessárias neste fluxo (o redirecionamento passa pelo Supabase). Se o console exigir, use as origens do app de testes.
5. Copie o **Client ID** e o **Client Secret** diretamente para o Supabase (passo abaixo). Não cole em arquivos, issues, PRs ou chats.

## Configuração manual pendente — Supabase (`edusearch-db`)

1. **Authentication → Sign In / Providers → Google:** habilitar e colar Client ID e Client Secret do passo anterior.
2. **Authentication → URL Configuration:**
   - **Site URL:** a origem do ambiente de testes (ex.: `http://localhost:5174` no desenvolvimento). Ela é usada como destino quando o `redirectTo` não está na lista — e o app só conclui o login em `/auth/callback`.
   - **Redirect URLs** (lista de permissões). O app envia `?s=<nonce>` no retorno, por isso use `**` no fim:
     - `http://localhost:5174/auth/callback**`
     - `https://<ambiente-de-testes>/auth/callback**` (ex.: a URL fixa do preview da branch no Cloudflare Pages)
   - Evite curingas amplos (`https://*.pages.dev/**`): qualquer projeto do Pages poderia receber códigos de login.
3. **Project Settings → API Keys:** use a **Publishable key** no frontend. A secret/service_role fica apenas no backend.
4. **Restrição a usuários de teste (recomendado, no servidor):** além do modo "Testing" do Google, adicionar um **Before User Created Hook** que recuse e-mails fora de uma lista de testes. Sugestão para a equipe de backend revisar (não aplicada):

   ```sql
   -- Tabela de e-mails autorizados (somente o backend/admin escreve nela)
   create table if not exists public.auth_test_allowlist (email text primary key);
   alter table public.auth_test_allowlist enable row level security; -- sem políticas: nenhum acesso via API

   create or replace function public.hook_restrict_signup(event jsonb)
   returns jsonb language plpgsql security definer set search_path = '' as $$
   begin
     if exists (select 1 from public.auth_test_allowlist a
                where lower(a.email) = lower(event->'user'->>'email')) then
       return '{}'::jsonb;
     end if;
     return jsonb_build_object('error', jsonb_build_object(
       'http_code', 403, 'message', 'Cadastro restrito a usuários de teste (signup not allowed).'));
   end $$;

   grant execute on function public.hook_restrict_signup to supabase_auth_admin;
   revoke execute on function public.hook_restrict_signup from authenticated, anon, public;
   grant select on public.auth_test_allowlist to supabase_auth_admin;
   ```

   Depois: *Authentication → Hooks → Before User Created → Postgres function `hook_restrict_signup`*. A tela de callback mostra "Conta não liberada para testes" quando o retorno indica cadastro recusado.
5. **Antes de abrir o cadastro:** revisar RLS de todas as tabelas expostas, criar a tabela de perfis com papel **definido pelo servidor** e publicar os documentos jurídicos.

## Segurança

| Regra | Como está implementado |
| ----- | ---------------------- |
| Sem segredos no navegador | Só URL e chave publicável. `config.ts` desliga o login se detectar chave secreta. Client Secret do Google fica só no Supabase |
| Escopos mínimos | `openid email profile`; sem Google Agenda; sem `access_type=offline` (sem refresh token do Google) |
| Tokens do Google não ficam no navegador | O armazenamento da sessão remove `provider_token` e `provider_refresh_token` antes de gravar. A integração com Google Agenda será feita pelo backend, com OAuth próprio |
| PKCE | `flowType: "pkce"`: o código só é trocado com o `code_verifier` deste navegador |
| Estado/CSRF do retorno | Intenção com nonce de 128 bits, uso único, validade de 10 min, conferida antes da troca do código |
| Redirects | `redirectTo` sempre na própria origem (`/auth/callback`); destino pós-login (`next`) aceita apenas caminhos internos de `/conta` (sem `//`, `\`, esquemas, `..`). Allowlist do Supabase restrita |
| Código fora da barra de endereços | O callback faz `history.replaceState` antes de qualquer outra coisa |
| Autenticação ≠ autorização | O app só sabe **quem** é o usuário. Papel escolhido na tela é preferência local (`localStorage`, por usuário) e `user_metadata` é usado só para exibir nome/foto. **Nenhuma permissão** depende deles |
| Foto de perfil | Só URLs `https://*.googleusercontent.com/`, com `referrerpolicy="no-referrer"` |
| Service Worker | Requisições a outra origem (Supabase) e com `Authorization` nunca são cacheadas |
| Demonstração separada | Sessão real em `localStorage['edusearch-auth']`; demo em `sessionStorage['edusearch-demo-session']`. Ao entrar com a conta real, a sessão de demonstração da aba é encerrada. Nada é migrado para o Supabase |

### Integração futura com o FastAPI

Com a sessão ativa, `AuthProvider` registra `setAccessTokenProvider` e o cliente HTTP envia `Authorization: Bearer <access_token do Supabase>`. A API deve:

- validar a assinatura pelo JWKS `https://pgltvnwdvatyihrozlvn.supabase.co/auth/v1/.well-known/jwks.json` (chaves assimétricas) ou pelo segredo JWT legado, **no servidor**;
- conferir `iss = https://pgltvnwdvatyihrozlvn.supabase.co/auth/v1`, `aud = authenticated` e `exp`;
- usar `sub` como ID do usuário e obter o **papel** de uma tabela controlada pelo backend — nunca de `user_metadata` nem do corpo da requisição;
- expor algo como `GET /me` e `PUT /me/profile` para a conclusão do cadastro (hoje o botão "Concluir perfil" fica bloqueado).

## Experiência

- `/entrar` e `/cadastro`: botão oficial "Continuar com o Google" (G multicolorido e cores do guia de marca do Google, claro/escuro). No ambiente de testes aparece o selo **"Acesso real · ambiente de testes"**; o formulário de e-mail continua demonstrativo e é rotulado assim. Na versão pública o botão fica desabilitado com a explicação.
- `/auth/callback`: carregamento ("Concluindo seu login…") e erros com título, explicação e ações (*Tentar novamente*, *Explorar a demonstração*):

  | Código | Quando |
  | ------ | ------ |
  | `access_denied` | Usuário cancelou no Google |
  | `not_allowed` | Conta fora da lista de testes (hook/cadastro recusado) |
  | `provider_error` | Erro do Google/Supabase |
  | `missing_code` | Retorno sem código |
  | `invalid_state` | Retorno sem login iniciado neste navegador ou nonce diferente |
  | `expired_state` | Mais de 10 minutos entre ida e volta |
  | `exchange_failed` | Código inválido/já usado |
  | `network` | Sem conexão com o Supabase |
  | `disabled` | Login real desligado neste ambiente |

- `/conta` (protegida por `RequireAuth`): selos **"Sessão autenticada"** e **"Ambiente de testes"**, nome, e-mail, foto, provedor, e-mail verificado; escolha do papel pretendido; checklist de conclusão (conta conectada, papel, perfil no servidor — pendente, documentos jurídicos — pendente); aviso de que a conta **não está habilitada para uso comercial**; *Sair*.
- *Sair* encerra a sessão **deste dispositivo** (`signOut({ scope: "local" })`), limpa o papel local e volta para `/entrar`.

## Testes

| Teste | Onde | O que cobre |
| ----- | ---- | ----------- |
| `pnpm --filter @edusearch/web test:unit` | local e CI | Escopos, `redirectTo`, saneamento de `next` (open redirect), nonce/intenção (válida, ausente, diferente, expirada, adulterada), leitura do callback (cancelado, não autorizado, erro no fragmento, sem código, código malformado), remoção de tokens do Google, identidade de exibição |
| `scripts/auth.mjs` | **GitHub Actions** (job `checks`) | Navegador real contra dois servidores: versão pública (login desligado, sem requisições ao Supabase) e ambiente de testes com **Supabase falso interceptado** (nenhuma chamada real): botão, escopos, PKCE, `redirect_to`, todos os erros do callback, troca recusada, sucesso, dados na conta, ausência de `provider_token`, restauração, papel, logout (`scope=local`), proteção de rota e demonstração preservada |
| `scripts/smoke.mjs` | CI | Inclui `/auth/callback` e `/conta` sem erros de console |

Para rodar o teste de navegador localmente (opcional; preferimos o CI):

```bash
pnpm --filter @edusearch/web exec vite --port 5190 &
VITE_AUTH_GOOGLE_ENABLED=true VITE_SUPABASE_URL=https://edusearch-ci-fake.supabase.co \
  VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_ci_fake_key pnpm --filter @edusearch/web exec vite --port 5191 &
node apps/web/scripts/auth.mjs http://localhost:5190 http://localhost:5191
```

### Validação manual com o Google real (após a configuração)

1. Configure Google Cloud e Supabase como acima e adicione sua conta em *Test users*.
2. `apps/web/.env` com as três variáveis; `pnpm dev:web`.
3. `/entrar` → *Continuar com o Google* → escolha a conta → deve abrir `/conta` com seus dados.
4. Recarregue (sessão restaurada), escolha um papel, clique em *Sair*.
5. Com uma conta **fora** da lista de testes, o Google deve bloquear o acesso (ou o hook, se configurado, deve levar a "Conta não liberada para testes").
