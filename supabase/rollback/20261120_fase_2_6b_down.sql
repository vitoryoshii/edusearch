-- ROLLBACK da Fase 2.6B. NÃO é uma migration (fica fora de supabase/migrations).
--
-- Desfaz SOMENTE o que a 2.6B adicionou; o schema da 2.6A permanece.
-- ATENÇÃO: apaga as respostas guardadas nas colunas novas (dificuldades, especialidades,
-- métodos, várias durações, dias e períodos do professor) e as disciplinas dos alunos.
-- Use só com aprovação explícita, após backup (docs/database-design.md → "Rollback").
--
-- Antes: desligue a API (ou troque API_DATABASE_URL), pois o papel edusearch_api é removido.

begin;

-- 20261120015729_api_connection_role.sql
drop policy if exists account_roles_insert_via_api on public.account_roles;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'edusearch_api') then
    revoke insert (user_id, role) on public.account_roles from edusearch_api;
    revoke usage on schema public from edusearch_api;
    revoke anon from edusearch_api;
    revoke authenticated from edusearch_api;
    drop role edusearch_api;
  end if;
end
$$;

-- 20261120015728_onboarding_profile_fields.sql
drop table if exists public.student_subjects;

alter table public.teacher_profiles
  drop column if exists available_periods,
  drop column if exists available_weekdays,
  drop column if exists lesson_durations_minutes,
  drop column if exists teaching_methods,
  drop column if exists specialties;

alter table public.student_profiles
  drop column if exists difficulty_areas;

drop type if exists public.teaching_method;
drop type if exists public.learning_difficulty;

comment on column public.student_profiles.difficulties is null;
comment on column public.teacher_profiles.methodology is null;
comment on column public.teacher_profiles.lesson_duration_minutes is null;

delete from supabase_migrations.schema_migrations
 where version in ('20261120015728', '20261120015729');

commit;
