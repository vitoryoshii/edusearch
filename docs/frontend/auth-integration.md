# Autenticação real — Google Identity Services + Supabase Auth (Fases 2.4 e 2.5)

Login com Google no app PWA (`apps/web`) **sem sair do domínio do app**: o botão oficial do Google Identity Services (GIS) devolve um ID token à própria página e o Supabase o valida com `signInWithIdToken`. Não há redirecionamento do navegador para `*.supabase.co`.

> **Estado:** pronto para um **ambiente restrito de testes**. O login real só é ativado quando as três variáveis públicas estão configuradas; sem elas (padrão), o app continua 100% demonstração.
>
> **O cadastro público NÃO está liberado.** Depende de: controle de admissão no servidor (hook com allowlist), revisão de RLS, API de perfis com autorização no FastAPI, Termos de Uso e Política de Privacidade publicados e aprovação do responsável pelo produto. Um login do Google bem-sucedido **não** torna o app pronto para produção.

## Fluxo

```text
/  (entrada única — Fase 2.5; /entrar e /cadastro redirecionam para cá)
  1. Web Crypto gera um nonce de 256 bits (base64url) e seu SHA-256 (hex).
     O nonce original fica só na memória da aba (cofre de uso único, 10 min).
  2. google.accounts.id.initialize({ client_id, nonce: <hash>, ux_mode: "popup", auto_select: false })
     google.accounts.id.renderButton(...)  → botão oficial "Continuar com o Google"
  3. Usuário escolhe a conta no seletor do Google (popup/FedCM do próprio Google).
  4. O GIS chama o callback com o ID token (claim nonce = <hash>).
  5. Pré-checagem local: formato, emissor (accounts.google.com), público (= Client ID),
     validade e nonce conhecido → o nonce original é retirado do cofre (uso único).
  6. supabase.auth.signInWithIdToken({ provider: "google", token, nonce: <original> })
     → POST https://pgltvnwdvatyihrozlvn.supabase.co/auth/v1/token?grant_type=id_token (fetch, sem navegação)
     O Supabase valida assinatura, emissor, público e SHA-256(nonce) == claim.
  7. Sessão do Supabase criada; a sessão demonstrativa da aba é encerrada (nada é migrado).
  8. next (padrão /conta): primeiro acesso → /conta/boas-vindas → onboarding de aluno ou professor
     (ver onboarding.md); papel já escolhido → /conta com "Continuar cadastro".
```

Escopos: o fluxo de ID token do GIS concede apenas **`openid`, `email` e `profile`**. Não há como pedir Google Agenda, Meet, Drive ou Gmail por ele — essas integrações terão consentimento próprio (no backend) em outra etapa.

## Arquivos

| Arquivo | Papel |
| ------- | ----- |
| `apps/web/src/lib/auth/config.ts` | Lê as 3 variáveis públicas; ativa o login só com todas válidas; **recusa segredos** (`sb_secret_…`, JWT `service_role`, `GOCSPX-…`) |
| `apps/web/src/lib/auth/gis.ts` | Carrega o script oficial do GIS **uma vez**; `initialize` **uma vez por nonce** (seguro no React StrictMode); repassa a credencial só ao componente montado |
| `apps/web/src/lib/auth/oauth.ts` | Regras puras e testadas: nonce + SHA-256, cofre de uso único, pré-checagem do ID token, classificação de erros, mensagens, saneamento do destino |
| `apps/web/src/lib/auth/profile.ts` | Modelo de apresentação `AuthenticatedProfile`, foto (Google x personalizada), dados da sessão |
| `apps/web/src/lib/auth/supabase.ts` | Cliente Supabase **único**, carregado sob demanda (quem só usa a demonstração não baixa o SDK) |
| `apps/web/src/app/auth.tsx` | `AuthProvider`/`useAuth`: restauração, login, logout, sessão expirada, `RequireAuth`, JWT para a API, papel provisório |
| `apps/web/src/components/GoogleSignIn.tsx` | Botão oficial do GIS com estados de carregamento, entrada, erro e nova tentativa |
| `apps/web/src/components/AppShell.tsx` | Modo `account`: cabeçalho, menu do usuário (avatar) e navegação da conta real, sem dados da demonstração |
| `apps/web/src/components/AccountProfile.tsx` | Resumo do perfil, escolha de papel provisória e etapas de conclusão |
| `apps/web/src/pages/account/{Dashboard,Profile,Settings}.tsx` | `/conta`, `/conta/perfil`, `/conta/configuracoes` |
| `packages/ui/src/components/Display.tsx` | `Avatar`: foto circular centralizada, sem Referer, com volta às iniciais se a imagem falhar |

```ts
type AuthenticatedProfile = {
  id: string;            // ID do usuário no Supabase (auth.users.id)
  displayName: string;   // full_name → name → parte local do e-mail → "Sua conta"
  email: string | null;
  avatarUrl: string | null; // foto personalizada (futura) → avatar_url/picture do Google
};
```

## Variáveis de ambiente (todas públicas)

| Variável | Valor | Observação |
| -------- | ----- | ---------- |
| `VITE_SUPABASE_URL` | `https://pgltvnwdvatyihrozlvn.supabase.co` | Projeto `edusearch-db` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | chave publicável | *Project Settings → API Keys → Publishable key* (`sb_publishable_…`). **Nunca** a secret/`service_role` |
| `VITE_GOOGLE_CLIENT_ID` | `…apps.googleusercontent.com` | Client ID OAuth do tipo **Aplicativo da Web**. **Nunca** o Client Secret (`GOCSPX-…`) |

Nunca coloque no frontend: Client Secret do Google, `service_role`/secret key do Supabase, chaves privadas ou credenciais do PostgreSQL. Variáveis `VITE_*` vão para o bundle do navegador; o CI falha se encontrar `GOCSPX-…` ou `sb_secret_…` nos bundles.

**Local:** copie `apps/web/.env.example` para `apps/web/.env` (ignorado pelo Git), preencha e rode `pnpm --filter @edusearch/web exec vite --port 5190`.

**Cloudflare Pages** (*Settings → Environment variables*, por ambiente; o Vite embute os valores no build, então é preciso um novo deploy após alterar):

- **Preview** (ambiente de testes): as três variáveis. Use uma URL de preview **fixa** (ex.: alias da branch) e registre essa origem no Google Cloud.
- **Production** (`app.edusearch.com.br`): **não** defina `VITE_GOOGLE_CLIENT_ID` até a aprovação. Sem ele, a produção continua só com a demonstração.

## Configuração pendente — Google Cloud (projeto EduSearch)

1. **Google Auth Platform → Público-alvo:** tipo **Externo**, status **Testing**. Adicione as contas autorizadas em **Test users**. Não publique o app sem aprovação.
2. **Branding:** nome "EduSearch", e-mail de suporte, domínios autorizados `edusearch.com.br` (cobre `app.edusearch.com.br`). Links de Política de Privacidade e Termos são obrigatórios antes de publicar.
3. **Acesso a dados:** somente `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`.
4. **Clientes → o cliente Web existente:**
   - **Origens JavaScript autorizadas** (exatas, sem curingas):
     - `https://app.edusearch.com.br` (somente quando a produção for aprovada)
     - `http://localhost:5190` **e** `http://localhost` (o GIS exige as duas para desenvolvimento local)
     - a URL fixa do preview de testes
   - **URIs de redirecionamento:** não são usadas pelo GIS em modo popup. Se já existir `https://pgltvnwdvatyihrozlvn.supabase.co/auth/v1/callback` (fluxo anterior), pode permanecer.
5. Copie apenas o **Client ID** para `VITE_GOOGLE_CLIENT_ID`. O Client Secret não é usado pelo frontend.

## Configuração pendente — Supabase (`edusearch-db`)

1. **Authentication → Sign In / Providers → Google:** habilitado; em **Client IDs** (IDs autorizados), inclua o Client ID Web acima — o Supabase recusa ID tokens emitidos para outros clientes. **Skip nonce check: desligado.** (O Client Secret só é necessário para o fluxo de redirecionamento.)
2. **Project Settings → API Keys:** use a **Publishable key** no frontend.
3. **Controle de admissão (obrigatório antes de abrir o cadastro).** O modo *Testing* do Google e qualquer lista na interface **não** impedem a criação de contas no Supabase por quem obtiver um ID token válido para o Client ID. Solicitar à equipe de backend um **Before User Created Hook** com allowlist. Sugestão para revisão (não aplicada — esta fase não cria migrations):

   ```sql
   create table if not exists public.auth_test_allowlist (email text primary key);
   alter table public.auth_test_allowlist enable row level security; -- sem políticas: invisível via API

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

   Ativação: *Authentication → Hooks → Before User Created*. O app já mostra "Conta não liberada para testes" quando o Supabase recusa o cadastro.
4. **Antes de abrir o cadastro:** revisar RLS de todas as tabelas expostas e criar o perfil com papel **definido pelo servidor**.

## Segurança

| Regra | Implementação |
| ----- | ------------- |
| Sem segredos no navegador | Só URL, chave publicável e Client ID. `config.ts` desativa o login se detectar segredo; o CI procura segredos nos bundles |
| Nonce | 256 bits via `crypto.getRandomValues`; o Google recebe o SHA-256 (hex), o Supabase recebe o original. Guardado só em memória, **uso único**, validade de 10 min; cada tentativa recebe um nonce novo |
| ID token do Google | Nunca é gravado (local/sessionStorage), registrado em log nem colocado em URL. Só trafega no corpo do POST ao Supabase |
| Reenvio de token | Um ID token já usado é recusado localmente (nonce consumido) antes de chegar ao Supabase |
| Pré-checagem | Emissor, público (= Client ID), expiração e formato do nonce, para recusar cedo credenciais de outra origem. A validação de verdade (assinatura) é do Supabase |
| StrictMode e respostas atrasadas | Script e `initialize` únicos por nonce; o callback só é entregue ao componente montado; respostas após desmontagem são descartadas; credenciais duplicadas durante uma troca são ignoradas |
| Autenticação ≠ autorização | O app só sabe **quem** é o usuário. Papel escolhido é provisório (localStorage, por usuário) e `user_metadata` é usado só para exibir nome/foto. **Nenhuma permissão** depende deles |
| JWT para APIs | O cliente HTTP envia o **access token do Supabase** (nunca o ID token do Google) |
| Demonstração separada | Sessão real em `localStorage['edusearch-auth']`; demo em `sessionStorage['edusearch-demo-session']`. Ao entrar, a sessão demo da aba é encerrada; nada é migrado para o Supabase |
| Logout | `signOut({ scope: "local" })` (revoga a sessão deste dispositivo), `disableAutoSelect()` do GIS, limpeza de nonces e do papel provisório |
| Cabeçalhos | Se forem adicionados no futuro: `Cross-Origin-Opener-Policy: same-origin-allow-popups` (necessário ao popup do Google) e CSP com `script-src https://accounts.google.com/gsi/client`, `frame-src https://accounts.google.com/gsi/`, `connect-src https://accounts.google.com/gsi/ https://pgltvnwdvatyihrozlvn.supabase.co`, `style-src https://accounts.google.com/gsi/style`. O `Referrer-Policy: strict-origin-when-cross-origin` atual é compatível (o GIS exige o Referer de origem) |

## Sessão: restauração e expiração

- A sessão do Supabase fica em `localStorage['edusearch-auth']`. Ao abrir o app, o SDK só é baixado se houver sessão gravada; a sessão é restaurada e **confirmada no servidor** (`getUser`).
- O JWT de acesso é renovado automaticamente (`autoRefreshToken`).
- Se o servidor recusar a sessão (revogada, usuário removido) ou a renovação falhar, o SDK emite `SIGNED_OUT`: o app limpa a sessão, leva a `/?next=…` (entrada única) e mostra **"Sua sessão expirou"**.
- Rotas `/conta/*` são protegidas por `RequireAuth` (carregamento → login com `next` saneado).

## Avatar e dados do Google

- Campos usados: `user.id`, `user.email`, `user_metadata.full_name | name`, `user_metadata.avatar_url | picture`.
- Foto exibida no cabeçalho, no avatar do menu do usuário, no início da conta, em Meu perfil e em Configurações.
- Regras: foto do Google só por HTTPS em `*.googleusercontent.com`; circular, `object-cover` centralizado, tamanho fixo (sem quebra de layout); `referrerpolicy="no-referrer"`; se falhar ao carregar, **iniciais**.
- `resolveAvatar` dá prioridade a uma **foto personalizada** (futura) e nunca a sobrescreve com a do Google. A foto do Google não é copiada para o Storage e **não** comprova credenciais profissionais.

## Integração futura com o FastAPI

Com a sessão ativa, o `AuthProvider` registra `setAccessTokenProvider` e o cliente HTTP (`src/lib/api/client.ts`) envia `Authorization: Bearer <access_token do Supabase>`. Nenhum endpoint novo foi criado ou presumido no frontend. Responsabilidades do backend:

- validar a assinatura do JWT (JWKS `https://pgltvnwdvatyihrozlvn.supabase.co/auth/v1/.well-known/jwks.json` ou segredo legado), `iss`, `aud = authenticated` e `exp`;
- usar `sub` como ID do usuário e obter papel/privilégios de tabelas controladas pelo servidor — nunca de `user_metadata`, do corpo da requisição ou do ID token do Google;
- validar a propriedade de cada recurso.

## Experiência

- `/` (entrada única, Fase 2.5 — ver [onboarding.md](onboarding.md)): esqueleto enquanto o GIS carrega, botão oficial (tema claro `outline`, escuro `filled_black`, texto "Continuar com o Google", pt-BR), aviso discreto "Fase de testes: somente contas autorizadas", estado "Entrando com sua conta Google…" e erros com `role="alert"`. Não existe login por e-mail e senha. Sem configuração, aparece o botão desabilitado do design system. `/entrar` e `/cadastro` redirecionam para `/` preservando um `next` seguro.
- Cancelar o seletor do Google não gera erro: a tela continua como estava.

| Falha | Quando | Mensagem |
| ----- | ------ | -------- |
| `invalid_token` | Token malformado, de outro Client ID, expirado ou recusado pelo Supabase | "Não foi possível validar sua conta Google" |
| `invalid_nonce` | Nonce desconhecido, expirado, reutilizado ou recusado pelo Supabase | "Login não confirmado por segurança" |
| `not_allowed` | Cadastro recusado (hook/allowlist, cadastro desativado) | "Conta não liberada para testes" |
| `network` | Falha de conexão com o Supabase | "Sem conexão com o servidor de login" |
| `gis_unavailable` | Script do Google bloqueado ou indisponível | "Login do Google indisponível" + *Tentar carregar novamente* |
| `provider_error` | Outros erros do serviço | "Não foi possível concluir o login" |
| `session_expired` | Sessão revogada ou renovação falhou | "Sua sessão expirou" |

- `/conta/boas-vindas`: primeiro acesso, "Quero aprender" / "Quero ensinar" (preferência local, sem permissões).
- `/conta/cadastro/aluno` e `/conta/cadastro/professor`: onboarding em etapas, **sem persistência** (ver [onboarding.md](onboarding.md)).
- `/conta`: saudação, foto, nome e e-mail; **"Continuar cadastro"** com selo "Cadastro em análise"; aviso de que a conta **não está habilitada para uso comercial**. Sem papel escolhido, redireciona às boas-vindas.
- `/conta/perfil`: foto grande, escolha **provisória** de papel (aluno/professor), etapas de conclusão (perfil no servidor e documentos jurídicos pendentes) e "Concluir perfil" bloqueado.
- `/conta/configuracoes`: tema, conta e sessão, *Sair da conta*.

## Testes

| Teste | Onde | Cobertura |
| ----- | ---- | --------- |
| `pnpm --filter @edusearch/web test:unit` | local e CI | Escopos, destino, nonce (formato, SHA-256 conferido com `node:crypto`, unicidade), cofre (uso único, expiração), pré-checagem do token (emissor, Client ID, expiração, nonce), erros do Supabase, perfil (avatar presente/ausente, nome ausente, foto inválida, foto personalizada), sessão, remoção de tokens de provedor |
| `scripts/auth.mjs` | **GitHub Actions** | Navegador real com **GIS e Supabase falsos** (só no teste): versão pública sem GIS/Supabase; inicialização única do GIS no StrictMode; nonce em hash; cancelamento; token inválido (cliente e servidor); nonce inválido; reenvio bloqueado; erro de rede; sucesso; nonce original conferido pelo servidor falso; ID token ausente de storage e URLs; avatar presente, ausente e quebrado; usuário sem perfil concluído; restauração; sessão revogada → aviso; logout e novo login; proteção de rotas; separação da demonstração; capturas em 390/1440 px, claro e escuro (artefato `screenshots-auth`) |
| `scripts/smoke.mjs` | CI | Inclui `/conta` |
| Varredura de segredos | CI | `GOCSPX-…` e `sb_secret_…` nos bundles |

O CI **nunca** usa credenciais reais: os valores do servidor de testes são fictícios e todas as chamadas ao Google e ao Supabase são interceptadas.

## Passos para o teste real (manual)

1. Concluir as configurações do Google Cloud e do Supabase acima e incluir sua conta em *Test users* (e na allowlist, se o hook estiver ativo).
2. `apps/web/.env` com as três variáveis; `pnpm --filter @edusearch/web exec vite --port 5190`.
3. `http://localhost:5190/` → *Continuar com o Google* → escolher a conta → `/conta/boas-vindas` (primeiro acesso) com nome e foto.
4. Escolher *Quero aprender* ou *Quero ensinar*, percorrer o onboarding, recarregar (sessão restaurada) e abrir Meu perfil e Configurações.
5. Voltar a `/`: deve aparecer *Continuar como <nome>*.
6. *Sair da conta* → entrar novamente.
7. *Explorar demonstração* e confirmar que ela continua independente.
8. Com uma conta fora da lista de testes, o acesso deve ser recusado ("Conta não liberada para testes").

## Limitações atuais

- Perfil e papel não são persistidos no servidor; "Concluir perfil" fica bloqueado.
- Sem foto personalizada (a estrutura já prioriza uma futura foto própria).
- O cancelamento do seletor do Google não gera evento (comportamento do GIS); a tela apenas permanece disponível.
- O teste de navegador usa mocks; a validação ponta a ponta com o Google real depende das configurações externas.
- Termos de Uso e Política de Privacidade ainda não publicados; cadastro público bloqueado.
