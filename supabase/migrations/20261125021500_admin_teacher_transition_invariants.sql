-- Corrige a transição administrativa sem reescrever a migration já versionada.
-- Aprovação administrativa publica o perfil somente na mesma transação e mantém
-- os pares is_published/published_at e verification_status/verified_at coerentes.
create or replace function private.admin_transition_teacher(
  p_actor uuid, p_teacher uuid, p_action text, p_justification text, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_permission text;
  v_verification public.teacher_verification_status;
  v_account public.profile_status;
begin
  if p_justification is null or length(trim(p_justification)) < 3 then
    raise exception 'admin_justification_required' using errcode='22023';
  end if;
  v_permission := case p_action
    when 'approve' then 'teachers.approve'
    when 'reject' then 'teachers.reject'
    when 'suspend' then 'teachers.suspend'
    when 'reactivate' then 'teachers.suspend'
    else null
  end;
  if v_permission is null or not private.admin_has_permission(p_actor, v_permission) then
    raise exception 'admin_forbidden' using errcode='42501';
  end if;

  select tp.verification_status, p.status,
    jsonb_build_object('verification_status', tp.verification_status::text,
      'is_published', tp.is_published, 'account_status', p.status::text)
    into v_verification, v_account, v_before
  from public.teacher_profiles tp
  join public.profiles p on p.id=tp.user_id
  where tp.user_id=p_teacher
  for update of tp, p;
  if v_before is null then raise exception 'teacher_not_found' using errcode='P0002'; end if;

  if p_action='approve' then
    if v_verification <> 'pending' then raise exception 'teacher_transition_invalid' using errcode='22023'; end if;
    update public.teacher_profiles
      set verification_status='approved', verified_at=now(), is_published=true, published_at=now()
      where user_id=p_teacher;
  elsif p_action='reject' then
    if v_verification <> 'pending' then raise exception 'teacher_transition_invalid' using errcode='22023'; end if;
    update public.teacher_profiles
      set verification_status='rejected', verified_at=null, is_published=false, published_at=null
      where user_id=p_teacher;
  elsif p_action='suspend' then
    if v_account <> 'active' then raise exception 'teacher_transition_invalid' using errcode='22023'; end if;
    update public.profiles set status='suspended' where id=p_teacher;
  else
    if v_account <> 'suspended' then raise exception 'teacher_transition_invalid' using errcode='22023'; end if;
    update public.profiles set status='active' where id=p_teacher;
  end if;

  select jsonb_build_object('verification_status', tp.verification_status::text,
    'is_published', tp.is_published, 'account_status', p.status::text)
    into v_after
  from public.teacher_profiles tp join public.profiles p on p.id=tp.user_id
  where tp.user_id=p_teacher;
  perform private.admin_audit(p_actor, 'teachers.' || p_action, 'teacher', p_teacher,
    p_justification, v_before, v_after, 'success', p_request_id);
  return v_after;
end $$;

revoke all on function private.admin_transition_teacher(uuid, uuid, text, text, uuid)
  from public, anon, authenticated;
grant execute on function private.admin_transition_teacher(uuid, uuid, text, text, uuid)
  to edusearch_api;
