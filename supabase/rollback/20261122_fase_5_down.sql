-- ROLLBACK da Fase 5 (pagamentos AbacatePay). NÃO é uma migration (fica fora de supabase/migrations).
--
-- Desfaz SOMENTE o que a Fase 5 adicionou; o schema da 3A volta exatamente como era.
-- ATENÇÃO: apaga TODO o histórico financeiro (cobranças, webhooks, auditoria, subcontas, reembolsos)
-- e as aulas pagas (is_test = false). Faça backup antes e exporte a trilha de auditoria.
-- Não desfaz cobranças no gateway: concilie/reembolse na AbacatePay ANTES de rodar.
-- Use só com aprovação explícita (docs/database-design.md → "Rollback").
--
-- Antes: API_PAYMENTS_STAGE=off na API e VITE_STAGE_PAYMENTS=off no app.
--
-- Os valores 'awaiting_payment' e 'expired' do enum lesson_status NÃO podem ser removidos pelo
-- Postgres sem recriar o tipo; ficam, sem uso (nenhuma linha os usa após este script).

begin;

-- 1) Gatilho e funções financeiras.
drop trigger if exists lessons_after_update_payment on public.lessons;
drop function if exists private.lessons_after_update_payment();
drop function if exists private.refund_set_status(uuid, public.refund_status, text);
drop function if exists private.payout_account_of(uuid, public.payment_environment);
drop function if exists private.payout_account_upsert(text, text, public.payment_environment);
drop function if exists private.payment_mark_after_paid(text, public.payment_status, text);
drop function if exists private.payment_close_unpaid(text, public.payment_status, text);
drop function if exists private.payment_confirm(text, integer, text);
drop function if exists private.payment_finish_webhook(text, text);
drop function if exists private.payment_record_webhook(text, text, text, boolean, text);
drop function if exists private.payment_set_split(uuid, text, integer, public.split_status);
drop function if exists private.payment_touch_checked(uuid);
drop function if exists private.payment_mark_failed(uuid, text);
drop function if exists private.payment_attach_charge(uuid, text, text, text, integer, timestamptz);
drop function if exists private.payment_create_hold(uuid, smallint, timestamptz, timestamptz, uuid, public.payment_environment, integer);
drop function if exists private.payment_expire_holds();
drop function if exists private.payment_audit(uuid, text, text, text, text);

-- 2) Tabelas financeiras (políticas, índices e gatilhos caem junto).
drop table if exists private.payment_audit_log;
drop table if exists private.payment_webhook_events;
drop table if exists public.refund_requests;
drop table if exists public.payment_splits;
drop table if exists public.teacher_payout_accounts;
drop table if exists public.payment_intents;
drop type if exists public.refund_status;
drop type if exists public.split_status;
drop type if exists public.payment_environment;
drop type if exists public.payment_status;

-- 3) Aulas: remove as pagas e os estados novos; restaura gatilhos, restrições e a função da 3A.
delete from public.lessons where not is_test or status in ('awaiting_payment', 'expired');

create or replace function private.lessons_before_insert()
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

create or replace function private.lessons_before_update()
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

create or replace function private.teacher_busy_ranges(p_teacher uuid, p_from timestamptz, p_to timestamptz)
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

alter table public.lessons drop constraint lessons_no_teacher_overlap;
alter table public.lessons drop constraint lessons_no_student_overlap;
alter table public.lessons add constraint lessons_no_teacher_overlap exclude using gist (
  teacher_id with =, tstzrange(starts_at, ends_at, '[)') with &&
) where (status = 'scheduled');
alter table public.lessons add constraint lessons_no_student_overlap exclude using gist (
  student_id with =, tstzrange(starts_at, ends_at, '[)') with &&
) where (status = 'scheduled');
alter table public.lessons add constraint lessons_test_only check (is_test);

commit;
