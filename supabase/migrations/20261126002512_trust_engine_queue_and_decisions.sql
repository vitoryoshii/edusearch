-- EduSearch — PR #37: Trust Engine V1 (credenciamento automatizado, fail-closed).
--
-- Arquitetura:
--   * O dispatcher (API, acionado por Cloudflare Cron) reivindica jobs com lease, monta o contexto do
--     dossiê por private.teacher_verification_job_context e executa os validadores em Python.
--   * private.teacher_verification_record_decision persiste evidências e aplica a decisão. Ela
--     RECONFERE as regras versionadas: "approved" só é aceito quando todo requisito obrigatório da
--     versão de regras tem evidência "passed" de uma origem permitida. Uma falha no Python não aprova.
--   * Origem self_declared nunca comprova identidade ou formação. Sem provedor confiável integrado,
--     esses requisitos ficam "unavailable" e o dossiê vai para pending_external (não há aprovação).
--   * Decisões automáticas têm autoria de serviço explícita (actor_kind = 'service'); decisões
--     humanas exigem um administrador real. Não há usuário fictício representando o robô.
--   * Elegibilidade comercial: um gatilho em public.teacher_profiles impede aprovação/publicação sem
--     credenciamento aprovado — cobre Admin, busca, reservas e cobranças (todos exigem is_published).

-- ----------------------------------------------------------------------------------- tipos

create type private.trust_job_status as enum ('pending', 'processing', 'completed', 'failed');
create type private.trust_evidence_result as enum ('passed', 'failed', 'unavailable', 'inconclusive');
create type private.trust_evidence_source as enum (
  'self_declared', 'file_analysis', 'internal_registry', 'digital_signature', 'external_registry'
);
create type private.trust_decision as enum (
  'approved', 'changes_requested', 'pending_external', 'manual_review', 'rejected', 'upheld'
);
create type private.trust_actor_kind as enum ('service', 'human');
create type private.trust_contestation_status as enum ('open', 'resolved');

-- ------------------------------------------------------------------ documentos: inspeção real

alter table private.teacher_verification_documents
  add column sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  add column detected_content_type text check (
    detected_content_type is null
    or detected_content_type in ('application/pdf', 'image/png', 'image/jpeg')
  ),
  add column inspection_status text not null default 'pending'
    check (inspection_status in ('pending', 'passed', 'failed')),
  add column inspection_code text check (
    inspection_code is null or inspection_code ~ '^[a-z][a-z0-9_.-]{2,80}$'
  ),
  add column signature_present boolean not null default false,
  add column inspected_at timestamptz,
  add column reviewed_by_service text check (
    reviewed_by_service is null or reviewed_by_service ~ '^[a-z][a-z0-9_.-]{2,80}$'
  ),
  add constraint teacher_verification_document_inspection check (
    (inspection_status = 'passed') = (sha256 is not null and detected_content_type is not null
                                      and inspected_at is not null)
  );

-- Revisão de documento: humana (reviewer_id) OU de serviço (reviewed_by_service), nunca ambas.
alter table private.teacher_verification_documents
  drop constraint teacher_verification_document_review;
alter table private.teacher_verification_documents
  add constraint teacher_verification_document_review check (
    (status = 'quarantined' and reviewed_at is null and reviewer_id is null
       and reviewed_by_service is null)
    or (status in ('accepted', 'rejected') and reviewed_at is not null
       and ((reviewer_id is not null) <> (reviewed_by_service is not null)))
  );
create index teacher_verification_documents_sha_idx
  on private.teacher_verification_documents (sha256) where sha256 is not null;

-- ------------------------------------------------------------------------ regras versionadas

create table private.trust_rule_requirements (
  rules_version text not null check (rules_version ~ '^trust-rules-[0-9]{4}\.[0-9]{2}-v[0-9]+$'),
  requirement text not null check (requirement ~ '^[a-z][a-z0-9_.-]{2,80}$'),
  validator text not null,
  allowed_sources private.trust_evidence_source[] not null check (cardinality(allowed_sources) > 0),
  primary key (rules_version, requirement)
);
alter table private.trust_rule_requirements enable row level security;
revoke all on table private.trust_rule_requirements from public, anon, authenticated;

-- Requisitos OBRIGATÓRIOS da V1. Identidade e formação só podem ser comprovadas por registro
-- externo confiável ou assinatura digital validada; declaração própria não basta.
insert into private.trust_rule_requirements (rules_version, requirement, validator, allowed_sources) values
  ('trust-rules-2026.11-v1', 'registration.terms_current', 'registration_validator', '{self_declared}'),
  ('trust-rules-2026.11-v1', 'registration.profile_complete', 'registration_validator', '{self_declared}'),
  ('trust-rules-2026.11-v1', 'registration.adult', 'registration_validator', '{self_declared,external_registry}'),
  ('trust-rules-2026.11-v1', 'document.identity_valid', 'document_validator', '{file_analysis}'),
  ('trust-rules-2026.11-v1', 'document.academic_valid', 'document_validator', '{file_analysis}'),
  ('trust-rules-2026.11-v1', 'identity.verified', 'identity_validator', '{external_registry,digital_signature}'),
  ('trust-rules-2026.11-v1', 'academic.issuer_verified', 'academic_validator', '{external_registry,digital_signature}'),
  ('trust-rules-2026.11-v1', 'fraud.no_duplicate_documents', 'fraud_detection_service', '{internal_registry}');

-- ------------------------------------------------------------------------------------ fila

create table private.teacher_verification_jobs (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teacher_profiles(user_id) on delete restrict,
  submitted_at timestamptz not null,
  status private.trust_job_status not null default 'pending',
  attempts smallint not null default 0 check (attempts between 0 and 10),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  rules_version text,
  error_code text check (error_code is null or error_code ~ '^[a-z][a-z0-9_.-]{2,80}$'),
  created_at timestamptz not null default now(),
  unique (teacher_id, submitted_at)
);
alter table private.teacher_verification_jobs enable row level security;
revoke all on table private.teacher_verification_jobs from public, anon, authenticated;
create index teacher_verification_jobs_claim_idx
  on private.teacher_verification_jobs (status, next_attempt_at, created_at)
  where status in ('pending', 'processing');
create index teacher_verification_jobs_teacher_idx
  on private.teacher_verification_jobs (teacher_id, created_at desc);

create table private.teacher_verification_evidence (
  id bigint generated always as identity primary key,
  job_id uuid not null references private.teacher_verification_jobs(id) on delete restrict,
  validator text not null check (validator in (
    'registration_validator', 'identity_validator', 'document_validator', 'academic_validator',
    'curriculum_analyzer', 'fraud_detection_service'
  )),
  requirement text not null check (requirement ~ '^[a-z][a-z0-9_.-]{2,80}$'),
  mandatory boolean not null,
  result private.trust_evidence_result not null,
  source private.trust_evidence_source not null,
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9_.-]{2,120}$'),
  details jsonb not null default '{}'::jsonb check (
    jsonb_typeof(details) = 'object' and length(details::text) <= 2000
  ),
  observed_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  unique (job_id, requirement)
);
alter table private.teacher_verification_evidence enable row level security;
revoke all on table private.teacher_verification_evidence from public, anon, authenticated;

create table private.teacher_verification_decisions (
  id uuid primary key default gen_random_uuid(),
  job_id uuid unique references private.teacher_verification_jobs(id) on delete restrict,
  teacher_id uuid not null references public.teacher_profiles(user_id) on delete restrict,
  decision private.trust_decision not null,
  rules_version text,
  reasons text[] not null default '{}' check (cardinality(reasons) <= 20),
  actor_kind private.trust_actor_kind not null,
  service_name text check (service_name is null or service_name ~ '^[a-z][a-z0-9_.-]{2,80}$'),
  actor_id uuid references public.profiles(id) on delete restrict,
  justification text check (justification is null or char_length(justification) between 3 and 500),
  decided_at timestamptz not null default now(),
  constraint trust_decision_actor check (
    (actor_kind = 'service' and service_name is not null and actor_id is null
       and job_id is not null and rules_version is not null and decision <> 'rejected')
    or (actor_kind = 'human' and actor_id is not null and service_name is null
       and justification is not null)
  )
);
alter table private.teacher_verification_decisions enable row level security;
revoke all on table private.teacher_verification_decisions from public, anon, authenticated;
create index teacher_verification_decisions_teacher_idx
  on private.teacher_verification_decisions (teacher_id, decided_at desc);

create table private.teacher_verification_contestations (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teacher_profiles(user_id) on delete restrict,
  decision_id uuid not null references private.teacher_verification_decisions(id) on delete restrict,
  reason text not null check (char_length(reason) between 20 and 2000),
  status private.trust_contestation_status not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolver_id uuid references public.profiles(id) on delete restrict,
  resolution text check (resolution is null or resolution in ('reprocess', 'request_changes', 'reject', 'uphold')),
  resolution_decision_id uuid references private.teacher_verification_decisions(id) on delete restrict,
  constraint trust_contestation_resolution check (
    (status = 'open' and resolved_at is null and resolver_id is null and resolution is null)
    or (status = 'resolved' and resolved_at is not null and resolver_id is not null
       and resolution is not null)
  )
);
alter table private.teacher_verification_contestations enable row level security;
revoke all on table private.teacher_verification_contestations from public, anon, authenticated;
create unique index teacher_verification_one_open_contestation
  on private.teacher_verification_contestations (teacher_id) where status = 'open';
create unique index teacher_verification_one_contestation_per_decision
  on private.teacher_verification_contestations (decision_id);

-- Auditoria: ações automáticas são do serviço (actor_id nulo + service_name).
alter table private.teacher_verification_audit_log
  add column service_name text check (service_name is null or service_name ~ '^[a-z][a-z0-9_.-]{2,80}$');

-- -------------------------------------------------------------------------------- enfileirar

create function private.teacher_verification_enqueue_trust_job()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'submitted'
     and (old.status is distinct from new.status or old.submitted_at is distinct from new.submitted_at) then
    insert into private.teacher_verification_jobs (teacher_id, submitted_at)
    values (new.teacher_id, new.submitted_at)
    on conflict (teacher_id, submitted_at) do nothing;
  end if;
  return new;
end;
$$;

create trigger teacher_verification_enqueue_trust_job
  after update of status, submitted_at on private.teacher_verifications
  for each row execute function private.teacher_verification_enqueue_trust_job();

-- -------------------------------------------------------------------------- notificações

create function private.teacher_verification_notify(
  p_teacher uuid, p_event text, p_template text, p_reason text, p_source uuid
) returns void language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  select p.display_name into v_name from public.profiles as p where p.id = p_teacher;
  perform private.notification_enqueue_for_user(
    p_event, p_source, p_teacher, p_template,
    case when p_reason is null then jsonb_build_object('NOME', coalesce(v_name, 'Professor(a)'))
         else jsonb_build_object('NOME', coalesce(v_name, 'Professor(a)'), 'MOTIVO', p_reason) end,
    p_event || ':' || p_source::text
  );
end;
$$;

-- Toda submissão do professor gera a notificação "credenciamento recebido".
create function private.teacher_verification_notify_received()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_job uuid;
begin
  select j.id into v_job from private.teacher_verification_jobs as j
   where j.teacher_id = new.teacher_id and j.submitted_at = new.submitted_at;
  if v_job is not null then
    perform private.teacher_verification_notify(
      new.teacher_id, 'credential.received', 'edusearch-credenciamento-recebido-v1', null, v_job
    );
  end if;
  return new;
end;
$$;

create trigger teacher_verification_notify_received
  after update of status, submitted_at on private.teacher_verifications
  for each row
  when (new.status = 'submitted'
        and (old.status is distinct from new.status or old.submitted_at is distinct from new.submitted_at))
  execute function private.teacher_verification_notify_received();

-- ------------------------------------------------------------------------- claim e falhas

create function private.teacher_verification_claim(p_limit integer, p_lease_seconds integer)
returns table (id uuid, teacher_id uuid) language plpgsql security definer set search_path = '' as $$
begin
  -- Jobs que esgotaram as tentativas viram 'failed' em vez de estourar o CHECK de attempts.
  update private.teacher_verification_jobs as j
     set status = 'failed', locked_at = null,
         error_code = coalesce(j.error_code, 'attempts_exhausted')
   where j.attempts >= 10
     and (j.status = 'pending'
       or (j.status = 'processing'
           and j.locked_at < now() - make_interval(secs => p_lease_seconds)));

  return query
  with candidates as (
    select j.id as job_id
      from private.teacher_verification_jobs as j
     where j.attempts < 10
       and ((j.status = 'pending' and j.next_attempt_at <= now())
         or (j.status = 'processing'
             and j.locked_at < now() - make_interval(secs => p_lease_seconds)))
     order by j.created_at
     for update skip locked
     limit least(greatest(p_limit, 1), 25)
  ), claimed as (
    update private.teacher_verification_jobs as j
       set status = 'processing', locked_at = now(), attempts = j.attempts + 1
      from candidates as c where j.id = c.job_id
    returning j.id as job_id, j.teacher_id as job_teacher
  ) select c.job_id, c.job_teacher from claimed as c;
end;
$$;

create function private.teacher_verification_job_failed(p_job uuid, p_error_code text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_job private.teacher_verification_jobs; v_code text := p_error_code;
begin
  select j.* into v_job from private.teacher_verification_jobs as j where j.id = p_job for update;
  if not found then return 'unknown_job'; end if;
  if v_job.status <> 'processing' then return 'already_processed'; end if;
  if v_code is null or v_code !~ '^[a-z][a-z0-9_.-]{2,80}$' then
    v_code := 'unexpected_error';
  end if;
  if v_job.attempts >= 10 then
    update private.teacher_verification_jobs as j
       set status = 'failed', locked_at = null, error_code = v_code
     where j.id = p_job;
    return 'failed';
  end if;
  update private.teacher_verification_jobs as j
     set status = 'pending', locked_at = null, error_code = v_code,
         next_attempt_at = now() + make_interval(secs => least(3600, 30 * (2 ^ v_job.attempts)))
   where j.id = p_job;
  return 'retry';
end;
$$;

-- ---------------------------------------------------------------- contexto do job (sem PII)
-- Data de nascimento e dígitos fiscais não saem do banco: o contexto traz apenas fatos derivados.

create function private.teacher_verification_job_context(p_job uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_job private.teacher_verification_jobs; v_result jsonb;
begin
  select j.* into v_job from private.teacher_verification_jobs as j where j.id = p_job;
  if not found or v_job.status <> 'processing' then return null; end if;

  select jsonb_build_object(
    'job_id', v_job.id,
    'teacher_id', v_job.teacher_id,
    'submitted_at', v_job.submitted_at,
    'dossier_current', (v.status = 'submitted' and v.submitted_at = v_job.submitted_at),
    'qualification_kind', v.qualification_kind,
    'institution_present', v.institution is not null,
    'qualification_present', v.qualification is not null,
    'experience_length', coalesce(char_length(v.professional_experience), 0),
    'curriculum_length', coalesce(char_length(v.curriculum_summary), 0),
    'is_adult', v.birth_date is not null and v.birth_date <= current_date - interval '18 years',
    'tax_id_kind', v.financial_tax_id_kind,
    'tax_id_last4_present', v.financial_tax_id_last4 is not null,
    'terms_version', v.terms_version,
    'submissions_last_7_days', (
      select count(*) from private.teacher_verification_jobs as j2
       where j2.teacher_id = v_job.teacher_id and j2.created_at > now() - interval '7 days'
    ),
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', d.document_kind, 'version', d.version, 'status', d.status,
        'inspection_status', d.inspection_status, 'inspection_code', d.inspection_code,
        'detected_content_type', d.detected_content_type, 'content_type', d.content_type,
        'size_bytes', d.size_bytes, 'signature_present', d.signature_present,
        'sha256', d.sha256,
        'duplicate_other_teachers', (
          select count(*) from private.teacher_verification_documents as o
           where d.sha256 is not null and o.sha256 = d.sha256 and o.teacher_id <> d.teacher_id
        ),
        'duplicate_own_kinds', (
          select count(*) from private.teacher_verification_documents as o
           where d.sha256 is not null and o.sha256 = d.sha256 and o.teacher_id = d.teacher_id
             and o.document_kind <> d.document_kind and o.status <> 'rejected'
        )
      ) order by d.document_kind)
      from (
        select distinct on (dd.document_kind) dd.*
          from private.teacher_verification_documents as dd
         where dd.teacher_id = v_job.teacher_id and dd.status <> 'rejected'
         order by dd.document_kind, dd.version desc
      ) as d
    ), '[]'::jsonb)
  ) into v_result
  from private.teacher_verifications as v
  where v.teacher_id = v_job.teacher_id;
  return v_result;
end;
$$;

-- --------------------------------------------------------------- registro da decisão (serviço)

create function private.teacher_verification_record_decision(
  p_job uuid, p_rules_version text, p_evidence jsonb, p_decision private.trust_decision,
  p_reasons text[]
) returns text language plpgsql security definer set search_path = '' as $$
declare
  v_job private.teacher_verification_jobs;
  v_missing integer;
  v_to private.teacher_credential_status;
  v_reason text := coalesce(p_reasons[1], 'verification.no_reason');
  v_decision uuid;
  v_item jsonb;
begin
  select j.* into v_job from private.teacher_verification_jobs as j where j.id = p_job for update;
  if not found then return 'unknown_job'; end if;
  if v_job.status <> 'processing' then return 'already_processed'; end if;
  if not exists (select 1 from private.trust_rule_requirements as r where r.rules_version = p_rules_version) then
    raise exception using errcode = '22023', message = 'trust_rules_version_unknown';
  end if;
  if p_decision not in ('approved', 'changes_requested', 'pending_external', 'manual_review') then
    -- Rejeição é sempre humana; 'upheld' só existe na revisão de contestação.
    raise exception using errcode = '22023', message = 'trust_decision_not_automatable';
  end if;
  if jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) > 50 then
    raise exception using errcode = '22023', message = 'trust_evidence_invalid';
  end if;

  -- A submissão que gerou o job precisa continuar vigente; senão nada é alterado.
  perform 1 from private.teacher_verifications as v
    where v.teacher_id = v_job.teacher_id and v.status = 'submitted'
      and v.submitted_at = v_job.submitted_at
    for update;
  if not found then
    update private.teacher_verification_jobs as j set status = 'completed', completed_at = now(),
      locked_at = null, error_code = 'submission_superseded' where j.id = p_job;
    return 'superseded';
  end if;

  for v_item in select e.value from jsonb_array_elements(p_evidence) as e loop
    insert into private.teacher_verification_evidence (
      job_id, validator, requirement, mandatory, result, source, reason_code, details, observed_at
    ) values (
      p_job, v_item ->> 'validator', v_item ->> 'requirement',
      exists (
        select 1 from private.trust_rule_requirements as r
         where r.rules_version = p_rules_version and r.requirement = v_item ->> 'requirement'
      ),
      (v_item ->> 'result')::private.trust_evidence_result,
      (v_item ->> 'source')::private.trust_evidence_source,
      v_item ->> 'reason_code', coalesce(v_item -> 'details', '{}'::jsonb),
      (v_item ->> 'observed_at')::timestamptz
    ) on conflict (job_id, requirement) do nothing;
  end loop;

  -- Defesa em profundidade: recalcula os obrigatórios a partir das regras persistidas.
  select count(*) into v_missing
    from private.trust_rule_requirements as r
   where r.rules_version = p_rules_version
     and not exists (
       select 1 from private.teacher_verification_evidence as e
        where e.job_id = p_job and e.requirement = r.requirement
          and e.result = 'passed' and e.source = any(r.allowed_sources)
     );
  if p_decision = 'approved' and v_missing > 0 then
    raise exception using errcode = 'P0001', message = 'trust_approval_requirements_unmet';
  end if;

  if p_decision = 'approved' then
    v_to := 'approved';
    update private.teacher_verifications as v
       set status = 'approved', reviewed_at = now(), reviewer_id = null,
           review_reason = 'verification.approved_automatically'
     where v.teacher_id = v_job.teacher_id;
    update private.teacher_verification_documents as d
       set status = 'accepted', reviewed_at = now(), reviewed_by_service = 'trust_engine'
     where d.teacher_id = v_job.teacher_id and d.status = 'quarantined'
       and d.inspection_status = 'passed';
    update public.teacher_profiles as tp
       set verification_status = 'approved', verified_at = now(),
           is_published = true, published_at = now()
     where tp.user_id = v_job.teacher_id;
  elsif p_decision = 'changes_requested' then
    v_to := 'changes_requested';
    update private.teacher_verifications as v
       set status = 'changes_requested', submitted_at = null, review_reason = v_reason
     where v.teacher_id = v_job.teacher_id;
    update private.teacher_verification_documents as d
       set status = 'rejected', reviewed_at = now(), reviewed_by_service = 'trust_engine',
           review_reason = coalesce(d.inspection_code, 'document.inspection_failed')
     where d.teacher_id = v_job.teacher_id and d.status = 'quarantined'
       and d.inspection_status = 'failed';
  elsif p_decision = 'pending_external' then
    v_to := 'pending_external';
    update private.teacher_verifications as v
       set status = 'pending_external', review_reason = v_reason
     where v.teacher_id = v_job.teacher_id;
  else
    v_to := 'under_review';
    update private.teacher_verifications as v
       set status = 'under_review', review_reason = v_reason
     where v.teacher_id = v_job.teacher_id;
  end if;
  if v_to <> 'approved' then
    update public.teacher_profiles as tp
       set verification_status = 'pending', verified_at = null,
           is_published = false, published_at = null
     where tp.user_id = v_job.teacher_id;
  end if;

  insert into private.teacher_verification_decisions (
    job_id, teacher_id, decision, rules_version, reasons, actor_kind, service_name
  ) values (
    p_job, v_job.teacher_id, p_decision, p_rules_version, coalesce(p_reasons, '{}'),
    'service', 'trust_engine'
  ) returning id into v_decision;
  insert into private.teacher_verification_audit_log (
    teacher_id, action, from_status, to_status, detail, service_name
  ) values (
    v_job.teacher_id, 'trust.decision_recorded', 'submitted', v_to,
    p_decision::text || ':' || v_reason, 'trust_engine'
  );
  update private.teacher_verification_jobs as j set status = 'completed', completed_at = now(),
    locked_at = null, error_code = null, rules_version = p_rules_version where j.id = p_job;

  if p_decision = 'approved' then
    perform private.teacher_verification_notify(v_job.teacher_id, 'credential.approved',
      'edusearch-credenciamento-aprovado-v1', null, v_decision);
  elsif p_decision = 'changes_requested' then
    perform private.teacher_verification_notify(v_job.teacher_id, 'credential.changes_requested',
      'edusearch-credenciamento-correcao-v1', v_reason, v_decision);
  end if;
  return v_to::text;
end;
$$;

-- ---------------------------------------------------------------- registro de documento (v2)
-- A API inspeciona o conteúdo real do objeto (assinatura binária, tamanho, SHA-256) com o token do
-- próprio titular e só então registra. Sem inspeção (p_sha256 nulo), o documento fica pendente e
-- nunca satisfaz o requisito documental.

drop function private.teacher_verification_register_document(private.teacher_document_kind, text);

create function private.teacher_verification_register_document(
  p_document_kind private.teacher_document_kind,
  p_storage_path text,
  p_sha256 text,
  p_detected_content_type text,
  p_inspected_size bigint,
  p_signature_present boolean
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
  -- Trava o dossiê: registro de documento e submissão são serializados por professor.
  perform 1 from private.teacher_verifications as v
   where v.teacher_id = v_teacher and v.status in ('draft', 'changes_requested')
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'verification_dossier_required';
  end if;
  if p_storage_path !~ ('^' || v_teacher::text || '/[0-9a-f-]{36}\.(pdf|png|jpe?g)$') then
    raise exception using errcode = '22023', message = 'invalid_document_path';
  end if;
  select o.* into v_object from storage.objects as o
   where o.bucket_id = 'teacher-verification' and o.name = p_storage_path
     and o.owner_id = v_teacher::text;
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
  if p_sha256 is not null then
    -- O conteúdo inspecionado precisa corresponder ao objeto e ao tipo declarado.
    if p_sha256 !~ '^[0-9a-f]{64}$' or p_inspected_size is distinct from v_size
       or p_detected_content_type is distinct from v_content_type then
      raise exception using errcode = '22023', message = 'document_content_mismatch';
    end if;
    if exists (
      select 1 from private.teacher_verification_documents as d
       where d.teacher_id = v_teacher and d.sha256 = p_sha256 and d.status <> 'rejected'
    ) then
      raise exception using errcode = 'P0001', message = 'document_already_registered';
    end if;
  end if;
  select coalesce(max(d.version), 0)::smallint + 1 into v_version
    from private.teacher_verification_documents as d
   where d.teacher_id = v_teacher and d.document_kind = p_document_kind;
  insert into private.teacher_verification_documents (
    teacher_id, document_kind, storage_path, content_type, size_bytes, version,
    sha256, detected_content_type, inspection_status, inspection_code, signature_present, inspected_at
  ) values (
    v_teacher, p_document_kind, p_storage_path, v_content_type, v_size, v_version,
    p_sha256, case when p_sha256 is null then null else p_detected_content_type end,
    case when p_sha256 is null then 'pending' else 'passed' end,
    case when p_sha256 is null then 'inspection.unavailable' else 'inspection.content_verified' end,
    coalesce(p_signature_present, false) and p_sha256 is not null,
    case when p_sha256 is null then null else now() end
  )
  on conflict (storage_path) do nothing;
  if not found then
    raise exception using errcode = 'P0001', message = 'document_already_registered';
  end if;
  insert into private.teacher_verification_audit_log (teacher_id, actor_id, action, to_status, detail)
  select v_teacher, v_teacher, 'teacher.document_registered', v.status, p_document_kind::text
    from private.teacher_verifications as v where v.teacher_id = v_teacher;
  return query select d.document_kind, d.version, d.status, d.uploaded_at
    from private.teacher_verification_documents as d where d.storage_path = p_storage_path;
end;
$$;

-- --------------------------------------------------------------------- visão do professor

create function private.teacher_verification_progress()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_teacher uuid := private.teacher_verification_require_teacher(); v_result jsonb;
begin
  select jsonb_build_object(
    'status', v.status,
    'review_reason', v.review_reason,
    'submitted_at', v.submitted_at,
    'decision', (
      select jsonb_build_object('id', dc.id, 'decision', dc.decision, 'reasons', dc.reasons,
        'actor_kind', dc.actor_kind, 'rules_version', dc.rules_version, 'decided_at', dc.decided_at,
        'contestable', dc.decision in ('changes_requested', 'pending_external', 'manual_review', 'rejected')
          and not exists (select 1 from private.teacher_verification_contestations as c2
                           where c2.decision_id = dc.id))
        from private.teacher_verification_decisions as dc
       where dc.teacher_id = v_teacher order by dc.decided_at desc limit 1
    ),
    'evidence', coalesce((
      select jsonb_agg(jsonb_build_object(
        'validator', e.validator, 'requirement', e.requirement, 'mandatory', e.mandatory,
        'result', e.result, 'source', e.source, 'reason_code', e.reason_code,
        'observed_at', e.observed_at) order by e.mandatory desc, e.requirement)
        from private.teacher_verification_evidence as e
       where e.job_id = (
         select j.id from private.teacher_verification_jobs as j
          where j.teacher_id = v_teacher and j.status = 'completed'
          order by j.created_at desc limit 1)
    ), '[]'::jsonb),
    'processing', exists (
      select 1 from private.teacher_verification_jobs as j
       where j.teacher_id = v_teacher and j.status in ('pending', 'processing')
    ),
    'contestation', (
      select jsonb_build_object('status', c.status, 'created_at', c.created_at,
        'resolution', c.resolution, 'resolved_at', c.resolved_at)
        from private.teacher_verification_contestations as c
       where c.teacher_id = v_teacher order by c.created_at desc limit 1
    ),
    'documents', coalesce((
      select jsonb_agg(jsonb_build_object('kind', d.document_kind, 'version', d.version,
        'status', d.status, 'inspection_status', d.inspection_status,
        'inspection_code', d.inspection_code, 'review_reason', d.review_reason,
        'uploaded_at', d.uploaded_at) order by d.document_kind, d.version)
        from private.teacher_verification_documents as d where d.teacher_id = v_teacher
    ), '[]'::jsonb)
  ) into v_result
  from private.teacher_verifications as v where v.teacher_id = v_teacher;
  return v_result;
end;
$$;

-- ------------------------------------------------------------------------- contestação

create function private.teacher_verification_contest(p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_teacher uuid := private.teacher_verification_require_teacher();
  v_status private.teacher_credential_status;
  v_decision uuid;
  v_contestation uuid;
begin
  if p_reason is null or char_length(btrim(p_reason)) not between 20 and 2000 then
    raise exception using errcode = '22023', message = 'contestation_reason_invalid';
  end if;
  select v.status into v_status from private.teacher_verifications as v
   where v.teacher_id = v_teacher for update;
  if not found or v_status not in ('changes_requested', 'pending_external', 'under_review', 'rejected') then
    raise exception using errcode = 'P0001', message = 'contestation_not_allowed';
  end if;
  select dc.id into v_decision from private.teacher_verification_decisions as dc
   where dc.teacher_id = v_teacher
     and dc.decision in ('changes_requested', 'pending_external', 'manual_review', 'rejected')
     and dc.decided_at = (select max(d2.decided_at) from private.teacher_verification_decisions as d2
                           where d2.teacher_id = v_teacher)
   limit 1;
  if v_decision is null
     or exists (select 1 from private.teacher_verification_contestations as c
                 where c.teacher_id = v_teacher and (c.status = 'open' or c.decision_id = v_decision)) then
    raise exception using errcode = 'P0001', message = 'contestation_not_allowed';
  end if;
  insert into private.teacher_verification_contestations (teacher_id, decision_id, reason)
  values (v_teacher, v_decision, btrim(p_reason)) returning id into v_contestation;
  update private.teacher_verifications as v
     set status = 'under_review', submitted_at = coalesce(v.submitted_at, now()),
         review_reason = 'verification.contestation_open'
   where v.teacher_id = v_teacher;
  update public.teacher_profiles as tp
     set verification_status = 'pending', verified_at = null, is_published = false, published_at = null
   where tp.user_id = v_teacher;
  insert into private.teacher_verification_audit_log (teacher_id, actor_id, action, from_status, to_status)
  values (v_teacher, v_teacher, 'teacher.decision_contested', v_status, 'under_review');
  perform private.teacher_verification_notify(v_teacher, 'credential.contest_received',
    'edusearch-credenciamento-contestacao-v1', null, v_contestation);
  return jsonb_build_object('id', v_contestation, 'status', 'open');
end;
$$;

-- -------------------------------------------------------------- Admin: monitoramento e revisão
-- Reutiliza o RBAC da PR #36: leitura exige teachers.read; revisão exige teachers.reject.
-- Nenhuma ação humana aprova: aprovação continua exclusiva do Trust Engine com evidência suficiente.

create function private.admin_trust_overview(p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.admin_has_permission(p_actor, 'teachers.read') then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'counts', jsonb_build_object(
      'processing', (select count(*) from private.teacher_verification_jobs as j where j.status in ('pending', 'processing')),
      'failed_jobs', (select count(*) from private.teacher_verification_jobs as j where j.status = 'failed'),
      'pending_external', (select count(*) from private.teacher_verifications as v where v.status = 'pending_external'),
      'under_review', (select count(*) from private.teacher_verifications as v where v.status = 'under_review'),
      'auto_approved', (select count(*) from private.teacher_verification_decisions as dc
                         where dc.decision = 'approved' and dc.actor_kind = 'service'),
      'pending_documents', (select count(*) from private.teacher_verification_documents as d
                             where d.status = 'quarantined'),
      'open_contestations', (select count(*) from private.teacher_verification_contestations as c where c.status = 'open'),
      'legacy_unpublished', (select count(*) from private.teacher_credential_legacy_review)
    ),
    'jobs', coalesce((select jsonb_agg(x order by x ->> 'created_at' desc) from (
      select jsonb_build_object('id', j.id, 'teacher_id', j.teacher_id, 'teacher_name', p.display_name,
        'status', j.status, 'attempts', j.attempts, 'error_code', j.error_code,
        'created_at', j.created_at, 'completed_at', j.completed_at) as x
        from private.teacher_verification_jobs as j join public.profiles as p on p.id = j.teacher_id
       where j.status in ('pending', 'processing', 'failed')
       order by j.created_at desc limit 50) as q), '[]'::jsonb),
    'decisions', coalesce((select jsonb_agg(x order by x ->> 'decided_at' desc) from (
      select jsonb_build_object('id', dc.id, 'teacher_id', dc.teacher_id, 'teacher_name', p.display_name,
        'decision', dc.decision, 'reasons', dc.reasons, 'actor_kind', dc.actor_kind,
        'rules_version', dc.rules_version, 'decided_at', dc.decided_at) as x
        from private.teacher_verification_decisions as dc join public.profiles as p on p.id = dc.teacher_id
       order by dc.decided_at desc limit 50) as q), '[]'::jsonb),
    'contestations', coalesce((select jsonb_agg(x order by x ->> 'created_at' desc) from (
      select jsonb_build_object('id', c.id, 'teacher_id', c.teacher_id, 'teacher_name', p.display_name,
        'status', c.status, 'reason', c.reason, 'resolution', c.resolution,
        'created_at', c.created_at, 'resolved_at', c.resolved_at) as x
        from private.teacher_verification_contestations as c join public.profiles as p on p.id = c.teacher_id
       order by (c.status = 'open') desc, c.created_at desc limit 50) as q), '[]'::jsonb),
    'validator_failures', coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('validator', e.validator, 'requirement', e.requirement,
        'result', e.result, 'reason_code', e.reason_code, 'occurrences', count(*)) as x
        from private.teacher_verification_evidence as e
       where e.result in ('failed', 'unavailable') and e.recorded_at > now() - interval '30 days'
       group by e.validator, e.requirement, e.result, e.reason_code
       order by count(*) desc limit 30) as q), '[]'::jsonb)
  );
end;
$$;

create function private.admin_trust_teacher(p_actor uuid, p_teacher uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not private.admin_has_permission(p_actor, 'teachers.read') then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;
  -- Sem data de nascimento, dígitos fiscais, caminho de storage ou hash completo.
  select jsonb_build_object(
    'teacher_id', v.teacher_id, 'teacher_name', p.display_name, 'status', v.status,
    'qualification_kind', v.qualification_kind, 'institution', v.institution,
    'qualification', v.qualification, 'submitted_at', v.submitted_at,
    'review_reason', v.review_reason,
    'documents', coalesce((select jsonb_agg(jsonb_build_object('kind', d.document_kind,
        'version', d.version, 'status', d.status, 'inspection_status', d.inspection_status,
        'inspection_code', d.inspection_code, 'detected_content_type', d.detected_content_type,
        'size_bytes', d.size_bytes, 'signature_present', d.signature_present,
        'sha256_prefix', left(d.sha256, 12), 'reviewed_by_service', d.reviewed_by_service,
        'uploaded_at', d.uploaded_at) order by d.document_kind, d.version)
      from private.teacher_verification_documents as d where d.teacher_id = v.teacher_id), '[]'::jsonb),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'status', j.status,
        'attempts', j.attempts, 'error_code', j.error_code, 'rules_version', j.rules_version,
        'created_at', j.created_at, 'completed_at', j.completed_at,
        'evidence', coalesce((select jsonb_agg(jsonb_build_object('validator', e.validator,
            'requirement', e.requirement, 'mandatory', e.mandatory, 'result', e.result,
            'source', e.source, 'reason_code', e.reason_code, 'details', e.details,
            'observed_at', e.observed_at) order by e.requirement)
          from private.teacher_verification_evidence as e where e.job_id = j.id), '[]'::jsonb))
        order by j.created_at desc)
      from private.teacher_verification_jobs as j where j.teacher_id = v.teacher_id), '[]'::jsonb),
    'decisions', coalesce((select jsonb_agg(jsonb_build_object('id', dc.id, 'decision', dc.decision,
        'reasons', dc.reasons, 'actor_kind', dc.actor_kind, 'service_name', dc.service_name,
        'actor_id', dc.actor_id, 'justification', dc.justification,
        'rules_version', dc.rules_version, 'decided_at', dc.decided_at) order by dc.decided_at desc)
      from private.teacher_verification_decisions as dc where dc.teacher_id = v.teacher_id), '[]'::jsonb),
    'contestations', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'status', c.status,
        'reason', c.reason, 'resolution', c.resolution, 'created_at', c.created_at,
        'resolved_at', c.resolved_at) order by c.created_at desc)
      from private.teacher_verification_contestations as c where c.teacher_id = v.teacher_id), '[]'::jsonb)
  ) into v_result
  from private.teacher_verifications as v join public.profiles as p on p.id = v.teacher_id
  where v.teacher_id = p_teacher;
  if v_result is null then raise exception 'teacher_not_found' using errcode = 'P0002'; end if;
  perform private.admin_audit(p_actor, 'trust.dossier_viewed', 'teacher', p_teacher, null,
    null, null, 'success', null);
  return v_result;
end;
$$;

-- Revisão humana de contestação. Resoluções possíveis: reprocessar com o motor, pedir correção,
-- não aprovar (rejeitar) ou manter a decisão. Aprovar NÃO é uma opção humana.
create function private.admin_trust_resolve_contestation(
  p_actor uuid, p_contestation uuid, p_resolution text, p_justification text, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_contest private.teacher_verification_contestations;
  v_prev private.trust_decision;
  v_decision uuid;
  v_to private.teacher_credential_status;
begin
  if not private.admin_has_permission(p_actor, 'teachers.reject') then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;
  if p_justification is null or char_length(btrim(p_justification)) not between 3 and 500 then
    raise exception 'admin_justification_required' using errcode = '22023';
  end if;
  if p_resolution not in ('reprocess', 'request_changes', 'reject', 'uphold') then
    raise exception 'trust_resolution_invalid' using errcode = '22023';
  end if;
  select c.* into v_contest from private.teacher_verification_contestations as c
   where c.id = p_contestation for update;
  if not found then raise exception 'contestation_not_found' using errcode = 'P0002'; end if;
  if v_contest.status <> 'open' then raise exception 'contestation_already_resolved' using errcode = '22023'; end if;
  perform 1 from private.teacher_verifications as v where v.teacher_id = v_contest.teacher_id for update;
  select dc.decision into v_prev from private.teacher_verification_decisions as dc where dc.id = v_contest.decision_id;

  if p_resolution = 'reprocess' then
    v_to := 'submitted';
    update private.teacher_verifications as v
       set status = 'submitted', submitted_at = now(), review_reason = 'verification.reprocess_requested'
     where v.teacher_id = v_contest.teacher_id;
  elsif p_resolution = 'request_changes' then
    v_to := 'changes_requested';
    update private.teacher_verifications as v
       set status = 'changes_requested', submitted_at = null,
           review_reason = 'verification.changes_requested_by_review'
     where v.teacher_id = v_contest.teacher_id;
  elsif p_resolution = 'reject' then
    v_to := 'rejected';
    update private.teacher_verifications as v
       set status = 'rejected', reviewed_at = now(), reviewer_id = p_actor,
           review_reason = 'verification.rejected_after_review'
     where v.teacher_id = v_contest.teacher_id;
    update public.teacher_profiles as tp
       set verification_status = 'rejected', verified_at = null, is_published = false, published_at = null
     where tp.user_id = v_contest.teacher_id;
  else
    v_to := case v_prev when 'changes_requested' then 'changes_requested'
                        when 'pending_external' then 'pending_external'
                        when 'rejected' then 'rejected'
                        else 'under_review' end;
    update private.teacher_verifications as v
       set status = v_to,
           submitted_at = case when v_to = 'changes_requested' then null else v.submitted_at end,
           review_reason = 'verification.decision_upheld'
     where v.teacher_id = v_contest.teacher_id;
  end if;

  if p_resolution <> 'reprocess' then
    insert into private.teacher_verification_decisions (
      teacher_id, decision, reasons, actor_kind, actor_id, justification
    ) values (
      v_contest.teacher_id,
      case p_resolution when 'request_changes' then 'changes_requested'::private.trust_decision
                        when 'reject' then 'rejected'::private.trust_decision
                        else 'upheld'::private.trust_decision end,
      array['verification.human_review'], 'human', p_actor, btrim(p_justification)
    ) returning id into v_decision;
  end if;
  update private.teacher_verification_contestations as c
     set status = 'resolved', resolved_at = now(), resolver_id = p_actor,
         resolution = p_resolution, resolution_decision_id = v_decision
   where c.id = p_contestation;
  insert into private.teacher_verification_audit_log (teacher_id, actor_id, action, from_status, to_status, detail)
  values (v_contest.teacher_id, p_actor, 'admin.contestation_resolved', 'under_review', v_to, p_resolution);
  perform private.admin_audit(p_actor, 'trust.contestation_resolved', 'teacher', v_contest.teacher_id,
    btrim(p_justification), jsonb_build_object('status', 'under_review'),
    jsonb_build_object('status', v_to, 'resolution', p_resolution), 'success', p_request_id);
  if p_resolution = 'reject' then
    perform private.teacher_verification_notify(v_contest.teacher_id, 'credential.rejected',
      'edusearch-credenciamento-nao-aprovado-v1', 'verification.rejected_after_review', v_decision);
  elsif p_resolution = 'request_changes' then
    perform private.teacher_verification_notify(v_contest.teacher_id, 'credential.changes_requested',
      'edusearch-credenciamento-correcao-v1', 'verification.changes_requested_by_review', v_decision);
  end if;
  return jsonb_build_object('status', v_to, 'resolution', p_resolution);
end;
$$;

-- Reprocessa um dossiê cujo job falhou ou que aguarda fonte externa (ex.: provedor recém-integrado).
create function private.admin_trust_reprocess(
  p_actor uuid, p_teacher uuid, p_justification text, p_request_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_status private.teacher_credential_status;
begin
  if not private.admin_has_permission(p_actor, 'teachers.reject') then
    raise exception 'admin_forbidden' using errcode = '42501';
  end if;
  if p_justification is null or char_length(btrim(p_justification)) not between 3 and 500 then
    raise exception 'admin_justification_required' using errcode = '22023';
  end if;
  select v.status into v_status from private.teacher_verifications as v
   where v.teacher_id = p_teacher for update;
  if not found then raise exception 'teacher_not_found' using errcode = 'P0002'; end if;
  if not (v_status = 'pending_external'
          or (v_status = 'submitted' and not exists (
                select 1 from private.teacher_verification_jobs as j
                 where j.teacher_id = p_teacher and j.status in ('pending', 'processing')))) then
    raise exception 'trust_reprocess_not_allowed' using errcode = '22023';
  end if;
  update private.teacher_verifications as v
     set status = 'submitted', submitted_at = now(), review_reason = 'verification.reprocess_requested'
   where v.teacher_id = p_teacher;
  insert into private.teacher_verification_audit_log (teacher_id, actor_id, action, from_status, to_status)
  values (p_teacher, p_actor, 'admin.reprocess_requested', v_status, 'submitted');
  perform private.admin_audit(p_actor, 'trust.reprocess_requested', 'teacher', p_teacher,
    btrim(p_justification), jsonb_build_object('status', v_status),
    jsonb_build_object('status', 'submitted'), 'success', p_request_id);
  return jsonb_build_object('status', 'submitted');
end;
$$;

-- ---------------------------------------------------------------------------------- grants

revoke all on function
  private.teacher_verification_enqueue_trust_job(),
  private.teacher_verification_notify(uuid, text, text, text, uuid),
  private.teacher_verification_notify_received(),
  private.teacher_verification_claim(integer, integer),
  private.teacher_verification_job_failed(uuid, text),
  private.teacher_verification_job_context(uuid),
  private.teacher_verification_record_decision(uuid, text, jsonb, private.trust_decision, text[]),
  private.teacher_verification_register_document(private.teacher_document_kind, text, text, text, bigint, boolean),
  private.teacher_verification_progress(),
  private.teacher_verification_contest(text),
  private.admin_trust_overview(uuid),
  private.admin_trust_teacher(uuid, uuid),
  private.admin_trust_resolve_contestation(uuid, uuid, text, text, uuid),
  private.admin_trust_reprocess(uuid, uuid, text, uuid)
from public, anon, authenticated;

grant execute on function
  private.teacher_verification_claim(integer, integer),
  private.teacher_verification_job_failed(uuid, text),
  private.teacher_verification_job_context(uuid),
  private.teacher_verification_record_decision(uuid, text, jsonb, private.trust_decision, text[]),
  private.teacher_verification_register_document(private.teacher_document_kind, text, text, text, bigint, boolean),
  private.teacher_verification_progress(),
  private.teacher_verification_contest(text),
  private.admin_trust_overview(uuid),
  private.admin_trust_teacher(uuid, uuid),
  private.admin_trust_resolve_contestation(uuid, uuid, text, text, uuid),
  private.admin_trust_reprocess(uuid, uuid, text, uuid)
to edusearch_api;

comment on table private.teacher_verification_jobs is
  'Fila do Trust Engine (uma linha por submissão), com lease, retry e versão de regras.';
comment on table private.teacher_verification_decisions is
  'Histórico de decisões. Serviço nunca rejeita; humano nunca aprova. Aprovação exige regras atendidas.';
