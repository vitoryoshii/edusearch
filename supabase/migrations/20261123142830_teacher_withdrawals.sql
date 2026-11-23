-- Saques de subconta: só a API escreve; professor lê exclusivamente seu próprio histórico.
create type public.withdrawal_status as enum ('pending', 'completed', 'failed');

create table public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teacher_profiles(user_id) on delete restrict,
  environment public.payment_environment not null,
  sub_account_id text not null check (sub_account_id ~ '^sacc_[A-Za-z0-9]{4,64}$'),
  amount_cents integer not null check (amount_cents >= 100),
  idempotency_key uuid not null,
  external_id text not null unique check (external_id ~ '^wd_[A-Za-z0-9_-]{8,128}$'),
  gateway_transfer_id text unique check (gateway_transfer_id is null or gateway_transfer_id ~ '^tran_[A-Za-z0-9_-]{4,128}$'),
  status public.withdrawal_status not null default 'pending',
  gateway_fee_cents integer check (gateway_fee_cents is null or gateway_fee_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (teacher_id, environment, idempotency_key)
);
alter table public.withdrawal_requests enable row level security;
revoke all on public.withdrawal_requests from public, anon, authenticated;
grant select on public.withdrawal_requests to authenticated;
create policy withdrawal_requests_select_own on public.withdrawal_requests
  for select to authenticated using (teacher_id = (select auth.uid()));
create trigger withdrawal_requests_set_updated_at before update on public.withdrawal_requests
  for each row execute function private.set_updated_at();

create table private.withdrawal_audit_log (
  id bigint generated always as identity primary key,
  withdrawal_id uuid not null references public.withdrawal_requests(id) on delete restrict,
  occurred_at timestamptz not null default now(),
  actor text not null check (actor in ('teacher', 'gateway', 'system')),
  from_status public.withdrawal_status,
  to_status public.withdrawal_status not null,
  detail text
);
revoke all on private.withdrawal_audit_log from public, anon, authenticated;

create function private.withdrawal_create(p_amount integer, p_key uuid, p_external text,
  p_env public.payment_environment, p_sacc text)
returns public.withdrawal_requests language plpgsql security definer set search_path = '' as $$
declare v_teacher uuid := private.claims_sub(); v public.withdrawal_requests;
begin
  if v_teacher is null or not exists (select 1 from public.account_roles where user_id=v_teacher and role='teacher') then
    raise exception using errcode='insufficient_privilege', message='role_required';
  end if;
  insert into public.withdrawal_requests (teacher_id, environment, sub_account_id, amount_cents, idempotency_key, external_id)
  values (v_teacher,p_env,p_sacc,p_amount,p_key,p_external)
  on conflict (teacher_id, environment, idempotency_key) do nothing returning * into v;
  if not found then
    select * into v from public.withdrawal_requests where teacher_id=v_teacher and environment=p_env and idempotency_key=p_key;
  else
    insert into private.withdrawal_audit_log(withdrawal_id,actor,to_status,detail) values(v.id,'teacher','pending','requested');
  end if;
  return v;
end $$;

create function private.withdrawal_attach(p_id uuid, p_transfer text, p_fee integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.withdrawal_requests set gateway_transfer_id=p_transfer, gateway_fee_cents=p_fee
   where id=p_id and teacher_id=private.claims_sub() and status='pending';
end $$;

create function private.withdrawal_finish(p_external text, p_transfer text, p_amount integer,
  p_fee integer, p_status public.withdrawal_status)
returns text language plpgsql security definer set search_path = '' as $$
declare v public.withdrawal_requests;
begin
  select * into v from public.withdrawal_requests where external_id=p_external for update;
  if not found then return 'unknown_withdrawal'; end if;
  if v.environment <> 'production' or v.amount_cents <> p_amount then return 'mismatch'; end if;
  if v.status <> 'pending' then return 'already_processed'; end if;
  update public.withdrawal_requests set status=p_status, gateway_transfer_id=p_transfer,
    gateway_fee_cents=coalesce(p_fee,gateway_fee_cents) where id=v.id;
  insert into private.withdrawal_audit_log(withdrawal_id,actor,from_status,to_status)
  values(v.id,'gateway','pending',p_status);
  return case when p_status='completed' then 'completed' else 'failed' end;
end $$;

revoke all on function private.withdrawal_create(integer, uuid, text, public.payment_environment, text),
  private.withdrawal_attach(uuid, text, integer),
  private.withdrawal_finish(text, text, integer, integer, public.withdrawal_status) from public, anon, authenticated;
grant execute on function private.withdrawal_create(integer, uuid, text, public.payment_environment, text),
  private.withdrawal_attach(uuid, text, integer),
  private.withdrawal_finish(text, text, integer, integer, public.withdrawal_status) to edusearch_api;
