-- EduSearch — Fase 2.6A: privilégios e políticas RLS.
--
-- Modelo (detalhes em docs/database-design.md, seção "Segurança"):
-- * No Supabase, tabela nova em public nasce com TODOS os privilégios para anon/authenticated.
--   Aqui começamos do zero (revoke all) e concedemos só o necessário, por coluna quando o
--   usuário não pode tocar em campos definidos pelo servidor.
-- * anon (visitante sem login) só lê o catálogo de disciplinas. Nada com dado pessoal.
-- * authenticated só lê/edita as PRÓPRIAS linhas; perfis de professor aprovados E publicados
--   são legíveis por usuários autenticados.
-- * Nenhuma política usa user_metadata/raw_user_meta_data. Papéis vêm de public.account_roles,
--   que o usuário não consegue gravar.
-- * auth.uid() é envolvido em (select ...) para ser avaliado uma vez por consulta
--   (lint 0003_auth_rls_initplan).

-- ---------------------------------------------------------------------------------------------
-- Ponto de partida: nenhum acesso pela Data API
-- ---------------------------------------------------------------------------------------------
revoke all on table
  public.profiles,
  public.account_roles,
  public.subjects,
  public.student_profiles,
  public.teacher_profiles,
  public.teacher_subjects
from public, anon, authenticated;

-- (RLS já foi ligado na migration anterior; repetido aqui para deixar a garantia explícita.)
alter table public.profiles         enable row level security;
alter table public.account_roles    enable row level security;
alter table public.subjects         enable row level security;
alter table public.student_profiles enable row level security;
alter table public.teacher_profiles enable row level security;
alter table public.teacher_subjects enable row level security;

-- ---------------------------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------------------------
grant select on public.profiles to authenticated;
-- Somente campos de apresentação. id, status e timestamps são do servidor.
grant update (display_name, avatar_url) on public.profiles to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
-- Sem INSERT/DELETE: o perfil nasce pelo trigger em auth.users e morre com ele (cascade).

-- ---------------------------------------------------------------------------------------------
-- account_roles (somente leitura para o usuário)
-- ---------------------------------------------------------------------------------------------
grant select on public.account_roles to authenticated;

create policy account_roles_select_own on public.account_roles
  for select to authenticated
  using (user_id = (select auth.uid()));
-- Sem INSERT/UPDATE/DELETE para anon/authenticated: papéis são atribuídos pelo servidor.

-- ---------------------------------------------------------------------------------------------
-- subjects (catálogo público)
-- ---------------------------------------------------------------------------------------------
grant select on public.subjects to anon, authenticated;

create policy subjects_select_active on public.subjects
  for select to anon, authenticated
  using (is_active);

-- ---------------------------------------------------------------------------------------------
-- student_profiles (privado do aluno)
-- ---------------------------------------------------------------------------------------------
grant select on public.student_profiles to authenticated;
grant insert (
  user_id, learning_goal, education_level, difficulties, preferred_weekdays,
  preferred_periods, preferred_modality, budget_min_cents, budget_max_cents
) on public.student_profiles to authenticated;
grant update (
  learning_goal, education_level, difficulties, preferred_weekdays,
  preferred_periods, preferred_modality, budget_min_cents, budget_max_cents
) on public.student_profiles to authenticated;

create policy student_profiles_select_own on public.student_profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy student_profiles_insert_own on public.student_profiles
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.account_roles r
      where r.user_id = (select auth.uid()) and r.role = 'student'
    )
  );

create policy student_profiles_update_own on public.student_profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.account_roles r
      where r.user_id = (select auth.uid()) and r.role = 'student'
    )
  );

-- ---------------------------------------------------------------------------------------------
-- teacher_profiles
-- ---------------------------------------------------------------------------------------------
grant select on public.teacher_profiles to authenticated;
-- verification_status, verified_at, is_published e published_at ficam de fora: só o servidor.
grant insert (
  user_id, headline, bio, academic_background, experience, methodology,
  price_cents, lesson_duration_minutes, modality
) on public.teacher_profiles to authenticated;
grant update (
  headline, bio, academic_background, experience, methodology,
  price_cents, lesson_duration_minutes, modality
) on public.teacher_profiles to authenticated;

-- Uma política só (evita lint 0006 de políticas permissivas múltiplas).
create policy teacher_profiles_select_own_or_published on public.teacher_profiles
  for select to authenticated
  using (user_id = (select auth.uid()) or is_published);

create policy teacher_profiles_insert_own on public.teacher_profiles
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.account_roles r
      where r.user_id = (select auth.uid()) and r.role = 'teacher'
    )
  );

create policy teacher_profiles_update_own on public.teacher_profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.account_roles r
      where r.user_id = (select auth.uid()) and r.role = 'teacher'
    )
  );

-- ---------------------------------------------------------------------------------------------
-- teacher_subjects
-- ---------------------------------------------------------------------------------------------
grant select, delete on public.teacher_subjects to authenticated;
grant insert (teacher_id, subject_id, levels) on public.teacher_subjects to authenticated;
grant update (levels) on public.teacher_subjects to authenticated;

create policy teacher_subjects_select_own_or_published on public.teacher_subjects
  for select to authenticated
  using (
    teacher_id = (select auth.uid())
    or exists (
      select 1 from public.teacher_profiles t
      where t.user_id = teacher_subjects.teacher_id and t.is_published
    )
  );

-- O professor precisa existir em teacher_profiles (FK), e só o próprio dono passa no RLS dela.
create policy teacher_subjects_insert_own on public.teacher_subjects
  for insert to authenticated
  with check (teacher_id = (select auth.uid()));

create policy teacher_subjects_update_own on public.teacher_subjects
  for update to authenticated
  using (teacher_id = (select auth.uid()))
  with check (teacher_id = (select auth.uid()));

create policy teacher_subjects_delete_own on public.teacher_subjects
  for delete to authenticated
  using (teacher_id = (select auth.uid()));
