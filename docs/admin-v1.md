# EduSearch Admin V1

O Admin é uma aplicação independente em `apps/admin`, destinada a `admin.edusearch.com.br`.
Ele usa a sessão Supabase existente somente para obter um JWT; toda autorização é revalidada pela
API. Nenhum e-mail, domínio, `user_metadata` ou papel público (`student`/`teacher`) concede acesso.

## RBAC

| Papel | Permissões |
| --- | --- |
| `super_admin` | Todas as permissões administrativas |
| `operations_admin` | dashboard, usuários, professores, aulas, integrações e auditoria |
| `finance_admin` | dashboard, pagamentos e auditoria |
| `support_admin` | dashboard, consultas de usuários/professores/aulas, notificações e integrações |
| `auditor` | auditoria |

As memberships ficam em `private.admin_memberships`, sem grants a `anon` ou `authenticated`.
O backend conecta como `edusearch_api` e chama funções `SECURITY DEFINER` com `search_path` vazio;
as funções também conferem membership ativa e `profiles.status='active'`.

## Provisionamento inicial

Não há bootstrap automático. Após aplicar a migration em ambiente autorizado, um operador de banco
deve inserir o UUID já existente em `private.admin_memberships` por procedimento break-glass
registrado. Nunca usar o onboarding público, JWT metadata, e-mail ou PostgREST para este passo.

## Operação e rollback

1. Aplicar a migration em ambiente descartável e executar RLS/Security Advisor.
2. Criar o projeto Cloudflare Pages `edusearch-admin`, root `apps/admin`, build `pnpm build:admin`.
3. Configurar somente `VITE_API_BASE_URL`, `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY`.
4. Adicionar `https://admin.edusearch.com.br` à allowlist CORS exata da API antes de publicar.
5. Verificar um administrador provisionado e um usuário comum (403).

## Autenticação administrativa

O Admin possui seu próprio armazenamento de sessão (`edusearch-admin-auth`); ele não pressupõe
cookies ou `localStorage` compartilhados com `app.edusearch.com.br`. O botão usa Google Identity
Services com nonce aleatório em memória, SHA-256 enviado ao GIS e nonce original enviado somente ao
Supabase em `signInWithIdToken`. A sessão Supabase é então apresentada à API, que chama
`GET /v1/admin/me`; um JWT válido sem membership ativa recebe `403`, e sessão ausente/expirada
recebe `401`. Nenhum desses estados concede acesso ao painel.

Variáveis públicas do Cloudflare Pages (`apps/admin`):

```env
VITE_API_BASE_URL=https://api.edusearch.com.br
VITE_SUPABASE_URL=<url pública do projeto>
VITE_SUPABASE_PUBLISHABLE_KEY=<chave publishable>
VITE_GOOGLE_CLIENT_ID=<client id web do Google>
```

No Supabase Auth e no Google Cloud, adicionar exatamente `https://admin.edusearch.com.br` às
origens JavaScript autorizadas. Como o fluxo GIS usa popup/ID token, não há redirect OAuth de login
para registrar; se o produto adicionar e-mail/OAuth redirecionado no futuro, registrar também uma
URL de callback específica do Admin. Não usar secret key, service role, client secret do Google ou
segredo de dispatcher no Cloudflare Pages.

Rollback: remover o deployment/rota do Cloudflare e revogar as memberships ativas. Não apagar
auditoria. A migration é aditiva; não execute rollback destrutivo em produção.

## Limitações V1

O dashboard e a listagem/transição de professores usam dados persistidos. Operações financeiras,
reembolso, cobrança, saque, envio manual e gestão de administradores permanecem indisponíveis até
terem contratos e controles operacionais próprios. Split e saques não são habilitados pelo Admin.
