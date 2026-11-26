-- Consultas administrativas paginadas. Nenhuma tabela de domínio recebe grant direto.
create or replace function private.admin_operational_list(p_actor uuid, p_kind text, p_limit integer, p_offset integer, p_query text default null)
returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare v_permission text; v_items jsonb;
begin
  if p_limit not between 1 and 100 or p_offset < 0 then raise exception 'admin_pagination_invalid' using errcode='22023'; end if;
  v_permission := case p_kind when 'students' then 'users.read' when 'lessons' then 'lessons.read'
    when 'payments' then 'payments.read' when 'payout_accounts' then 'payments.read'
    when 'notifications' then 'notifications.read' when 'audit' then 'audit.read' when 'administrators' then 'admins.manage' end;
  if v_permission is null or not private.admin_has_permission(p_actor, v_permission) then raise exception 'admin_forbidden' using errcode='42501'; end if;
  if p_kind='students' then select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_items from (
    select p.id, p.display_name, p.status::text as status, p.created_at from public.profiles p join public.account_roles r on r.user_id=p.id and r.role='student'
    where p_query is null or p.display_name ilike '%'||p_query||'%' order by p.created_at desc limit p_limit offset p_offset) x;
  elsif p_kind='lessons' then select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_items from (
    select l.id,l.starts_at,l.ends_at,l.status::text,l.calendar_sync_status::text,l.meet_url is not null as meet_available,
      s.display_name as student_name,t.display_name as teacher_name,sub.name as subject
    from public.lessons l join public.profiles s on s.id=l.student_id join public.profiles t on t.id=l.teacher_id join public.subjects sub on sub.id=l.subject_id
    order by l.starts_at desc limit p_limit offset p_offset) x;
  elsif p_kind='payments' then select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_items from (
    select id,gateway_charge_id,status::text,amount_cents,commission_cents,teacher_share_cents,gateway_fee_cents,environment::text,split_status::text,created_at,paid_at
    from public.payment_intents order by created_at desc limit p_limit offset p_offset) x;
  elsif p_kind='payout_accounts' then select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_items from (
    select a.teacher_id,p.display_name,a.sub_account_id,a.tax_id_last4,a.environment::text,a.status,a.updated_at
    from public.teacher_payout_accounts a join public.profiles p on p.id=a.teacher_id order by a.updated_at desc limit p_limit offset p_offset) x;
  elsif p_kind='notifications' then select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_items from (
    select id,event_type,template_alias,status::text,attempts,created_at,processed_at,next_attempt_at,provider_message_id,error_code
    from private.notification_outbox order by created_at desc limit p_limit offset p_offset) x;
  elsif p_kind='audit' then select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_items from (
    select id,actor_id,action,resource_type,resource_id,justification,result,request_id,created_at
    from private.admin_audit_log order by created_at desc limit p_limit offset p_offset) x;
  else select coalesce(jsonb_agg(to_jsonb(x)), '[]') into v_items from (
    select m.user_id,m.role::text,m.active,m.granted_at,m.revoked_at,p.display_name from private.admin_memberships m join public.profiles p on p.id=m.user_id order by m.granted_at desc limit p_limit offset p_offset) x;
  end if;
  return jsonb_build_object('items', v_items, 'limit', p_limit, 'offset', p_offset);
end $$;
revoke all on function private.admin_operational_list(uuid,text,integer,integer,text) from public,anon,authenticated;
grant execute on function private.admin_operational_list(uuid,text,integer,integer,text) to edusearch_api;
