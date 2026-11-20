-- EduSearch — Fase 2.6A: fundação de perfis (aluno/professor) e catálogo de disciplinas.
--
-- Decisões (detalhes em docs/database-design.md):
-- * A identidade é auth.users. public.profiles usa o MESMO id (FK com ON DELETE CASCADE) e não copia
--   e-mail, telefone ou provedor: nada de identidade duplicada.
-- * Papéis (aluno/professor) ficam em public.account_roles, gravada só pelo servidor. Nunca em
--   user_metadata (editável pelo próprio usuário).
-- * Dinheiro em centavos (integer). Sem senhas, segredos ou tokens do Google em nenhuma tabela.
-- * Funções internas ficam no schema "private", que não é exposto pela Data API.
-- * RLS e privilégios estão na migration seguinte (20261119120100_rls_policies.sql). Esta migration
--   já liga o RLS em cada tabela, para que nenhuma fique exposta entre as duas migrations.

-- ---------------------------------------------------------------------------------------------
-- Schema interno (fora da Data API)
-- ---------------------------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
comment on schema private is 'Funções e tabelas internas do EduSearch. Não exposto pela Data API.';

-- ---------------------------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------------------------
create type public.account_role as enum ('student', 'teacher');
comment on type public.account_role is 'Papel de produto da conta. Não há papel administrativo aqui.';

create type public.profile_status as enum ('onboarding', 'active', 'suspended');
comment on type public.profile_status is
  'onboarding: conta criada, cadastro incompleto; active: liberado; suspended: bloqueado pelo servidor.';

create type public.teacher_verification_status as enum ('pending', 'approved', 'rejected');

-- Vocabulário igual ao do frontend (apps/web/src/lib/onboarding.ts e src/lib/api/types.ts).
create type public.lesson_modality as enum ('online', 'presencial', 'hibrido');

create type public.education_level as enum (
  'fundamental', 'medio', 'pre-vestibular', 'graduacao', 'concursos', 'livre'
);

create type public.weekday as enum ('seg', 'ter', 'qua', 'qui', 'sex', 'sab', 'dom');

create type public.day_period as enum ('manha', 'tarde', 'noite');

create type public.experience_range as enum ('menos-1', '1-3', '3-5', '5-mais');

-- ---------------------------------------------------------------------------------------------
-- Funções utilitárias
-- ---------------------------------------------------------------------------------------------
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;
comment on function private.set_updated_at() is 'Trigger: mantém updated_at.';

-- ---------------------------------------------------------------------------------------------
-- profiles: 1:1 com auth.users
-- ---------------------------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_url   text,
  status       public.profile_status not null default 'onboarding',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint profiles_display_name_len check (char_length(display_name) between 1 and 80),
  constraint profiles_display_name_trimmed check (display_name = btrim(display_name)),
  constraint profiles_display_name_no_ctrl check (display_name !~ '[[:cntrl:]]'),
  constraint profiles_avatar_url_https check (
    avatar_url is null or (avatar_url ~ '^https://[^[:space:]]+$' and char_length(avatar_url) <= 2048)
  )
);
alter table public.profiles enable row level security;
comment on table public.profiles is
  'Perfil de apresentação de cada conta (mesmo id de auth.users). Sem e-mail: a identidade fica no Auth.';
comment on column public.profiles.status is 'Definido somente pelo servidor.';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- account_roles: papéis persistidos (servidor)
-- ---------------------------------------------------------------------------------------------
create table public.account_roles (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  role       public.account_role not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);
alter table public.account_roles enable row level security;
comment on table public.account_roles is
  'Papéis de cada conta. Gravada apenas pelo servidor (API/service_role); o usuário só lê os próprios.';

-- ---------------------------------------------------------------------------------------------
-- subjects: catálogo de disciplinas
-- ---------------------------------------------------------------------------------------------
create table public.subjects (
  id         smallint generated always as identity primary key,
  slug       text not null unique,
  name       text not null unique,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  constraint subjects_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  constraint subjects_name_len check (char_length(name) between 2 and 80)
);
alter table public.subjects enable row level security;
comment on table public.subjects is 'Catálogo oficial de disciplinas (dados de referência, sem dados pessoais).';

-- ---------------------------------------------------------------------------------------------
-- student_profiles: dados educacionais e preferências (privados)
-- ---------------------------------------------------------------------------------------------
create table public.student_profiles (
  user_id            uuid primary key references public.profiles (id) on delete cascade,
  learning_goal      text,
  education_level    public.education_level,
  difficulties       text,
  preferred_weekdays public.weekday[] not null default '{}',
  preferred_periods  public.day_period[] not null default '{}',
  preferred_modality public.lesson_modality,
  budget_min_cents   integer,
  budget_max_cents   integer,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint student_goal_len check (learning_goal is null or char_length(learning_goal) between 3 and 200),
  constraint student_difficulties_len check (difficulties is null or char_length(difficulties) <= 500),
  constraint student_weekdays_len check (cardinality(preferred_weekdays) <= 7),
  constraint student_periods_len check (cardinality(preferred_periods) <= 3),
  constraint student_budget_min_valid check (budget_min_cents is null or budget_min_cents >= 0),
  constraint student_budget_max_valid check (budget_max_cents is null or budget_max_cents <= 10000000),
  constraint student_budget_range check (
    budget_min_cents is null or budget_max_cents is null or budget_min_cents <= budget_max_cents
  )
);
alter table public.student_profiles enable row level security;
comment on table public.student_profiles is
  'Dados educacionais do aluno. PRIVADO: visível só ao próprio aluno (e ao servidor). '
  'Não usar dados reais de menores de idade em desenvolvimento.';

create trigger student_profiles_set_updated_at
  before update on public.student_profiles
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- teacher_profiles: apresentação profissional
-- ---------------------------------------------------------------------------------------------
create table public.teacher_profiles (
  user_id                 uuid primary key references public.profiles (id) on delete cascade,
  headline                text,
  bio                     text,
  academic_background     text,
  experience              public.experience_range,
  methodology             text,
  price_cents             integer,
  lesson_duration_minutes smallint not null default 60,
  modality                public.lesson_modality,
  verification_status     public.teacher_verification_status not null default 'pending',
  verified_at             timestamptz,
  is_published            boolean not null default false,
  published_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint teacher_headline_len check (headline is null or char_length(headline) between 3 and 120),
  constraint teacher_bio_len check (bio is null or char_length(bio) between 30 and 600),
  constraint teacher_background_len check (
    academic_background is null or char_length(academic_background) between 3 and 200
  ),
  constraint teacher_methodology_len check (methodology is null or char_length(methodology) <= 400),
  -- R$ 20,00 a R$ 1.000,00 (mesma regra do onboarding do frontend).
  constraint teacher_price_range check (price_cents is null or price_cents between 2000 and 100000),
  constraint teacher_duration_valid check (lesson_duration_minutes in (30, 45, 60, 90)),
  -- Aprovação e publicação são coerentes entre si: só se publica perfil aprovado.
  constraint teacher_verified_at_consistent check ((verification_status = 'approved') = (verified_at is not null)),
  constraint teacher_publish_requires_approval check (not is_published or verification_status = 'approved'),
  constraint teacher_published_at_consistent check (is_published = (published_at is not null))
);
alter table public.teacher_profiles enable row level security;
comment on table public.teacher_profiles is
  'Perfil profissional. verification_status, verified_at, is_published e published_at são do servidor.';

create index teacher_profiles_published_idx on public.teacher_profiles (user_id) where is_published;

create trigger teacher_profiles_set_updated_at
  before update on public.teacher_profiles
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------------------------
-- teacher_subjects: disciplinas atendidas
-- ---------------------------------------------------------------------------------------------
create table public.teacher_subjects (
  teacher_id uuid not null references public.teacher_profiles (user_id) on delete cascade,
  subject_id smallint not null references public.subjects (id) on delete restrict,
  levels     public.education_level[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (teacher_id, subject_id)
);
alter table public.teacher_subjects enable row level security;
-- A PK cobre buscas por professor; este índice cobre "professores de uma disciplina" e a FK.
create index teacher_subjects_subject_idx on public.teacher_subjects (subject_id);

-- ---------------------------------------------------------------------------------------------
-- Criação automática do perfil a partir de auth.users
-- ---------------------------------------------------------------------------------------------
-- O nome inicial vem de raw_user_meta_data apenas para EXIBIÇÃO (nunca para autorização).
create function private.display_name_from_auth(meta jsonb, email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.left(
    coalesce(
      nullif(pg_catalog.btrim(pg_catalog.regexp_replace(meta ->> 'full_name', '[[:cntrl:]]', '', 'g')), ''),
      nullif(pg_catalog.btrim(pg_catalog.regexp_replace(meta ->> 'name', '[[:cntrl:]]', '', 'g')), ''),
      nullif(pg_catalog.btrim(pg_catalog.split_part(email, '@', 1)), ''),
      'Sua conta'
    ),
    80
  );
$$;

create function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := pg_catalog.btrim(private.display_name_from_auth(new.raw_user_meta_data, new.email));
  v_avatar text := coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture');
begin
  if v_avatar is not null and (v_avatar !~ '^https://[^[:space:]]+$' or pg_catalog.char_length(v_avatar) > 2048) then
    v_avatar := null;
  end if;
  if v_name = '' then
    v_name := 'Sua conta';
  end if;
  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, v_name, v_avatar)
  on conflict (id) do nothing;
  return new;
end;
$$;
comment on function private.handle_new_auth_user() is
  'Trigger em auth.users: cria public.profiles. Não concede papel nem privilégio.';

-- Funções internas: ninguém além do dono executa diretamente. (Triggers não conferem EXECUTE ao
-- disparar, só na criação.) O Supabase concede EXECUTE por padrão a anon/authenticated.
revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.display_name_from_auth(jsonb, text) from public, anon, authenticated;
revoke all on function private.handle_new_auth_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- Contas que já existiam antes desta migration (ex.: testadores do ambiente de testes).
insert into public.profiles (id, display_name, avatar_url)
select
  u.id,
  private.display_name_from_auth(u.raw_user_meta_data, u.email),
  case
    when coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture') ~ '^https://[^[:space:]]+$'
     and char_length(coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture')) <= 2048
    then coalesce(u.raw_user_meta_data ->> 'avatar_url', u.raw_user_meta_data ->> 'picture')
  end
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------------------------
-- Catálogo inicial (dados de referência, sem dados pessoais)
-- ---------------------------------------------------------------------------------------------
insert into public.subjects (slug, name) values
  ('matematica', 'Matemática'),
  ('portugues', 'Português'),
  ('redacao', 'Redação'),
  ('fisica', 'Física'),
  ('quimica', 'Química'),
  ('biologia', 'Biologia'),
  ('historia', 'História'),
  ('geografia', 'Geografia'),
  ('ingles', 'Inglês'),
  ('espanhol', 'Espanhol'),
  ('programacao', 'Programação'),
  ('filosofia', 'Filosofia'),
  ('sociologia', 'Sociologia')
on conflict (slug) do nothing;
