-- Administração é uma identidade separada dos papéis públicos (student/teacher).
-- Nenhum administrador é criado por migration: o primeiro deve ser provisionado por operador
-- autorizado usando private.admin_grant_role, fora do PostgREST.
create type private.admin_role as enum (
  'super_admin', 'operations_admin', 'finance_admin', 'support_admin', 'auditor'
);

create table private.admin_memberships (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  role private.admin_role not null,
  active boolean not null default true,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint admin_membership_revocation_consistent check (
    (active and revoked_at is null) or (not active)
  )
);

create table private.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id) on delete restrict,
  action text not null check (action ~ '^[a-z]+(\.[a-z_]+)+$'),
  resource_type text not null check (resource_type ~ '^[a-z_]+$'),
  resource_id uuid,
  justification text,
  before_state jsonb,
  after_state jsonb,
  result text not null check (result in ('success', 'denied', 'failed')),
  request_id uuid,
  created_at timestamptz not null default now()
);

create index admin_audit_log_created_idx on private.admin_audit_log (created_at desc);
create index admin_audit_log_resource_idx on private.admin_audit_log (resource_type, resource_id);

alter table private.admin_memberships enable row level security;
alter table private.admin_audit_log enable row level security;
revoke all on table private.admin_memberships, private.admin_audit_log from public, anon, authenticated;
grant usage on schema private to edusearch_api;

create or replace function private.admin_has_permission(p_user uuid, p_permission text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from private.admin_memberships m
    join public.profiles p on p.id = m.user_id
    where m.user_id = p_user
      and m.active
      and m.revoked_at is null
      and p.status = 'active'
      and (
        m.role = 'super_admin'
        or (m.role = 'operations_admin' and p_permission = any(array[
          'dashboard.read','users.read','users.suspend','teachers.read','teachers.approve',
          'teachers.reject','teachers.suspend','lessons.read','integrations.read','audit.read'
        ]))
        or (m.role = 'finance_admin' and p_permission = any(array[
          'dashboard.read','payments.read','audit.read'
        ]))
        or (m.role = 'support_admin' and p_permission = any(array[
          'dashboard.read','users.read','teachers.read','lessons.read','notifications.read','integrations.read'
        ]))
        or (m.role = 'auditor' and p_permission = 'audit.read')
      )
  )
$$;

create or replace function private.admin_role_for(p_user uuid)
returns text
language sql
security definer
set search_path = ''
stable
as $$
  select m.role::text
  from private.admin_memberships m join public.profiles p on p.id=m.user_id
  where m.user_id=p_user and m.active and m.revoked_at is null and p.status='active'
$$;

create or replace function private.admin_audit(
  p_actor uuid, p_action text, p_resource_type text, p_resource_id uuid,
  p_justification text, p_before jsonb, p_after jsonb, p_result text, p_request_id uuid
) returns void
language sql security definer set search_path = '' as $$
  insert into private.admin_audit_log (actor_id, action, resource_type, resource_id, justification,
    before_state, after_state, result, request_id)
  values (p_actor, p_action, p_resource_type, p_resource_id, p_justification,
    p_before, p_after, p_result, p_request_id)
$$;

revoke all on function private.admin_has_permission(uuid, text), private.admin_role_for(uuid),
  private.admin_audit(uuid, text, text, uuid, text, jsonb, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function private.admin_has_permission(uuid, text), private.admin_role_for(uuid),
  private.admin_audit(uuid, text, text, uuid, text, jsonb, jsonb, text, uuid) to edusearch_api;

create or replace function private.admin_dashboard(p_actor uuid, p_since timestamptz)
returns jsonb language sql security definer set search_path = '' stable as $$
  select jsonb_build_object(
    'students', (select count(*) from public.account_roles where role='student'),
    'teachers', (select count(*) from public.account_roles where role='teacher'),
    'teachers_approved', (select count(*) from public.teacher_profiles where verification_status='approved'),
    'teachers_pending', (select count(*) from public.teacher_profiles where verification_status='pending'),
    'lessons_scheduled', (select count(*) from public.lessons where status='scheduled' and created_at >= p_since),
    'lessons_cancelled', (select count(*) from public.lessons where status='cancelled' and created_at >= p_since),
    'payments_paid', (select count(*) from public.payment_intents where status='paid' and created_at >= p_since),
    'payments_pending', (select count(*) from public.payment_intents where status='pending' and created_at >= p_since),
    'confirmed_volume_cents', (select coalesce(sum(amount_cents) filter (where status='paid'), 0) from public.payment_intents where created_at >= p_since),
    'platform_commission_cents', (select coalesce(sum(commission_cents) filter (where status='paid'), 0) from public.payment_intents where created_at >= p_since)
  )
  where private.admin_has_permission(p_actor, 'dashboard.read')
$$;

create or replace function private.admin_list_teachers(p_actor uuid, p_limit integer, p_offset integer, p_status text)
returns jsonb language sql security definer set search_path = '' stable as $$
  select jsonb_build_object('items', coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb), 'limit', p_limit, 'offset', p_offset)
  from (
    select p.id, p.display_name, p.status::text as account_status,
      tp.verification_status::text, tp.is_published, tp.price_cents, tp.created_at
    from public.teacher_profiles tp join public.profiles p on p.id=tp.user_id
    where private.admin_has_permission(p_actor, 'teachers.read')
      and (p_status is null or tp.verification_status::text=p_status)
    order by tp.created_at desc limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
  ) t
$$;

create or replace function private.admin_transition_teacher(
  p_actor uuid, p_teacher uuid, p_action text, p_justification text, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_before jsonb; v_after jsonb; v_permission text; v_status public.teacher_verification_status;
begin
  if p_justification is null or length(trim(p_justification)) < 3 then raise exception 'admin_justification_required' using errcode='22023'; end if;
  v_permission := case p_action when 'approve' then 'teachers.approve' when 'reject' then 'teachers.reject'
    when 'suspend' then 'teachers.suspend' when 'reactivate' then 'teachers.suspend' else null end;
  if v_permission is null or not private.admin_has_permission(p_actor, v_permission) then raise exception 'admin_forbidden' using errcode='42501'; end if;
  select jsonb_build_object('verification_status', verification_status::text, 'is_published', is_published)
    into v_before from public.teacher_profiles where user_id=p_teacher for update;
  if v_before is null then raise exception 'teacher_not_found' using errcode='P0002'; end if;
  if p_action='approve' then
    update public.teacher_profiles set verification_status='approved', verified_at=now(), is_published=true where user_id=p_teacher;
  elsif p_action='reject' then
    update public.teacher_profiles set verification_status='rejected', verified_at=null, is_published=false where user_id=p_teacher;
  elsif p_action='suspend' then update public.profiles set status='suspended' where id=p_teacher;
  else update public.profiles set status='active' where id=p_teacher and status='suspended'; end if;
  select jsonb_build_object('verification_status', verification_status::text, 'is_published', is_published)
    into v_after from public.teacher_profiles where user_id=p_teacher;
  perform private.admin_audit(p_actor, 'teachers.' || p_action, 'teacher', p_teacher, p_justification,
    v_before, v_after, 'success', p_request_id);
  return v_after;
end $$;

revoke all on function private.admin_dashboard(uuid, timestamptz), private.admin_list_teachers(uuid, integer, integer, text),
  private.admin_transition_teacher(uuid, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function private.admin_dashboard(uuid, timestamptz), private.admin_list_teachers(uuid, integer, integer, text),
  private.admin_transition_teacher(uuid, uuid, text, text, uuid) to edusearch_api;

comment on table private.admin_memberships is 'RBAC administrativo; nunca gerenciado pelo onboarding público.';
comment on table private.admin_audit_log is 'Trilha imutável de ações administrativas; sem segredos ou tokens.';
