-- EduSearch — Fase 2.6B: papel de conexão de MENOR PRIVILÉGIO para a API FastAPI.
--
-- A API não usa postgres (superusuário) nem service_role. Ela conecta como edusearch_api e:
-- * para ler/gravar dados do usuário, faz SET LOCAL ROLE authenticated (RLS normal);
-- * para o catálogo público, faz SET LOCAL ROLE anon;
-- * a ÚNICA escrita própria é atribuir papel (student/teacher) ao usuário do JWT verificado:
--   INSERT em account_roles, limitado por RLS ao "sub" das claims da transação.
--
-- O papel nasce NOLOGIN e sem senha. Habilitar o login é um passo MANUAL, com senha gerada fora
-- do Git (docs/database-design.md → "Conexão da API"). NOINHERIT: as permissões de
-- authenticated/anon só valem depois do SET ROLE explícito.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'edusearch_api') then
    create role edusearch_api nologin noinherit;
  end if;
end
$$;
comment on role edusearch_api is
  'Conexão da API EduSearch: SET ROLE authenticated/anon e atribuição de papéis via RLS. Sem BYPASSRLS.';

grant authenticated to edusearch_api;
grant anon to edusearch_api;
grant usage on schema public to edusearch_api;

-- Atribuição de papel: só INSERT (sem UPDATE/DELETE) e só nas duas colunas.
grant insert (user_id, role) on public.account_roles to edusearch_api;

-- Lê as claims diretamente (sem depender de privilégios no schema auth): o "sub" é o do JWT
-- verificado pela API e gravado com set_config na própria transação.
create policy account_roles_insert_via_api on public.account_roles
  for insert to edusearch_api
  with check (
    -- current_setting() direto dentro do (select ...): avaliado uma vez por consulta (initplan,
    -- lint 0003_auth_rls_initplan). NULLIF, extração do "sub" e conversão para uuid ficam fora.
    user_id = (nullif((select current_setting('request.jwt.claims', true)), '')::jsonb ->> 'sub')::uuid
  );
