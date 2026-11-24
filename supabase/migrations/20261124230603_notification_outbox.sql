-- Outbox transacional privada. Nenhum cliente/PostgREST lê ou escreve a fila.
create type private.notification_status as enum ('pending', 'processing', 'sent', 'failed');

create table private.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_.-]{2,80}$'),
  source_id uuid,
  recipient_user_id uuid references public.profiles(id) on delete restrict,
  recipient_email text not null check (length(recipient_email) <= 320 and recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
  template_alias text not null check (template_alias ~ '^edusearch-[a-z0-9-]+-v[0-9]+$'),
  template_variables jsonb not null default '{}'::jsonb check (jsonb_typeof(template_variables) = 'object'),
  idempotency_key text not null check (length(idempotency_key) between 1 and 256),
  status private.notification_status not null default 'pending',
  attempts smallint not null default 0 check (attempts between 0 and 10),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  provider_message_id text,
  error_code text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  sent_at timestamptz,
  unique (idempotency_key)
);
alter table private.notification_outbox enable row level security;
revoke all on table private.notification_outbox from public, anon, authenticated;
create index notification_outbox_dispatch_idx on private.notification_outbox (status, next_attempt_at, created_at)
  where status in ('pending', 'processing');

create function private.notification_enqueue(
  p_event_type text, p_source_id uuid, p_recipient_user_id uuid, p_recipient_email text,
  p_template_alias text, p_template_variables jsonb, p_idempotency_key text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  insert into private.notification_outbox (
    event_type, source_id, recipient_user_id, recipient_email, template_alias,
    template_variables, idempotency_key
  ) values (
    p_event_type, p_source_id, p_recipient_user_id, lower(p_recipient_email), p_template_alias,
    p_template_variables, p_idempotency_key
  ) on conflict (idempotency_key) do update set idempotency_key = excluded.idempotency_key
    returning id into v_id;
  return v_id;
end $$;

-- Recupera leases abandonados e trava cada mensagem para um único despachante.
create function private.notification_claim(p_limit integer, p_lease_seconds integer default 300)
returns setof private.notification_outbox language plpgsql security definer set search_path = '' as $$
begin
  if p_limit not between 1 and 100 or p_lease_seconds not between 30 and 900 then
    raise exception using errcode='22023', message='notification_claim_arguments_invalid';
  end if;
  update private.notification_outbox
     set status = 'pending', locked_at = null, next_attempt_at = now()
   where status = 'processing' and locked_at < now() - make_interval(secs => p_lease_seconds);
  return query
  with claimed as (
    select id from private.notification_outbox
     where status = 'pending' and next_attempt_at <= now()
     order by created_at for update skip locked limit p_limit
  )
  update private.notification_outbox o set status='processing', locked_at=now(), attempts=attempts+1
    from claimed where o.id=claimed.id returning o.*;
end $$;

create function private.notification_sent(p_id uuid, p_provider_message_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update private.notification_outbox set status='sent', provider_message_id=p_provider_message_id,
    sent_at=now(), processed_at=now(), locked_at=null, error_code=null
  where id=p_id and status='processing';
end $$;

create function private.notification_retry(p_id uuid, p_error_code text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update private.notification_outbox set
    status=case when attempts >= 8 then 'failed' else 'pending' end,
    next_attempt_at=case when attempts >= 8 then next_attempt_at
      else now() + make_interval(secs => least(3600, 30 * power(2, attempts - 1)::integer)) end,
    error_code=left(coalesce(p_error_code, 'provider_error'), 80),
    processed_at=case when attempts >= 8 then now() else processed_at end,
    locked_at=null
  where id=p_id and status='processing';
end $$;

revoke all on function private.notification_enqueue(text, uuid, uuid, text, text, jsonb, text),
  private.notification_claim(integer, integer), private.notification_sent(uuid, text),
  private.notification_retry(uuid, text) from public, anon, authenticated;
grant execute on function private.notification_enqueue(text, uuid, uuid, text, text, jsonb, text),
  private.notification_claim(integer, integer), private.notification_sent(uuid, text),
  private.notification_retry(uuid, text) to edusearch_api;
