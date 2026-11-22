-- EduSearch — Fase 3A: disponibilidade, aulas de TESTE e conexão com o Google Agenda/Meet.
--
-- Decisões (detalhes em docs/google-calendar-integration.md):
-- * Aulas desta fase são SEMPRE de teste (is_test = true, sem preço nem pagamento). Liberar aulas
--   comerciais exige outra migration e aprovação.
-- * Conflitos de horário são impedidos pelo BANCO (EXCLUDE com btree_gist), por professor e por
--   aluno, além da chave de idempotência por aluno (requisições duplicadas).
-- * Fuso único nesta fase: America/Sao_Paulo (janelas de disponibilidade em horário local).
-- * EXCEÇÃO DELIBERADA à regra da 2.6A ("sem tokens do Google em tabelas"): o refresh token do
--   Google Agenda do professor é guardado CIFRADO (AES-256-GCM, chave só na API, fora do banco)
--   em private.google_calendar_credentials. Nem anon nem authenticated alcançam o schema private;
--   só o papel de conexão da API (edusearch_api), e por RLS só para participantes.
-- * Nenhuma função SECURITY DEFINER é executável por anon/authenticated.

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------------------------
-- Utilitário: "sub" das claims da transação (mesma expressão da política de account_roles).
-- ---------------------------------------------------------------------------------------------
create function private.claims_sub()
returns uuid
language sql
stable
set search_path = ''
as $$
  select (nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;
comment on function private.claims_sub() is
  'sub das claims VERIFICADAS gravadas pela API na transação (request.jwt.claims).';
revoke all on function private.claims_sub() from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------------------------
create type public.lesson_status as enum ('scheduled', 'cancelled');
create type public.calendar_sync_status as enum ('not_connected', 'pending', 'synced', 'failed', 'removed');
comment on type public.calendar_sync_status is
  'Evento no Google Agenda do professor: not_connected (sem agenda), pending, synced, failed, removed (aula cancelada).';

-- ---------------------------------------------------------------------------------------------
-- Disponibilidade semanal do professor (horário de America/Sao_Paulo)
-- ---------------------------------------------------------------------------------------------
create table public.teacher_availability (
  id           uuid primary key default gen_random_uuid(),
  teacher_id   uuid not null references public.teacher_profiles (user_id) on delete cascade,
  weekday      public.weekday not null,
  start_minute smallint not null,
  end_minute   smallint not null,
  created_at   timestamptz not null default now(),
  constraint teacher_availability_minutes check (
    start_minute >= 0 and end_minute <= 1440 and end_minute > start_minute
    and start_minute % 15 = 0 and end_minute % 15 = 0
  ),
  constraint teacher_availability_unique unique (teacher_id, weekday, start_minute)
);
alter table public.teacher_availability enable row level security;
comment on table public.teacher_availability is
  'Janelas semanais de disponibilidade (minutos desde 00:00, America/Sao_Paulo). Sem sobreposição (validada na API).';

revoke all on table public.teacher_availability from public, anon, authenticated;
grant select, delete on public.teacher_availability to authenticated;
grant insert (teacher_id, weekday, start_minute, end_minute) on public.teacher_availability to authenticated;

create policy teacher_availability_select on public.teacher_availability
  for select to authenticated
  using (
    teacher_id = (select auth.uid())
    or exists (
      select 1 from public.teacher_profiles t
       where t.user_id = teacher_availability.teacher_id and t.is_published
    )
  );

create policy teacher_availability_insert_own on public.teacher_availability
  for insert to authenticated
  with check (
    teacher_id = (select auth.uid())
    and exists (
      select 1 from public.account_roles r
      where r.user_id = (select auth.uid()) and r.role = 'teacher'
    )
  );

create policy teacher_availability_delete_own on public.teacher_availability
  for delete to authenticated
  using (teacher_id = (select auth.uid()));

-- ---------------------------------------------------------------------------------------------
-- Aulas de teste
-- ---------------------------------------------------------------------------------------------
create table public.lessons (
  id                   uuid primary key default gen_random_uuid(),
  teacher_id           uuid not null references public.teacher_profiles (user_id) on delete cascade,
  student_id           uuid not null references public.student_profiles (user_id) on delete cascade,
  subject_id           smallint not null references public.subjects (id),
  starts_at            timestamptz not null,
  ends_at              timestamptz not null,
  status               public.lesson_status not null default 'scheduled',
  is_test              boolean not null default true,
  idempotency_key      uuid not null,
  calendar_sync_status public.calendar_sync_status not null default 'pending',
  google_event_id      text,
  meet_url             text,
  calendar_synced_at   timestamptz,
  cancelled_at         timestamptz,
  cancelled_by_role    public.account_role,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint lessons_test_only check (is_test),
  constraint lessons_distinct_people check (teacher_id <> student_id),
  constraint lessons_range check (ends_at > starts_at),
  constraint lessons_duration check (
    extract(epoch from (ends_at - starts_at)) in (1800, 2700, 3600, 5400)
  ),
  constraint lessons_cancel_consistent check (
    (status = 'cancelled') = (cancelled_at is not null)
    and (cancelled_at is null) = (cancelled_by_role is null)
  ),
  constraint lessons_event_id_format check (
    -- base32hex do Google; tamanho à parte (regex do PostgreSQL limita repetições a 255).
    google_event_id is null
    or (google_event_id ~ '^[a-v0-9]+$' and char_length(google_event_id) between 5 and 1024)
  ),
  constraint lessons_meet_url_format check (
    meet_url is null or meet_url ~ '^https://meet\.google\.com/[a-z0-9-]{3,64}$'
  ),
  constraint lessons_idempotency unique (student_id, idempotency_key),
  -- Conflitos de horário: nenhuma aula AGENDADA sobreposta para o mesmo professor nem aluno.
  constraint lessons_no_teacher_overlap exclude using gist (
    teacher_id with =, tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'scheduled'),
  constraint lessons_no_student_overlap exclude using gist (
    student_id with =, tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status = 'scheduled')
);
alter table public.lessons enable row level security;
create index lessons_subject_id_idx on public.lessons (subject_id);
comment on table public.lessons is
  'Aulas de TESTE (sem cobrança). Conflitos de horário e duplicidade impedidos por constraints.';

create trigger lessons_set_updated_at
  before update on public.lessons
  for each row execute function private.set_updated_at();

revoke all on table public.lessons from public, anon, authenticated;
grant select on public.lessons to authenticated;
grant insert (teacher_id, student_id, subject_id, starts_at, ends_at, idempotency_key)
  on public.lessons to authenticated;
-- Participantes só podem CANCELAR (status). Campos do Google são do servidor (edusearch_api).
grant update (status) on public.lessons to authenticated;

create policy lessons_select_participant on public.lessons
  for select to authenticated
  using ((select auth.uid()) in (teacher_id, student_id));

create policy lessons_insert_student on public.lessons
  for insert to authenticated
  with check (
    student_id = (select auth.uid())
    and exists (
      select 1 from public.account_roles r
      where r.user_id = (select auth.uid()) and r.role = 'student'
    )
    and exists (
      select 1 from public.teacher_profiles t
       where t.user_id = lessons.teacher_id and t.is_published
    )
  );

create policy lessons_update_participant on public.lessons
  for update to authenticated
  using ((select auth.uid()) in (teacher_id, student_id))
  with check ((select auth.uid()) in (teacher_id, student_id));

-- Regras que dependem de outras tabelas (defesa em profundidade; a API valida antes e responde
-- com mensagens próprias). SECURITY INVOKER: só enxerga o que o próprio aluno enxerga.
create function private.lessons_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_local timestamp := new.starts_at at time zone 'America/Sao_Paulo';
  v_local_end timestamp := new.ends_at at time zone 'America/Sao_Paulo';
  v_weekday public.weekday := (
    array['seg','ter','qua','qui','sex','sab','dom']::public.weekday[]
  )[extract(isodow from v_local)::int];
  v_start int := extract(hour from v_local)::int * 60 + extract(minute from v_local)::int;
  v_end int := v_start + (extract(epoch from (new.ends_at - new.starts_at)) / 60)::int;
begin
  new.status := 'scheduled';
  new.is_test := true;
  new.calendar_sync_status := 'pending';
  new.google_event_id := null;
  new.meet_url := null;
  new.calendar_synced_at := null;
  new.cancelled_at := null;
  new.cancelled_by_role := null;

  if new.starts_at <= pg_catalog.now() or new.starts_at > pg_catalog.now() + interval '60 days' then
    raise exception using errcode = 'check_violation', constraint = 'lessons_starts_window',
      message = 'horário fora da janela de agendamento';
  end if;
  if v_local::date <> v_local_end::date and v_local_end::time <> time '00:00' then
    raise exception using errcode = 'check_violation', constraint = 'lessons_within_availability',
      message = 'a aula precisa terminar no mesmo dia';
  end if;
  if not exists (
    select 1 from public.teacher_availability a
     where a.teacher_id = new.teacher_id and a.weekday = v_weekday
       and a.start_minute <= v_start and a.end_minute >= v_end
  ) then
    raise exception using errcode = 'check_violation', constraint = 'lessons_within_availability',
      message = 'horário fora da disponibilidade do professor';
  end if;
  if not exists (
    select 1 from public.teacher_profiles t
     where t.user_id = new.teacher_id
       and (extract(epoch from (new.ends_at - new.starts_at)) / 60)::smallint = any (t.lesson_durations_minutes)
  ) then
    raise exception using errcode = 'check_violation', constraint = 'lessons_duration_offered',
      message = 'duração não oferecida pelo professor';
  end if;
  if not exists (
    select 1 from public.teacher_subjects s
     where s.teacher_id = new.teacher_id and s.subject_id = new.subject_id
  ) then
    raise exception using errcode = 'check_violation', constraint = 'lessons_subject_offered',
      message = 'disciplina não oferecida pelo professor';
  end if;
  return new;
end;
$$;
comment on function private.lessons_before_insert() is
  'Aula de teste: força campos do servidor e confere janela, disponibilidade, duração e disciplina.';

create trigger lessons_before_insert
  before insert on public.lessons
  for each row execute function private.lessons_before_insert();

create function private.lessons_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception using errcode = 'check_violation', constraint = 'lessons_cancel_final',
      message = 'aula cancelada não pode voltar a ser agendada';
  end if;
  if old.status = 'scheduled' and new.status = 'cancelled' then
    new.cancelled_at := pg_catalog.now();
    -- auth.uid(): o trigger roda como quem escreve (authenticated), sem acesso ao schema private.
    new.cancelled_by_role := case
      when auth.uid() = old.teacher_id then 'teacher'::public.account_role
      else 'student'::public.account_role
    end;
  elsif new.status = old.status then
    -- Sem troca de status: os campos de cancelamento não mudam.
    new.cancelled_at := old.cancelled_at;
    new.cancelled_by_role := old.cancelled_by_role;
  end if;
  return new;
end;
$$;
comment on function private.lessons_before_update() is
  'Cancelamento é definitivo; data e autor do cancelamento são do servidor.';

create trigger lessons_before_update
  before update on public.lessons
  for each row execute function private.lessons_before_update();

-- As políticas de edusearch_api usam private.claims_sub(): o papel da API recebe USAGE no schema
-- private e EXECUTE nessa função. anon/authenticated continuam sem acesso ao private.
grant usage on schema private to edusearch_api;
grant execute on function private.claims_sub() to edusearch_api;

-- ---------------------------------------------------------------------------------------------
-- Perfis visíveis: o próprio, professores publicados e a outra parte de uma aula.
-- (Uma política só por ação: evita o lint 0006 de políticas permissivas múltiplas.)
-- ---------------------------------------------------------------------------------------------
drop policy profiles_select_own on public.profiles;
create policy profiles_select_visible on public.profiles
  for select to authenticated
  using (
    -- Colunas SEMPRE qualificadas: dentro da subconsulta, "id" sozinho seria lessons.id.
    profiles.id = (select auth.uid())
    or exists (
      select 1 from public.teacher_profiles t where t.user_id = profiles.id and t.is_published
    )
    or exists (
      select 1 from public.lessons l
       where (l.teacher_id = (select auth.uid()) and l.student_id = profiles.id)
          or (l.student_id = (select auth.uid()) and l.teacher_id = profiles.id)
    )
  );

-- ---------------------------------------------------------------------------------------------
-- Escrita dos campos do Google pela API (edusearch_api), limitada aos participantes da aula.
-- ---------------------------------------------------------------------------------------------
grant select on public.lessons to edusearch_api;
grant update (calendar_sync_status, google_event_id, meet_url, calendar_synced_at)
  on public.lessons to edusearch_api;

create policy lessons_select_via_api on public.lessons
  for select to edusearch_api
  using ((select private.claims_sub()) in (teacher_id, student_id));

create policy lessons_update_calendar_via_api on public.lessons
  for update to edusearch_api
  using ((select private.claims_sub()) in (teacher_id, student_id))
  with check ((select private.claims_sub()) in (teacher_id, student_id));

-- ---------------------------------------------------------------------------------------------
-- Credenciais do Google Agenda (refresh token CIFRADO). Só edusearch_api.
-- ---------------------------------------------------------------------------------------------
create table private.google_calendar_credentials (
  teacher_id               uuid primary key references public.teacher_profiles (user_id) on delete cascade,
  status                   text not null,
  refresh_token_ciphertext bytea,
  key_version              smallint,
  scopes                   text[] not null default '{}',
  connected_at             timestamptz,
  revoked_at               timestamptz,
  updated_at               timestamptz not null default now(),
  constraint gcal_status check (status in ('connected', 'revoked')),
  constraint gcal_token_iff_connected check (
    (status = 'connected') = (refresh_token_ciphertext is not null and key_version is not null)
  ),
  constraint gcal_ciphertext_len check (
    refresh_token_ciphertext is null or octet_length(refresh_token_ciphertext) between 29 and 4096
  ),
  constraint gcal_scopes_len check (cardinality(scopes) <= 20)
);
alter table private.google_calendar_credentials enable row level security;
revoke all on table private.google_calendar_credentials from public, anon, authenticated;
comment on table private.google_calendar_credentials is
  'Refresh token do Google Agenda do professor, CIFRADO pela API (AES-256-GCM). Nunca em texto puro.';

create trigger google_calendar_credentials_set_updated_at
  before update on private.google_calendar_credentials
  for each row execute function private.set_updated_at();

grant select, insert, update, delete on private.google_calendar_credentials to edusearch_api;

-- Leitura/atualização: o próprio professor, ou o aluno de uma aula com ele (criar/cancelar o
-- evento ao reservar). Criação/remoção: somente o próprio professor.
create policy gcal_select_participant on private.google_calendar_credentials
  for select to edusearch_api
  using (
    teacher_id = (select private.claims_sub())
    or exists (
      select 1 from public.lessons l
       where l.teacher_id = google_calendar_credentials.teacher_id
         and l.student_id = (select private.claims_sub())
    )
  );
create policy gcal_update_participant on private.google_calendar_credentials
  for update to edusearch_api
  using (
    teacher_id = (select private.claims_sub())
    or exists (
      select 1 from public.lessons l
       where l.teacher_id = google_calendar_credentials.teacher_id
         and l.student_id = (select private.claims_sub())
    )
  )
  with check (
    teacher_id = (select private.claims_sub())
    or exists (
      select 1 from public.lessons l
       where l.teacher_id = google_calendar_credentials.teacher_id
         and l.student_id = (select private.claims_sub())
    )
  );
create policy gcal_insert_own on private.google_calendar_credentials
  for insert to edusearch_api
  with check (teacher_id = (select private.claims_sub()));
create policy gcal_delete_own on private.google_calendar_credentials
  for delete to edusearch_api
  using (teacher_id = (select private.claims_sub()));

-- ---------------------------------------------------------------------------------------------
-- Horários ocupados de um professor publicado (sem dizer de quem). Só edusearch_api executa.
-- ---------------------------------------------------------------------------------------------
create function private.teacher_busy_ranges(p_teacher uuid, p_from timestamptz, p_to timestamptz)
returns table (starts_at timestamptz, ends_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_to <= p_from or p_to - p_from > interval '62 days' then
    raise exception using errcode = 'invalid_parameter_value', message = 'intervalo inválido';
  end if;
  if not exists (
    select 1 from public.teacher_profiles t
     where t.user_id = p_teacher and (t.is_published or t.user_id = private.claims_sub())
  ) then
    return;
  end if;
  return query
    select l.starts_at, l.ends_at
      from public.lessons l
     where l.teacher_id = p_teacher and l.status = 'scheduled'
       and l.starts_at < p_to and l.ends_at > p_from
     order by l.starts_at;
end;
$$;
comment on function private.teacher_busy_ranges(uuid, timestamptz, timestamptz) is
  'Intervalos ocupados de um professor publicado (ou do próprio). Executável só por edusearch_api.';
revoke all on function private.teacher_busy_ranges(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function private.teacher_busy_ranges(uuid, timestamptz, timestamptz) to edusearch_api;
