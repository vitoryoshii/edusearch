# Persistência real do perfil (Fase 2.6B)

O onboarding de aluno e professor deixa de ser só uma prévia: o papel e os cadastros são salvos e lidos da API FastAPI, com o JWT do Supabase e RLS no banco. A demonstração continua fictícia e separada.

## Feature flag

| `VITE_STAGE_PROFILE_PERSISTENCE` | Comportamento |
| -------------------------------- | ------------- |
| `off` (**padrão**, deployments públicos) | Comportamento da Fase 2.5.1: prévia sem envio, papel como preferência local, "Salvar perfil" bloqueado |
| `testing` | Persistência real. Exige login real (Supabase + Google ou e-mail) e `VITE_API_BASE_URL` apontando para a API |
| `production` | Igual a `testing`. Sem documentos jurídicos publicados (`VITE_LEGAL_*`), cai para `testing` |

Sem login real configurado, a flag fica `off` (`src/lib/stages.ts`, com testes unitários). **Não** defina a variável no Cloudflare Pages de produção até haver aprovação, API hospedada e migrations aplicadas.

## Como funciona

```text
AuthProvider (sessão Supabase; token só com sessão ativa)
  └─ AccountProvider (src/app/account.tsx) ── GET /v1/me ──▶ papel, estado do cadastro, nome e foto
       └─ RequireAccount: carregando · erro + "Tentar novamente" · 401 "Sua sessão expirou"
            ├─ /conta/boas-vindas      POST /v1/me/roles (só avança após sucesso)
            ├─ /conta/cadastro/aluno   GET (404 = rascunho vazio) · PUT ao final
            ├─ /conta/cadastro/professor   idem (salvar NÃO aprova nem publica)
            ├─ /conta                  estado real: aluno concluído/pendente; professor em análise/publicado
            ├─ /conta/perfil           papéis do servidor; "Adicionar perfil" (POST /v1/me/roles)
            └─ /conta/configuracoes    nome e foto (PUT /v1/me/profile): foto do Google ou sem foto
```

- **Fonte de verdade:** com a flag ligada, o papel vem de `me.roles`. O `localStorage` não é lido nem gravado para papel, e nada do cadastro vai para storage.
- **Concluído = sucesso da API.** "Salvar perfil" mostra carregamento. Em caso de erro, aparece um alerta (`role=alert`) com a mensagem da API e "Tentar novamente", e a tela não avança. No sucesso, o `/v1/me` é atualizado, um toast confirma e a tela volta a `/conta`.
- **Mapeamento sem perda** (`src/lib/onboarding.ts`, testado): as faixas de valor viram centavos (exato e reversível), as durações vão ordenadas, textos opcionais vazios viram `null` e o valor é convertido para centavos sem ponto flutuante. Ver o quadro em [database-design.md](../database-design.md#onboarding--banco-fase-26b).
- **Catálogo:** as disciplinas vêm de `GET /v1/subjects`. No modo prévia segue o catálogo provisório.
- **Erros:** 401 leva a "Sua sessão expirou" com "Entrar novamente". 403 `role_required` volta às boas-vindas. 404 do cadastro gera um rascunho vazio. 422 mostra a mensagem da API. 5xx mostra uma mensagem genérica com nova tentativa.
- **Demonstração:** continua com `mockDataSource` e `sessionStorage`. Não chama a API real nem mostra dados de contas reais (verificado no teste de navegador).

## Testes

| Teste | Cobertura |
| ----- | --------- |
| `test:unit` | Flag (padrão `off`, exige login, `production` exige documentos) e mapeamento rascunho ↔ API (aluno, professor, faixas, centavos, incompleto não é enviado) |
| `scripts/persistence.mjs` (CI, porta 5192) | Login; `/v1/me` com o token do Supabase; papel gravado no servidor (não no storage); cadastro do aluno com 422 e 503 seguidos de sucesso; recarregar; reabrir o cadastro (GET); logout e novo login; usuário B isolado (só o token de B, sem dados de A, 403 sem papel); professor salvo pendente e não publicado; nome e foto; 401; demonstração sem chamadas à API; axe; 320–1440 px claro/escuro |
| `scripts/auth.mjs` (porta 5191, flag `off`) | O comportamento anterior (prévia) continua intacto |

## Para testar localmente com a API real

1. `supabase start` (raiz) e a API em `apps/api` com `API_SUPABASE_URL=http://127.0.0.1:54321` e `API_DATABASE_URL` como `edusearch_api` (ver `apps/api/README.md`).
2. `apps/web/.env`: Supabase local, `VITE_API_BASE_URL=http://localhost:8000` e `VITE_STAGE_PROFILE_PERSISTENCE=testing`.
3. `pnpm --filter @edusearch/web exec vite --port 5190`.
