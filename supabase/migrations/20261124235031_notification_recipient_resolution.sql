-- A API resolve somente o e-mail confirmado de um destinatário conhecido; não recebe SELECT em auth.users.
create function private.notification_recipient_email(p_user_id uuid)
returns text language sql security definer set search_path = '' stable as $$
  select lower(u.email)
    from auth.users u
   where u.id = p_user_id
     and u.email is not null
     and u.email_confirmed_at is not null
$$;

create function private.notification_enqueue_for_user(
  p_event_type text, p_source_id uuid, p_recipient_user_id uuid,
  p_template_alias text, p_template_variables jsonb, p_idempotency_key text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_email text;
begin
  v_email := private.notification_recipient_email(p_recipient_user_id);
  -- Inelegibilidade de e-mail é esperada e não pode desfazer a transação de negócio.
  -- Falhas reais de integridade/permissão da inserção continuam propagando normalmente.
  if v_email is null then return null; end if;
  return private.notification_enqueue(
    p_event_type, p_source_id, p_recipient_user_id, v_email,
    p_template_alias, p_template_variables, p_idempotency_key
  );
end $$;

revoke all on function private.notification_recipient_email(uuid),
  private.notification_enqueue_for_user(text, uuid, uuid, text, jsonb, text)
  from public, anon, authenticated;
grant execute on function private.notification_recipient_email(uuid),
  private.notification_enqueue_for_user(text, uuid, uuid, text, jsonb, text)
  to edusearch_api;
