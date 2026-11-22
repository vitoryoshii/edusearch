-- Fase 6.3 — políticas de comissão versionadas. Esta migration NÃO ativa comissão progressiva:
-- a política efetiva v1 permanece em 1.500 bps nos dois ambientes. As faixas demo servem apenas
-- como fixture auditável para homologação futura e nunca são escolhidas enquanto inativas.

create table public.commission_policies (
  version             text not null check (version ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  environment         public.payment_environment not null,
  is_active           boolean not null default false,
  evaluation_days     smallint not null check (evaluation_days between 1 and 365),
  eligibility_rule    text not null check (eligibility_rule = 'paid_lessons_created_at'),
  created_at          timestamptz not null default now(),
  activated_at        timestamptz,
  retired_at          timestamptz,
  primary key (version, environment),
  constraint commission_policy_lifecycle check (
    (is_active and activated_at is not null and retired_at is null)
    or (not is_active and (activated_at is null or retired_at is not null))
  )
);

create unique index commission_policies_one_active_per_environment
  on public.commission_policies (environment) where is_active;

create table public.commission_policy_tiers (
  policy_version              text not null,
  environment                 public.payment_environment not null,
  tier                         smallint not null check (tier >= 0),
  min_eligible_paid_lessons   integer not null check (min_eligible_paid_lessons >= 0),
  commission_bps              smallint not null check (commission_bps between 1000 and 1500),
  primary key (policy_version, environment, tier),
  unique (policy_version, environment, min_eligible_paid_lessons),
  foreign key (policy_version, environment)
    references public.commission_policies (version, environment) on delete restrict
);

comment on table public.commission_policies is
  'Política comercial versionada. Alterada somente por operação autorizada; v1 é fixa em 15%.';
comment on table public.commission_policy_tiers is
  'Faixas determinísticas em bps. Nunca abaixo de 1.000 bps (10%).';

alter table public.commission_policies enable row level security;
alter table public.commission_policy_tiers enable row level security;
revoke all on table public.commission_policies, public.commission_policy_tiers
  from public, anon, authenticated;

-- A trilha é privada e captura toda alteração feita pela operação/migration. Não há endpoint
-- administrativo nesta fase e nenhum usuário autenticado recebe permissão de escrita.
create table private.commission_policy_audit_log (
  id              bigint generated always as identity primary key,
  occurred_at     timestamptz not null default now(),
  actor_id        uuid,
  action          text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  entity          text not null check (entity in ('policy', 'tier')),
  policy_version  text not null,
  environment     public.payment_environment not null,
  previous_data   jsonb,
  current_data    jsonb
);
revoke all on table private.commission_policy_audit_log from public, anon, authenticated;

create function private.audit_commission_policy_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_new jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_version text := coalesce(v_new ->> 'version', v_new ->> 'policy_version', v_old ->> 'version', v_old ->> 'policy_version');
  v_environment public.payment_environment := coalesce((v_new ->> 'environment')::public.payment_environment, (v_old ->> 'environment')::public.payment_environment);
begin
  insert into private.commission_policy_audit_log (
    actor_id, action, entity, policy_version, environment, previous_data, current_data
  ) values (
    auth.uid(), tg_op,
    case when tg_table_name = 'commission_policies' then 'policy' else 'tier' end,
    v_version, v_environment, v_old, v_new
  );
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function private.audit_commission_policy_change()
  from public, anon, authenticated;

create trigger commission_policies_audit
  after insert or update or delete on public.commission_policies
  for each row execute function private.audit_commission_policy_change();
create trigger commission_policy_tiers_audit
  after insert or update or delete on public.commission_policy_tiers
  for each row execute function private.audit_commission_policy_change();

insert into public.commission_policies (
  version, environment, is_active, evaluation_days, eligibility_rule, activated_at
) values
  ('v1', 'sandbox', true, 90, 'paid_lessons_created_at', now()),
  ('v1', 'production', true, 90, 'paid_lessons_created_at', now()),
  ('demo-v2', 'sandbox', false, 90, 'paid_lessons_created_at', null),
  ('demo-v2', 'production', false, 90, 'paid_lessons_created_at', null);

-- v1 é a ÚNICA política efetiva: 15% para todos. demo-v2 não pode ser usada sem ativação
-- operacional explícita e auditada; ela demonstra a expansão até o piso de 10%.
insert into public.commission_policy_tiers (
  policy_version, environment, tier, min_eligible_paid_lessons, commission_bps
) values
  ('v1', 'sandbox', 0, 0, 1500),
  ('v1', 'production', 0, 0, 1500),
  ('demo-v2', 'sandbox', 0, 0, 1500),
  ('demo-v2', 'sandbox', 1, 10, 1400),
  ('demo-v2', 'sandbox', 2, 25, 1250),
  ('demo-v2', 'sandbox', 3, 50, 1000),
  ('demo-v2', 'production', 0, 0, 1500),
  ('demo-v2', 'production', 1, 10, 1400),
  ('demo-v2', 'production', 2, 25, 1250),
  ('demo-v2', 'production', 3, 50, 1000);

alter table public.payment_intents
  add column commission_policy_version text not null default 'v1';
alter table public.payment_intents
  add constraint payment_intents_commission_policy_fk
  foreign key (commission_policy_version, environment)
  references public.commission_policies (version, environment) on delete restrict;
comment on column public.payment_intents.commission_policy_version is
  'Snapshot da política usada na criação; histórico nunca é recalculado.';

create index payment_intents_teacher_environment_paid_idx
  on public.payment_intents (teacher_id, environment, created_at desc)
  where status = 'paid';

-- Só funções privadas escolhem a política. A elegibilidade é composta por pagamentos efetivamente
-- pagos, no mesmo professor/ambiente, dentro da janela configurada. Cancelados e reembolsados não
-- contam. Cada cobrança é única por reserva, logo uma reserva não pode contar duas vezes.
create function private.commission_for_teacher(
  p_teacher uuid, p_environment public.payment_environment
)
returns table (policy_version text, current_tier smallint, commission_bps smallint, eligible_paid_lessons integer,
               next_min_eligible_paid_lessons integer, next_commission_bps smallint,
               evaluation_days smallint)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if p_teacher is distinct from private.claims_sub() then
    raise exception using errcode = 'insufficient_privilege', message = 'commission_progress_forbidden';
  end if;
  return query
  with policy as (
    select p.version, p.evaluation_days
      from public.commission_policies p
     where p.environment = p_environment and p.is_active
     order by p.activated_at desc
     limit 1
  ), eligible as (
    select count(*)::integer as paid_lessons
      from public.payment_intents i, policy p
     where i.teacher_id = p_teacher
       and i.environment = p_environment
       and i.status = 'paid'
       and i.created_at >= pg_catalog.now() - make_interval(days => p.evaluation_days)
  ), current_tier as (
    select t.* from public.commission_policy_tiers t, policy p, eligible e
     where (t.policy_version, t.environment) = (p.version, p_environment)
       and t.min_eligible_paid_lessons <= e.paid_lessons
     order by t.min_eligible_paid_lessons desc
     limit 1
  ), next_tier as (
    select t.* from public.commission_policy_tiers t, policy p, eligible e
     where (t.policy_version, t.environment) = (p.version, p_environment)
       and t.min_eligible_paid_lessons > e.paid_lessons
     order by t.min_eligible_paid_lessons asc
     limit 1
  )
  select p.version, c.tier, c.commission_bps, e.paid_lessons,
         n.min_eligible_paid_lessons, n.commission_bps, p.evaluation_days
    from policy p cross join eligible e cross join current_tier c left join next_tier n on true;
end;
$$;
revoke all on function private.commission_for_teacher(uuid, public.payment_environment)
  from public, anon, authenticated;
grant execute on function private.commission_for_teacher(uuid, public.payment_environment)
  to edusearch_api;

-- Substitui somente o cálculo do snapshot no checkout; preserva validações, exclusão de horários e
-- idempotência da função original.
create or replace function private.payment_create_hold(
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
  v_policy_version text;
  v_commission_bps smallint;
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
  select policy_version, commission_bps into v_policy_version, v_commission_bps
    from private.commission_for_teacher(p_teacher, p_env);
  if v_policy_version is null or v_commission_bps is null then
    raise exception using errcode = 'P0001', message = 'commission_policy_not_configured';
  end if;
  insert into public.lessons (teacher_id, student_id, subject_id, starts_at, ends_at, idempotency_key, status, is_test)
  values (p_teacher, v_student, p_subject_id, p_starts, p_ends, p_key, 'awaiting_payment', false)
  returning id into v_lesson;
  v_commission := (v_price * v_commission_bps + 5000) / 10000;
  insert into public.payment_intents (
    lesson_id, student_id, teacher_id, amount_cents, commission_bps, commission_cents,
    teacher_share_cents, commission_policy_version, environment, idempotency_key, expires_at
  ) values (
    v_lesson, v_student, p_teacher, v_price, v_commission_bps, v_commission,
    v_price - v_commission, v_policy_version, p_env, p_key,
    pg_catalog.now() + make_interval(secs => p_hold_seconds)
  ) returning * into v_intent;
  perform private.payment_audit(v_intent.id, null, 'pending', 'student', 'reserva criada');
  return next v_intent;
end;
$$;
