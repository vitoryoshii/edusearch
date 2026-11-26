-- EduSearch — PR #37: dossiê privado de credenciamento profissional.
--
-- O perfil público continua em public.teacher_profiles. Este dossiê não é exposto pela Data API
-- e não altera retrospectivamente a aprovação existente: ele é a fonte de verdade do fluxo de
-- documentos. A publicação continua fail-closed e depende da decisão administrativa posterior.

create type private.teacher_credential_status as enum (
  'draft', 'submitted', 'under_review', 'changes_requested', 'approved', 'rejected', 'suspended'
);

create type private.teacher_qualification_kind as enum (
  'graduated', 'specialist', 'university_student', 'tutor'
);

create type private.teacher_document_kind as enum ('identity', 'academic_proof', 'curriculum');
create type private.teacher_document_status as enum ('quarantined', 'accepted', 'rejected');

create table private.teacher_verifications (
  teacher_id uuid primary key references public.teacher_profiles(user_id) on delete cascade,
  status private.teacher_credential_status not null default 'draft',
  qualification_kind private.teacher_qualification_kind,
  birth_date date,
  institution text,
  qualification text,
  professional_experience text,
  curriculum_summary text,
  financial_tax_id_kind text check (financial_tax_id_kind in ('cpf', 'cnpj')),
  financial_tax_id_last4 text check (financial_tax_id_last4 is null or financial_tax_id_last4 ~ '^[0-9]{4}$'),
  terms_version text,
  terms_accepted_at timestamptz,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewer_id uuid references public.profiles(id) on delete restrict,
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teacher_verification_adult check (birth_date is null or birth_date <= current_date - interval '18 years'),
  constraint teacher_verification_institution_len check (institution is null or char_length(institution) between 2 and 160),
  constraint teacher_verification_qualification_len check (qualification is null or char_length(qualification) between 2 and 200),
  constraint teacher_verification_experience_len check (professional_experience is null or char_length(professional_experience) <= 2000),
  constraint teacher_verification_curriculum_len check (curriculum_summary is null or char_length(curriculum_summary) <= 4000),
  constraint teacher_verification_terms_len check (terms_version is null or terms_version ~ '^[a-z0-9][a-z0-9._-]{0,79}$'),
  constraint teacher_verification_terms_consistent check (
    (terms_version is null) = (terms_accepted_at is null)
  ),
  constraint teacher_verification_submitted_consistent check (
    (status in ('submitted', 'under_review', 'approved', 'rejected', 'suspended')) = (submitted_at is not null)
  )
);
alter table private.teacher_verifications enable row level security;
revoke all on table private.teacher_verifications from public, anon, authenticated;
create trigger teacher_verifications_set_updated_at before update on private.teacher_verifications
  for each row execute function private.set_updated_at();

create table private.teacher_verification_documents (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teacher_profiles(user_id) on delete cascade,
  document_kind private.teacher_document_kind not null,
  storage_path text not null unique,
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  version smallint not null check (version > 0),
  status private.teacher_document_status not null default 'quarantined',
  uploaded_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewer_id uuid references public.profiles(id) on delete restrict,
  review_reason text,
  constraint teacher_verification_document_path check (
    storage_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}\.(pdf|png|jpe?g)$'
  ),
  constraint teacher_verification_document_review check (
    (status = 'quarantined' and reviewed_at is null and reviewer_id is null)
    or (status in ('accepted', 'rejected') and reviewed_at is not null and reviewer_id is not null)
  ),
  unique (teacher_id, document_kind, version)
);
alter table private.teacher_verification_documents enable row level security;
revoke all on table private.teacher_verification_documents from public, anon, authenticated;
create index teacher_verification_documents_teacher_idx
  on private.teacher_verification_documents (teacher_id, document_kind, version desc);

create table private.teacher_verification_audit_log (
  id bigint generated always as identity primary key,
  teacher_id uuid not null references public.teacher_profiles(user_id) on delete restrict,
  actor_id uuid references public.profiles(id) on delete restrict,
  action text not null check (action ~ '^[a-z][a-z0-9_.-]{2,80}$'),
  from_status private.teacher_credential_status,
  to_status private.teacher_credential_status,
  detail text,
  occurred_at timestamptz not null default now()
);
alter table private.teacher_verification_audit_log enable row level security;
revoke all on table private.teacher_verification_audit_log from public, anon, authenticated;
create index teacher_verification_audit_teacher_idx
  on private.teacher_verification_audit_log (teacher_id, occurred_at desc);

-- Bucket privado; nenhum objeto tem URL pública. A Storage aplica RLS em toda operação.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'teacher-verification', 'teacher-verification', false, 10485760,
  array['application/pdf', 'image/png', 'image/jpeg']::text[]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy teacher_verification_storage_select_own on storage.objects
  for select to authenticated
  using (
    bucket_id = 'teacher-verification'
    and owner_id = (select auth.uid())
  );

create policy teacher_verification_storage_insert_own on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'teacher-verification'
    and owner_id = (select auth.uid())
    and (storage.foldername(name))[1] = (select auth.jwt() ->> 'sub')
  );
-- Sem UPDATE/DELETE: uma nova versão recebe um novo objeto e a cadeia de auditoria é preservada.

create function private.teacher_verification_claims_sub()
returns uuid language sql stable set search_path = '' as $$
  select (nullif((select current_setting('request.jwt.claims', true)), '')::jsonb ->> 'sub')::uuid
$$;

create function private.teacher_verification_require_teacher()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_teacher uuid := private.teacher_verification_claims_sub();
begin
  if v_teacher is null
     or not exists (
       select 1 from public.account_roles
        where user_id = v_teacher and role = 'teacher'
     )
     or not exists (select 1 from public.teacher_profiles where user_id = v_teacher) then
    raise exception using errcode = 'insufficient_privilege', message = 'teacher_role_required';
  end if;
  if exists (select 1 from public.profiles where id = v_teacher and status = 'suspended') then
    raise exception using errcode = 'insufficient_privilege', message = 'account_suspended';
  end if;
  return v_teacher;
end;
$$;

create function private.teacher_verification_upsert(
  p_qualification_kind private.teacher_qualification_kind,
  p_birth_date date,
  p_institution text,
  p_qualification text,
  p_professional_experience text,
  p_curriculum_summary text,
  p_tax_id_kind text,
  p_tax_id_last4 text,
  p_terms_version text
) returns table (
  status private.teacher_credential_status,
  qualification_kind private.teacher_qualification_kind,
  submitted_at timestamptz,
  terms_accepted_at timestamptz
) language plpgsql security definer set search_path = '' as $$
declare v_teacher uuid := private.teacher_verification_require_teacher();
begin
  if p_tax_id_kind not in ('cpf', 'cnpj') or p_tax_id_last4 !~ '^[0-9]{4}$' then
    raise exception using errcode = '22023', message = 'invalid_financial_identity';
  end if;
  if p_birth_date > current_date - interval '18 years' then
    raise exception using errcode = '22023', message = 'teacher_must_be_adult';
  end if;
  insert into private.teacher_verifications (
    teacher_id, qualification_kind, birth_date, institution, qualification,
    professional_experience, curriculum_summary, financial_tax_id_kind, financial_tax_id_last4,
    terms_version, terms_accepted_at
  ) values (
    v_teacher, p_qualification_kind, p_birth_date, nullif(btrim(p_institution), ''),
    nullif(btrim(p_qualification), ''), nullif(btrim(p_professional_experience), ''),
    nullif(btrim(p_curriculum_summary), ''), p_tax_id_kind, p_tax_id_last4,
    p_terms_version, now()
  ) on conflict (teacher_id) do update set
    qualification_kind = excluded.qualification_kind,
    birth_date = excluded.birth_date,
    institution = excluded.institution,
    qualification = excluded.qualification,
    professional_experience = excluded.professional_experience,
    curriculum_summary = excluded.curriculum_summary,
    financial_tax_id_kind = excluded.financial_tax_id_kind,
    financial_tax_id_last4 = excluded.financial_tax_id_last4,
    terms_version = excluded.terms_version,
    terms_accepted_at = excluded.terms_accepted_at
  where private.teacher_verifications.status in ('draft', 'changes_requested');
  if not found then
    raise exception using errcode = 'P0001', message = 'verification_locked_for_review';
  end if;
  insert into private.teacher_verification_audit_log (teacher_id, actor_id, action, to_status)
  select teacher_id, v_teacher, 'teacher.dossier_saved', status
    from private.teacher_verifications where teacher_id = v_teacher;
  return query select v.status, v.qualification_kind, v.submitted_at, v.terms_accepted_at
    from private.teacher_verifications v where v.teacher_id = v_teacher;
end;
$$;

create function private.teacher_verification_register_document(
  p_document_kind private.teacher_document_kind,
  p_storage_path text
) returns table (
  document_kind private.teacher_document_kind,
  version smallint,
  status private.teacher_document_status,
  uploaded_at timestamptz
) language plpgsql security definer set search_path = '' as $$
declare
  v_teacher uuid := private.teacher_verification_require_teacher();
  v_object storage.objects;
  v_size bigint;
  v_content_type text;
  v_version smallint;
begin
  if not exists (
    select 1 from private.teacher_verifications
     where teacher_id = v_teacher and status in ('draft', 'changes_requested')
  ) then
    raise exception using errcode = 'P0001', message = 'verification_dossier_required';
  end if;
  if p_storage_path !~ ('^' || v_teacher::text || '/[0-9a-f-]{36}\.(pdf|png|jpe?g)$') then
    raise exception using errcode = '22023', message = 'invalid_document_path';
  end if;
  select * into v_object from storage.objects
   where bucket_id = 'teacher-verification' and name = p_storage_path and owner_id = v_teacher;
  if not found then
    raise exception using errcode = 'P0001', message = 'document_not_owned';
  end if;
  v_content_type := lower(coalesce(v_object.metadata ->> 'mimetype', ''));
  if v_content_type not in ('application/pdf', 'image/png', 'image/jpeg') then
    raise exception using errcode = '22023', message = 'invalid_document_content_type';
  end if;
  if coalesce(v_object.metadata ->> 'size', '') !~ '^[0-9]+$' then
    raise exception using errcode = '22023', message = 'invalid_document_size';
  end if;
  v_size := (v_object.metadata ->> 'size')::bigint;
  if v_size < 1 or v_size > 10485760 then
    raise exception using errcode = '22023', message = 'invalid_document_size';
  end if;
  select coalesce(max(d.version), 0)::smallint + 1 into v_version
    from private.teacher_verification_documents d
   where d.teacher_id = v_teacher and d.document_kind = p_document_kind;
  insert into private.teacher_verification_documents (
    teacher_id, document_kind, storage_path, content_type, size_bytes, version
  ) values (v_teacher, p_document_kind, p_storage_path, v_content_type, v_size, v_version)
  on conflict (storage_path) do nothing;
  if not found then
    raise exception using errcode = 'P0001', message = 'document_already_registered';
  end if;
  insert into private.teacher_verification_audit_log (teacher_id, actor_id, action, to_status, detail)
  select v_teacher, v_teacher, 'teacher.document_registered', v.status, p_document_kind::text
    from private.teacher_verifications v where v.teacher_id = v_teacher;
  return query select d.document_kind, d.version, d.status, d.uploaded_at
    from private.teacher_verification_documents d where d.storage_path = p_storage_path;
end;
$$;

create function private.teacher_verification_submit()
returns table (status private.teacher_credential_status, submitted_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_teacher uuid := private.teacher_verification_require_teacher(); v_status private.teacher_credential_status;
begin
  select status into v_status from private.teacher_verifications where teacher_id = v_teacher for update;
  if not found then raise exception using errcode = 'P0001', message = 'verification_dossier_required'; end if;
  if v_status not in ('draft', 'changes_requested') then
    raise exception using errcode = 'P0001', message = 'verification_not_submittable';
  end if;
  if not exists (
       select 1 from private.teacher_verification_documents
        where teacher_id=v_teacher and document_kind='identity' and status <> 'rejected'
     )
     or not exists (
       select 1 from private.teacher_verification_documents
        where teacher_id=v_teacher and document_kind='academic_proof' and status <> 'rejected'
     ) then
    raise exception using errcode = 'P0001', message = 'verification_documents_required';
  end if;
  update private.teacher_verifications set status='submitted', submitted_at=now(), review_reason=null,
    reviewed_at=null, reviewer_id=null where teacher_id=v_teacher;
  -- Uma nova análise nunca mantém publicação/aprovação antiga por acidente.
  update public.teacher_profiles set verification_status='pending', verified_at=null,
    is_published=false, published_at=null where user_id=v_teacher;
  insert into private.teacher_verification_audit_log (teacher_id, actor_id, action, from_status, to_status)
    values (v_teacher, v_teacher, 'teacher.verification_submitted', v_status, 'submitted');
  return query select v.status, v.submitted_at from private.teacher_verifications v where v.teacher_id=v_teacher;
end;
$$;

create function private.teacher_verification_summary()
returns table (
  status private.teacher_credential_status, qualification_kind private.teacher_qualification_kind,
  institution text, qualification text, submitted_at timestamptz, review_reason text,
  terms_version text, terms_accepted_at timestamptz, documents jsonb
) language sql stable security definer set search_path = '' as $$
  select v.status, v.qualification_kind, v.institution, v.qualification, v.submitted_at,
    v.review_reason, v.terms_version, v.terms_accepted_at,
    coalesce(jsonb_agg(jsonb_build_object('kind', d.document_kind, 'version', d.version,
      'status', d.status, 'uploaded_at', d.uploaded_at) order by d.document_kind, d.version)
      filter (where d.id is not null), '[]'::jsonb)
  from private.teacher_verifications v
  left join private.teacher_verification_documents d on d.teacher_id=v.teacher_id
  where v.teacher_id = private.teacher_verification_claims_sub()
  group by v.teacher_id
$$;

revoke all on function
  private.teacher_verification_claims_sub(),
  private.teacher_verification_require_teacher(),
  private.teacher_verification_upsert(private.teacher_qualification_kind, date, text, text, text, text, text, text, text),
  private.teacher_verification_register_document(private.teacher_document_kind, text),
  private.teacher_verification_submit(),
  private.teacher_verification_summary()
from public, anon, authenticated;

grant execute on function
  private.teacher_verification_upsert(private.teacher_qualification_kind, date, text, text, text, text, text, text, text),
  private.teacher_verification_register_document(private.teacher_document_kind, text),
  private.teacher_verification_submit(),
  private.teacher_verification_summary()
to edusearch_api;

comment on table private.teacher_verifications is
  'Dossiê privado de credenciamento; CPF/CNPJ integral não é duplicado aqui (fica apenas no fluxo de subconta).';
comment on table private.teacher_verification_documents is
  'Metadados de documentos em bucket privado. Objetos iniciam em quarentena e requerem revisão humana.';
