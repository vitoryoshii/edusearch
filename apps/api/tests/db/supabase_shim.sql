-- SOMENTE PARA TESTES em um PostgreSQL "puro" (sem a imagem do Supabase).
--
-- Reproduz o mínimo do Supabase de que as migrations dependem: papéis (anon, authenticated,
-- service_role, supabase_auth_admin), schema auth com auth.users, auth.uid()/auth.jwt()/auth.role()
-- e os privilégios PADRÃO do Supabase em public (tudo para anon/authenticated), para que os testes
-- comprovem que as migrations revogam o que não deve ficar exposto.
--
-- No CI o banco é o do Supabase CLI (imagem oficial) e este arquivo NÃO é usado.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;
end
$$;

grant anon, authenticated, service_role to current_user;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role, supabase_auth_admin;
grant usage on schema public to anon, authenticated, service_role;

create table if not exists auth.users (
  id                 uuid primary key,
  aud                text default 'authenticated',
  role               text default 'authenticated',
  email              text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  raw_app_meta_data  jsonb default '{}'::jsonb,
  is_anonymous       boolean not null default false,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

-- Privilégios padrão do Supabase para objetos novos em public.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
