-- EduSearch — Fase 5A (2/2): base financeira (AbacatePay v2, Pix).
--
-- Princípios (detalhes em docs/payments.md):
-- * Ninguém do app escreve em tabelas financeiras. authenticated só LÊ (RLS: participantes); toda
--   escrita passa por funções SECURITY DEFINER em private, executáveis SOMENTE por edusearch_api,
--   com a máquina de estados, bloqueio (FOR UPDATE) e idempotência.
-- * Valor, comissão (15% = 1500 bps) e parcela do professor são calculados AQUI, em centavos
--   inteiros, a partir de teacher_profiles.price_cents no momento da reserva, e ficam congelados.
-- * Reserva temporária = aula "awaiting_payment" (entra no EXCLUDE: ninguém pega o horário).
-- * Aulas de teste existentes ficam intactas (is_test = true). is_test passa a ser imutável.
-- * Registros financeiros sobrevivem à exclusão da conta (lesson_id vira NULL; nada é apagado).
-- * Taxa do gateway é registrada à parte (gateway_fee_cents); não altera comissão nem repasse.

-- ---------------------------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------------------------
create type public.payment_status as enum ('pending', 'paid', 'expired', 'cancelled', 'refunded', 'under_dispute', 'failed');
create type public.payment_environment as enum ('sandbox', 'production');
create type public.split_status as enum ('not_applicable', 'unavailable', 'pending', 'credited', 'failed');
create type public.refund_status as enum ('requested', 'approved', 'rejected', 'processing', 'completed', 'failed');

-- ---------------------------------------------------------------------------------------------
-- Aulas: reserva paga entra no bloqueio de conflito; participantes só cancelam
-- ---------------------------------------------------------------------------------------------
alter table public.lessons drop constraint lessons_test_only;
alter table public.lessons drop constraint lessons_no_teacher_overlap;
alter table public.lessons drop constraint lessons_no_student_overlap;
alter table public.lessons add constraint lessons_no_teacher_overlap exclude using gist (
  teacher_id with =, tstzrange(starts_at, ends_at, '[)') with &&
) where (status in ('scheduled', 'awaiting_payment'));
alter table public.lessons add constraint lessons_no_student_overlap exclude using gist (
  student_id with =, tstzrange(starts_at, ends_at, '[)') with &&
) where (status in ('scheduled', 'awaiting_payment'));
comment on table public.lessons is
  'Aulas. is_test = aula do piloto sem cobrança; is_test = false só nasce pelo fluxo de pagamento (awaiting_payment).';

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
  -- Aula PAGA só nasce pelas funções de pagamento (SECURITY DEFINER: current_user é o dono, não
  -- um papel do app) e sempre como reserva temporária. Qualquer outro caminho = aula de TESTE.
  if new.status = 'awaiting_payment' and current_user not in ('authenticated', 'anon', 'edusearch_api') then
    if new.is_test then
      raise exception using errcode = 'check_violation', constraint = 'lessons_paid_hold',
        message = 'reserva paga não pode ser aula de teste';
    end if;
  else
    new.status := 'scheduled';
    new.is_test := true;
  end if;
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
  if new.is_test is distinct from old.is_test then
    raise exception using errcode = 'check_violation', constraint = 'lessons_test_only',
      message = 'o tipo da aula (teste ou paga) não pode mudar';
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then
    raise exception using errcode = 'check_violation', constraint = 'lessons_cancel_final',
      message = 'aula cancelada não pode voltar a ser agendada';
  end if;
  -- Participantes (authenticated) só podem CANCELAR. Confirmar, expirar ou reativar uma aula é do
  -- servidor (funções de pagamento): ninguém "paga" mudando o status pela Data API.
  if current_user = 'authenticated' and new.status is distinct from old.status and new.status <> 'cancelled' then
    raise exception using errcode = 'insufficient_privilege', message = 'só é possível cancelar a aula';
  end if;
  if old.status in ('scheduled', 'awaiting_payment') and new.status = 'cancelled' then
    new.cancelled_at := pg_catalog.now();
    new.cancelled_by_role := case
      when auth.uid() = old.teacher_id then 'teacher'::public.account_role
      else 'student'::public.account_role
    end;
  elsif new.status = old.status then
    new.cancelled_at := old.cancelled_at;
    new.cancelled_by_role := old.cancelled_by_role;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- Cobranças (uma por aula paga)
-- ---------------------------------------------------------------------------------------------
create table public.payment_intents (
  id                  uuid primary key default gen_random_uuid(),
  -- NULL só se a aula for apagada junto com a conta: o registro financeiro permanece.
  lesson_id           uuid unique references public.lessons (id) on delete set null,
  student_id          uuid not null,
  teacher_id          uuid not null,
  amount_cents        integer not null,
  commission_bps      smallint not null default 1500,
  commission_cents    integer not null,
  teacher_share_cents integer not null,
  currency            text not null default 'BRL',
  environment         public.payment_environment not null,
  status              public.payment_status not null default 'pending',
  idempotency_key     uuid not null,
  gateway             text not null default 'abacatepay',
  gateway_charge_id   text unique,
  br_code             text,
  br_code_image       text,
  gateway_fee_cents   integer,
  expires_at          timestamptz not null,
  paid_at             timestamptz,
  paid_amount_cents   integer,
  refunded_at         timestamptz,
  split_status        public.split_status not null default 'not_applicable',
  last_checked_at     timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint payment_amount_range check (amount_cents between 100 and 10000000),
  constraint payment_commission_rule check (commission_bps = 1500),
  constraint payment_split_exact check (
    commission_cents >= 0 and teacher_share_cents >= 0 and commission_cents + teacher_share_cents = amount_cents
  ),
  constraint payment_currency check (currency = 'BRL'),
  constraint payment_gateway check (gateway = 'abacatepay'),
  constraint payment_charge_id_format check (gateway_charge_id is null or gateway_charge_id ~ '^[A-Za-z0-9_-]{4,128}$'),
  constraint payment_image_format check (
    br_code_image is null or (br_code_image like 'data:image/png;base64,%' and char_length(br_code_image) <= 60000)
  ),
  constraint payment_br_code_len check (br_code is null or char_length(br_code) between 10 and 1000),
  constraint payment_paid_consistent check ((status in ('paid', 'refunded', 'under_dispute')) = (paid_at is not null)),
  constraint payment_paid_amount check ((paid_at is null) = (paid_amount_cents is null)),
  constraint payment_fee_nonneg check (gateway_fee_cents is null or gateway_fee_cents >= 0),
  constraint payment_idempotency unique (student_id, idempotency_key)
);
alter table public.payment_intents enable row level security;
create index payment_intents_student_idx on public.payment_intents (student_id, created_at desc);
create index payment_intents_teacher_idx on public.payment_intents (teacher_id, created_at desc);
create index payment_intents_pending_idx on public.payment_intents (expires_at) where status = 'pending';
create trigger payment_intents_set_updated_at
  before update on public.payment_intents
  for each row execute function private.set_updated_at();
comment on table public.payment_intents is
  'Cobrança Pix de uma aula paga. Valores congelados na reserva. Escrita só por funções private.payment_*.';

create table public.payment_splits (
  id             uuid primary key default gen_random_uuid(),
  intent_id      uuid not null references public.payment_intents (id) on delete cascade,
  sub_account_id text not null,
  amount_cents   integer not null,
  status         public.split_status not null default 'pending',
  created_at     timestamptz not null default now(),
  constraint payment_split_amount check (amount_cents >= 1),
  constraint payment_split_sacc check (sub_account_id ~ '^sacc_[A-Za-z0-9]{4,64}$'),
  constraint payment_split_unique unique (intent_id, sub_account_id)
);
alter table public.payment_splits enable row level security;

create table public.teacher_payout_accounts (
  teacher_id     uuid primary key references public.teacher_profiles (user_id) on delete cascade,
  gateway        text not null default 'abacatepay',
  sub_account_id text not null unique,
  environment    public.payment_environment not null,
  -- Só os 4 últimos dígitos do CPF/CNPJ: o documento completo fica apenas no gateway.
  tax_id_last4   text not null,
  status         text not null default 'active',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint payout_gateway check (gateway = 'abacatepay'),
  constraint payout_sacc check (sub_account_id ~ '^sacc_[A-Za-z0-9]{4,64}$'),
  constraint payout_last4 check (tax_id_last4 ~ '^[0-9]{4}$'),
  constraint payout_status check (status in ('active', 'disabled'))
);
alter table public.teacher_payout_accounts enable row level security;
create trigger teacher_payout_accounts_set_updated_at
  before update on public.teacher_payout_accounts
  for each row execute function private.set_updated_at();

create table public.refund_requests (
  id                uuid primary key default gen_random_uuid(),
  intent_id         uuid not null references public.payment_intents (id) on delete cascade,
  reason            text not null,
  requested_by      text not null,
  status            public.refund_status not null default 'requested',
  amount_cents      integer not null,
  gateway_refund_id text unique,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint refund_reason check (reason in ('lesson_cancelled', 'paid_after_cancel', 'late_payment_slot_taken', 'manual')),
  constraint refund_requested_by check (requested_by in ('student', 'teacher', 'system', 'operator')),
  constraint refund_amount check (amount_cents >= 1)
);
alter table public.refund_requests enable row level security;
create index refund_requests_intent_idx on public.refund_requests (intent_id);
-- No máximo UMA solicitação aberta por cobrança (reentrega de webhook ou clique duplo não duplica).
create unique index refund_requests_one_open on public.refund_requests (intent_id)
  where status in ('requested', 'approved', 'processing');
create trigger refund_requests_set_updated_at
  before update on public.refund_requests
  for each row execute function private.set_updated_at();

-- Webhooks recebidos (deduplicação) e trilha de auditoria: privados, fora da Data API.
create table private.payment_webhook_events (
  event_id       text primary key,
  event_type     text not null,
  charge_id      text,
  dev_mode       boolean,
  payload_sha256 text not null,
  received_at    timestamptz not null default now(),
  processed_at   timestamptz,
  outcome        text,
  constraint webhook_event_id check (char_length(event_id) between 1 and 200),
  constraint webhook_sha check (payload_sha256 ~ '^[0-9a-f]{64}$')
);
alter table private.payment_webhook_events enable row level security;
revoke all on table private.payment_webhook_events from public, anon, authenticated;

create table private.payment_audit_log (
  id          bigint generated always as identity primary key,
  intent_id   uuid,
  from_status text,
  to_status   text,
  actor       text not null,
  detail      text,
  created_at  timestamptz not null default now()
);
alter table private.payment_audit_log enable row level security;
revoke all on table private.payment_audit_log from public, anon, authenticated;
create index payment_audit_log_intent_idx on private.payment_audit_log (intent_id, created_at);

-- ---------------------------------------------------------------------------------------------
-- Leitura (RLS): só participantes. Nenhuma escrita para papéis do app.
-- ---------------------------------------------------------------------------------------------
revoke all on table public.payment_intents, public.payment_splits, public.teacher_payout_accounts,
  public.refund_requests from public, anon, authenticated;
grant select on public.payment_intents, public.payment_splits, public.teacher_payout_accounts,
  public.refund_requests to authenticated;

create policy payment_intents_select_participant on public.payment_intents
  for select to authenticated
  using ((select auth.uid()) in (student_id, teacher_id));
create policy payment_splits_select_teacher on public.payment_splits
  for select to authenticated
  using (exists (
    select 1 from public.payment_intents p
     where p.id = payment_splits.intent_id and p.teacher_id = (select auth.uid())
  ));
create policy teacher_payout_accounts_select_own on public.teacher_payout_accounts
  for select to authenticated
  using (teacher_id = (select auth.uid()));
create policy refund_requests_select_participant on public.refund_requests
  for select to authenticated
  using (exists (
    select 1 from public.payment_intents p
     where p.id = refund_requests.intent_id and (select auth.uid()) in (p.student_id, p.teacher_id)
  ));

-- ---------------------------------------------------------------------------------------------
-- Funções de escrita (SECURITY DEFINER; só edusearch_api executa)
-- ---------------------------------------------------------------------------------------------
create function private.payment_audit(p_intent uuid, p_from text, p_to text, p_actor text, p_detail text)
returns void language sql security definer set search_path = '' as $$
  insert into private.payment_audit_log (intent_id, from_status, to_status, actor, detail)
  values (p_intent, p_from, p_to, p_actor, left(p_detail, 300));
$$;

/** Expira reservas vencidas (chamada antes de calcular horários e de reservar). */
create function private.payment_expire_holds()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select id, lesson_id from public.payment_intents
     where status = 'pending' and expires_at < pg_catalog.now()
     for update skip locked
  loop
    update public.payment_intents set status = 'expired' where id = r.id;
    update public.lessons set status = 'expired' where id = r.lesson_id and status = 'awaiting_payment';
    perform private.payment_audit(r.id, 'pending', 'expired', 'system', 'prazo do Pix vencido');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

/**
 * Cria a reserva temporária e a cobrança interna. Idempotente por (aluno, chave).
 * O aluno é SEMPRE o sub do JWT verificado; o valor vem do cadastro do professor.
 */
create function private.payment_create_hold(
  p_teacher uuid, p_subject_id smallint, p_starts timestamptz, p_ends timestamptz,
  p_key uuid, p_env public.payment_environment, p_hold_seconds integer
)
returns setof public.payment_intents
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_student uuid := private.claims_sub();
  v_existing public.payment_intents;
  v_price integer;
  v_lesson uuid;
  v_intent public.payment_intents;
  v_commission integer;
begin
  if v_student is null then
    raise exception using errcode = 'insufficient_privilege', message = 'not_authenticated';
  end if;
  if p_hold_seconds < 300 or p_hold_seconds > 3600 then
    raise exception using errcode = 'P0001', message = 'invalid_hold';
  end if;
  perform private.payment_expire_holds();

  select * into v_existing from public.payment_intents
   where student_id = v_student and idempotency_key = p_key;
  if found then
    if v_existing.teacher_id <> p_teacher
       or not exists (select 1 from public.lessons l where l.id = v_existing.lesson_id and l.starts_at = p_starts) then
      raise exception using errcode = 'P0001', message = 'idempotency_conflict';
    end if;
    return next v_existing;
    return;
  end if;

  if not exists (select 1 from public.account_roles r where r.user_id = v_student and r.role = 'student') then
    raise exception using errcode = 'insufficient_privilege', message = 'role_required';
  end if;
  if p_teacher = v_student then
    raise exception using errcode = 'P0001', message = 'teacher_not_found';
  end if;
  select price_cents into v_price from public.teacher_profiles
   where user_id = p_teacher and is_published;
  if not found then
    raise exception using errcode = 'P0001', message = 'teacher_not_found';
  end if;
  if v_price is null then
    raise exception using errcode = 'P0001', message = 'price_not_set';
  end if;

  -- O EXCLUDE de lessons impede conflito (professor e aluno), inclusive em corrida.
  insert into public.lessons (teacher_id, student_id, subject_id, starts_at, ends_at, idempotency_key, status, is_test)
  values (p_teacher, v_student, p_subject_id, p_starts, p_ends, p_key, 'awaiting_payment', false)
  returning id into v_lesson;

  -- 15% com arredondamento "meio para cima" em inteiros (mesma regra do frontend).
  v_commission := (v_price * 1500 + 5000) / 10000;
  insert into public.payment_intents (
    lesson_id, student_id, teacher_id, amount_cents, commission_bps, commission_cents,
    teacher_share_cents, environment, idempotency_key, expires_at
  ) values (
    v_lesson, v_student, p_teacher, v_price, 1500, v_commission,
    v_price - v_commission, p_env, p_key, pg_catalog.now() + make_interval(secs => p_hold_seconds)
  ) returning * into v_intent;
  perform private.payment_audit(v_intent.id, null, 'pending', 'student', 'reserva criada');
  return next v_intent;
end;
$$;

/** Grava a cobrança criada no gateway (id, Pix copia e cola, QR, taxa, vencimento). */
create function private.payment_attach_charge(
  p_intent uuid, p_charge text, p_br_code text, p_image text, p_fee integer, p_expires timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.payment_intents
     set gateway_charge_id = p_charge, br_code = p_br_code, br_code_image = p_image,
         gateway_fee_cents = p_fee, expires_at = coalesce(p_expires, expires_at), last_checked_at = pg_catalog.now()
   where id = p_intent and student_id = private.claims_sub()
     and (gateway_charge_id is null or gateway_charge_id = p_charge);
  if not found then
    raise exception using errcode = 'P0001', message = 'intent_not_found';
  end if;
end;
$$;

/** Falha ao criar a cobrança no gateway (sem cobrança criada): libera o horário. */
create function private.payment_mark_failed(p_intent uuid, p_detail text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lesson uuid;
begin
  update public.payment_intents set status = 'failed'
   where id = p_intent and student_id = private.claims_sub() and status = 'pending' and gateway_charge_id is null
  returning lesson_id into v_lesson;
  if found then
    update public.lessons set status = 'expired' where id = v_lesson and status = 'awaiting_payment';
    perform private.payment_audit(p_intent, 'pending', 'failed', 'system', p_detail);
  end if;
end;
$$;

create function private.payment_touch_checked(p_intent uuid)
returns void language sql security definer set search_path = '' as $$
  update public.payment_intents set last_checked_at = pg_catalog.now()
   where id = p_intent and private.claims_sub() in (student_id, teacher_id);
$$;

/** Registra o split pedido ao gateway (ou a indisponibilidade). */
create function private.payment_set_split(p_intent uuid, p_sacc text, p_amount integer, p_status public.split_status)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.payment_intents where id = p_intent and student_id = private.claims_sub()) then
    raise exception using errcode = 'P0001', message = 'intent_not_found';
  end if;
  if p_status = 'pending' then
    insert into public.payment_splits (intent_id, sub_account_id, amount_cents)
    values (p_intent, p_sacc, p_amount) on conflict (intent_id, sub_account_id) do nothing;
  end if;
  update public.payment_intents set split_status = p_status where id = p_intent;
end;
$$;

/** Deduplica webhooks pelo id do evento. Devolve true se é a PRIMEIRA vez. */
create function private.payment_record_webhook(p_event_id text, p_type text, p_charge text, p_dev boolean, p_sha text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.payment_webhook_events (event_id, event_type, charge_id, dev_mode, payload_sha256)
  values (p_event_id, p_type, p_charge, p_dev, p_sha)
  on conflict (event_id) do nothing;
  return found;
end;
$$;

create function private.payment_finish_webhook(p_event_id text, p_outcome text)
returns void language sql security definer set search_path = '' as $$
  update private.payment_webhook_events set processed_at = pg_catalog.now(), outcome = left(p_outcome, 60)
   where event_id = p_event_id;
$$;

/**
 * Confirma o pagamento (webhook ou conciliação). Idempotente e sob bloqueio da cobrança.
 * Nunca confirma valor divergente. Pagamento tardio com horário perdido ou após cancelamento
 * vira solicitação de reembolso (o dinheiro nunca "some").
 */
create function private.payment_confirm(p_charge text, p_paid_amount integer, p_source text)
returns table (intent_id uuid, lesson_id uuid, student_id uuid, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payment_intents;
  v_lesson_status public.lesson_status;
  v_outcome text := 'confirmed';
begin
  select * into v from public.payment_intents p where p.gateway_charge_id = p_charge for update;
  if not found then
    return query select null::uuid, null::uuid, null::uuid, 'unknown_charge'::text;
    return;
  end if;
  if v.status in ('paid', 'refunded', 'under_dispute') then
    return query select v.id, v.lesson_id, v.student_id, 'already_processed'::text;
    return;
  end if;
  if p_paid_amount is distinct from v.amount_cents then
    perform private.payment_audit(v.id, v.status::text, v.status::text, p_source,
      format('valor divergente: esperado %s, recebido %s', v.amount_cents, p_paid_amount));
    return query select v.id, v.lesson_id, v.student_id, 'amount_mismatch'::text;
    return;
  end if;

  update public.payment_intents
     set status = 'paid', paid_at = pg_catalog.now(), paid_amount_cents = p_paid_amount,
         split_status = case when split_status = 'pending' then 'credited'::public.split_status else split_status end
   where id = v.id;
  update public.payment_splits set status = 'credited' where payment_splits.intent_id = v.id and status = 'pending';
  perform private.payment_audit(v.id, v.status::text, 'paid', p_source, null);

  select l.status into v_lesson_status from public.lessons l where l.id = v.lesson_id for update;
  if v_lesson_status = 'awaiting_payment' then
    update public.lessons set status = 'scheduled' where id = v.lesson_id;
  elsif v_lesson_status = 'expired' then
    begin
      update public.lessons set status = 'scheduled' where id = v.lesson_id;
      v_outcome := 'confirmed_late';
    exception when exclusion_violation then
      insert into public.refund_requests (intent_id, reason, requested_by, amount_cents)
      values (v.id, 'late_payment_slot_taken', 'system', v.amount_cents)
      on conflict do nothing;
      v_outcome := 'paid_slot_lost';
    end;
  elsif v_lesson_status = 'cancelled' then
    insert into public.refund_requests (intent_id, reason, requested_by, amount_cents)
    values (v.id, 'paid_after_cancel', 'system', v.amount_cents)
    on conflict do nothing;
    v_outcome := 'paid_after_cancel';
  end if;
  perform private.payment_audit(v.id, 'paid', 'paid', p_source, v_outcome);
  return query select v.id, v.lesson_id, v.student_id, v_outcome;
end;
$$;

/** Expiração/cancelamento informados pelo gateway (status consultado). */
create function private.payment_close_unpaid(p_charge text, p_status public.payment_status, p_source text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payment_intents;
begin
  if p_status not in ('expired', 'cancelled', 'failed') then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;
  select * into v from public.payment_intents where gateway_charge_id = p_charge for update;
  if not found then return 'unknown_charge'; end if;
  if v.status <> 'pending' then return 'no_change'; end if;
  update public.payment_intents set status = p_status where id = v.id;
  update public.lessons set status = 'expired' where id = v.lesson_id and status = 'awaiting_payment';
  perform private.payment_audit(v.id, 'pending', p_status::text, p_source, null);
  return 'closed';
end;
$$;

/** Reembolso ou disputa informados pelo gateway. */
create function private.payment_mark_after_paid(p_charge text, p_status public.payment_status, p_source text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payment_intents;
begin
  if p_status not in ('refunded', 'under_dispute', 'paid') then
    raise exception using errcode = 'P0001', message = 'invalid_status';
  end if;
  select * into v from public.payment_intents where gateway_charge_id = p_charge for update;
  if not found then return 'unknown_charge'; end if;
  if v.status not in ('paid', 'under_dispute') or v.status = p_status then return 'no_change'; end if;
  update public.payment_intents
     set status = p_status, refunded_at = case when p_status = 'refunded' then pg_catalog.now() else refunded_at end
   where id = v.id;
  if p_status = 'refunded' then
    update public.refund_requests set status = 'completed' where intent_id = v.id and status in ('requested', 'approved', 'processing');
  end if;
  perform private.payment_audit(v.id, v.status::text, p_status::text, p_source, null);
  return 'updated';
end;
$$;

/** Cadastro da subconta do professor no gateway (só o id e os 4 últimos dígitos). */
create function private.payout_account_upsert(p_sacc text, p_last4 text, p_env public.payment_environment)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_teacher uuid := private.claims_sub();
begin
  if v_teacher is null or not exists (
    select 1 from public.account_roles r where r.user_id = v_teacher and r.role = 'teacher'
  ) then
    raise exception using errcode = 'insufficient_privilege', message = 'role_required';
  end if;
  insert into public.teacher_payout_accounts (teacher_id, sub_account_id, environment, tax_id_last4)
  values (v_teacher, p_sacc, p_env, p_last4)
  on conflict (teacher_id) do update
     set sub_account_id = excluded.sub_account_id, environment = excluded.environment,
         tax_id_last4 = excluded.tax_id_last4, status = 'active';
end;
$$;

/** Subconta do professor de uma aula (para montar o split na cobrança). */
create function private.payout_account_of(p_teacher uuid, p_env public.payment_environment)
returns text language sql stable security definer set search_path = '' as $$
  select sub_account_id from public.teacher_payout_accounts
   where teacher_id = p_teacher and environment = p_env and status = 'active';
$$;

/** Operação: andamento de uma solicitação de reembolso (CLI de operação). */
create function private.refund_set_status(p_request uuid, p_status public.refund_status, p_gateway_refund_id text)
returns void language sql security definer set search_path = '' as $$
  update public.refund_requests
     set status = p_status, gateway_refund_id = coalesce(p_gateway_refund_id, gateway_refund_id)
   where id = p_request;
$$;

-- Cancelamento de aula paga: cobrança pendente é cancelada; paga vira solicitação de reembolso.
create function private.lessons_after_update_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.payment_intents;
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' and not new.is_test then
    select * into v from public.payment_intents where lesson_id = new.id for update;
    if found then
      if v.status = 'pending' then
        update public.payment_intents set status = 'cancelled' where id = v.id;
        perform private.payment_audit(v.id, 'pending', 'cancelled', coalesce(new.cancelled_by_role::text, 'system'), 'aula cancelada antes do pagamento');
      elsif v.status = 'paid' then
        insert into public.refund_requests (intent_id, reason, requested_by, amount_cents)
        values (v.id, 'lesson_cancelled', coalesce(new.cancelled_by_role::text, 'system'), v.amount_cents)
        on conflict do nothing;
        perform private.payment_audit(v.id, 'paid', 'paid', coalesce(new.cancelled_by_role::text, 'system'), 'aula paga cancelada: reembolso solicitado');
      end if;
    end if;
  end if;
  return null;
end;
$$;

create trigger lessons_after_update_payment
  after update of status on public.lessons
  for each row execute function private.lessons_after_update_payment();

-- Horários ocupados passam a incluir reservas aguardando pagamento.
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
     where l.teacher_id = p_teacher and l.status in ('scheduled', 'awaiting_payment')
       and l.starts_at < p_to and l.ends_at > p_from
     order by l.starts_at;
end;
$$;

-- Permissões: funções financeiras só para o papel da API. Nada para anon/authenticated.
do $$
declare
  f text;
begin
  foreach f in array array[
    'private.payment_audit(uuid, text, text, text, text)',
    'private.payment_expire_holds()',
    'private.payment_create_hold(uuid, smallint, timestamptz, timestamptz, uuid, public.payment_environment, integer)',
    'private.payment_attach_charge(uuid, text, text, text, integer, timestamptz)',
    'private.payment_mark_failed(uuid, text)',
    'private.payment_touch_checked(uuid)',
    'private.payment_set_split(uuid, text, integer, public.split_status)',
    'private.payment_record_webhook(text, text, text, boolean, text)',
    'private.payment_finish_webhook(text, text)',
    'private.payment_confirm(text, integer, text)',
    'private.payment_close_unpaid(text, public.payment_status, text)',
    'private.payment_mark_after_paid(text, public.payment_status, text)',
    'private.payout_account_upsert(text, text, public.payment_environment)',
    'private.payout_account_of(uuid, public.payment_environment)',
    'private.refund_set_status(uuid, public.refund_status, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to edusearch_api', f);
  end loop;
end
$$;
revoke all on function private.lessons_after_update_payment() from public, anon, authenticated;
