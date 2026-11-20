-- ROLLBACK da Fase 2.6A. NÃO é uma migration (fica fora de supabase/migrations).
--
-- ATENÇÃO: apaga as tabelas de perfis e TODOS os dados nelas (perfis, papéis, dados de alunos e
-- professores, allowlist). As contas em auth.users NÃO são apagadas.
-- Use só com aprovação explícita, após backup (docs/database-design.md → "Rollback").
--
-- Não reverte o endurecimento de public.rls_auto_enable() (revogar EXECUTE de anon/authenticated
-- não tem efeito colateral). Se for mesmo necessário, restaure os privilégios anotados no backup.
--
-- Depois de executar, remova os registros das versões em supabase_migrations.schema_migrations
-- (bloco no final), para que o histórico do CLI fique coerente.

begin;

drop trigger if exists on_auth_user_created on auth.users;

drop function if exists public.hook_before_user_created(jsonb);
drop table if exists private.signup_allowlist;

drop table if exists public.teacher_subjects;
drop table if exists public.teacher_profiles;
drop table if exists public.student_profiles;
drop table if exists public.account_roles;
drop table if exists public.subjects;
drop table if exists public.profiles;

drop function if exists private.handle_new_auth_user();
drop function if exists private.display_name_from_auth(jsonb, text);
drop function if exists private.set_updated_at();

drop type if exists public.experience_range;
drop type if exists public.day_period;
drop type if exists public.weekday;
drop type if exists public.education_level;
drop type if exists public.lesson_modality;
drop type if exists public.teacher_verification_status;
drop type if exists public.profile_status;
drop type if exists public.account_role;

-- Só remove o schema se estiver vazio (não usa CASCADE).
drop schema if exists private;

delete from supabase_migrations.schema_migrations
 where version in ('20261119120000', '20261119120100', '20261119120200', '20261119120300');

commit;
