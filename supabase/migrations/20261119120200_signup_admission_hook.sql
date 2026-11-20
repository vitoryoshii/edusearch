-- EduSearch — Fase 2.6A: controle de admissão de usuários de teste (Before User Created Hook).
--
-- Esta migration só CRIA a função e a allowlist. Ela NÃO liga o hook nem abre o cadastro:
-- isso é feito manualmente em Authentication → Hooks → Before User Created, após aprovação
-- (procedimento em docs/database-design.md, seção "Controle de admissão").
--
-- A lista de "Test users" do Google Cloud não basta: qualquer pessoa com um ID token válido para
-- o Client ID consegue criar conta no Supabase. O hook roda no servidor de Auth antes do insert
-- em auth.users, para QUALQUER método (Google, e-mail, etc.).

-- Allowlist fora da Data API (schema private): não aparece para anon/authenticated.
create table private.signup_allowlist (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now(),
  constraint signup_allowlist_email_normalized check (email = lower(btrim(email))),
  constraint signup_allowlist_email_format check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint signup_allowlist_note_len check (note is null or char_length(note) <= 200)
);
alter table private.signup_allowlist enable row level security;
revoke all on table private.signup_allowlist from public, anon, authenticated;
comment on table private.signup_allowlist is
  'E-mails autorizados a criar conta durante a fase de testes. Somente contas de teste/fictícias.';

create function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(event -> 'user' ->> 'email', '')));
begin
  if v_email <> '' and exists (select 1 from private.signup_allowlist a where a.email = v_email) then
    return '{}'::jsonb;
  end if;

  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'Cadastro restrito a usuários de teste autorizados.'
    )
  );
end;
$$;
comment on function public.hook_before_user_created(jsonb) is
  'Before User Created Hook: aceita só e-mails da allowlist. Executável apenas por supabase_auth_admin.';

-- Somente o servidor de Auth pode executar (lints 0028/0029). Como a função é SECURITY DEFINER
-- (dona: a mesma da allowlist), o supabase_auth_admin NÃO recebe acesso ao schema private nem
-- à tabela: só EXECUTE nesta função.
revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
