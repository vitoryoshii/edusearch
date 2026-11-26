-- EduSearch — PR #37: elegibilidade comercial exige credenciamento aprovado pelo Trust Engine.
--
-- Busca pública, disponibilidade, reservas e cobranças já exigem teacher_profiles.is_published, e
-- is_published exige verification_status = 'approved' (CHECK). Este gatilho fecha a última porta:
-- nenhum caminho (Admin, função, operador) aprova ou publica sem credenciamento aprovado.

-- ----------------------------------------------------------- política para aprovados legados
-- Professores aprovados antes do Trust Engine não têm credenciamento comprovado. Eles deixam de
-- ser publicáveis para NOVAS reservas, com o estado anterior preservado para auditoria/reversão.
-- Aulas, reservas e pagamentos existentes não são tocados.

create table private.teacher_credential_legacy_review (
  teacher_id uuid primary key references public.teacher_profiles(user_id) on delete restrict,
  previous_verification_status public.teacher_verification_status not null,
  previous_verified_at timestamptz,
  previous_is_published boolean not null,
  previous_published_at timestamptz,
  migrated_at timestamptz not null default now(),
  policy text not null default 'trust-engine-v1.requires-credentialing'
);
alter table private.teacher_credential_legacy_review enable row level security;
revoke all on table private.teacher_credential_legacy_review from public, anon, authenticated;

insert into private.teacher_credential_legacy_review (
  teacher_id, previous_verification_status, previous_verified_at, previous_is_published,
  previous_published_at
)
select tp.user_id, tp.verification_status, tp.verified_at, tp.is_published, tp.published_at
  from public.teacher_profiles as tp
 where (tp.verification_status = 'approved' or tp.is_published)
   and not exists (
     select 1 from private.teacher_verifications as v
      where v.teacher_id = tp.user_id and v.status = 'approved'
   );

update public.teacher_profiles as tp
   set verification_status = 'pending', verified_at = null, is_published = false, published_at = null
 where tp.user_id in (select l.teacher_id from private.teacher_credential_legacy_review as l);

-- ------------------------------------------------------------- elegibilidade comercial (gate)

create function private.teacher_profile_requires_credential()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.verification_status = 'approved' or new.is_published)
     and not exists (
       select 1 from private.teacher_verifications as v
        where v.teacher_id = new.user_id and v.status = 'approved'
     ) then
    raise exception using errcode = 'P0001', message = 'teacher_credential_required';
  end if;
  return new;
end;
$$;

create trigger teacher_profiles_require_credential
  before insert or update on public.teacher_profiles
  for each row execute function private.teacher_profile_requires_credential();

-- --------------------------------------------- Admin da PR #36: aprovar exige credenciamento

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
  from public.teacher_profiles as tp
  join public.profiles as p on p.id = tp.user_id
  where tp.user_id = p_teacher
  for update of tp, p;
  if v_before is null then raise exception 'teacher_not_found' using errcode='P0002'; end if;

  if p_action = 'approve' then
    -- A aprovação administrativa não contorna o Trust Engine: só republica quem já tem
    -- credenciamento aprovado com evidências suficientes.
    if not exists (select 1 from private.teacher_verifications as v
                    where v.teacher_id = p_teacher and v.status = 'approved') then
      raise exception 'trust_credential_required' using errcode='22023';
    end if;
    if v_verification <> 'pending' then raise exception 'teacher_transition_invalid' using errcode='22023'; end if;
    update public.teacher_profiles as tp
      set verification_status='approved', verified_at=now(), is_published=true, published_at=now()
      where tp.user_id=p_teacher;
  elsif p_action='reject' then
    if v_verification <> 'pending' then raise exception 'teacher_transition_invalid' using errcode='22023'; end if;
    update public.teacher_profiles as tp
      set verification_status='rejected', verified_at=null, is_published=false, published_at=null
      where tp.user_id=p_teacher;
  elsif p_action='suspend' then
    if v_account <> 'active' then raise exception 'teacher_transition_invalid' using errcode='22023'; end if;
    update public.profiles as p set status='suspended' where p.id=p_teacher;
  else
    if v_account <> 'suspended' then raise exception 'teacher_transition_invalid' using errcode='22023'; end if;
    update public.profiles as p set status='active' where p.id=p_teacher;
  end if;

  select jsonb_build_object('verification_status', tp.verification_status::text,
    'is_published', tp.is_published, 'account_status', p.status::text)
    into v_after
  from public.teacher_profiles as tp join public.profiles as p on p.id = tp.user_id
  where tp.user_id = p_teacher;
  perform private.admin_audit(p_actor, 'teachers.' || p_action, 'teacher', p_teacher,
    p_justification, v_before, v_after, 'success', p_request_id);
  return v_after;
end $$;


revoke all on function private.teacher_profile_requires_credential() from public, anon, authenticated;

comment on table private.teacher_credential_legacy_review is
  'Professores aprovados antes do Trust Engine, despublicados para novas reservas; estado anterior preservado.';
