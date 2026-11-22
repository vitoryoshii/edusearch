-- ROLLBACK da Fase 3A. NÃO é uma migration (fica fora de supabase/migrations).
--
-- Desfaz SOMENTE o que a 3A adicionou; o schema da 2.6A/2.6B permanece.
-- ATENÇÃO: apaga as aulas de teste, a disponibilidade dos professores e as credenciais (cifradas)
-- do Google Agenda. Os eventos já criados na Google Agenda dos professores NÃO são removidos.
-- Use só com aprovação explícita, após backup (docs/database-design.md → "Rollback").
--
-- Antes: API_SCHEDULING_STAGE=off na API e VITE_STAGE_SCHEDULING=off no app.

begin;

drop function if exists private.teacher_busy_ranges(uuid, timestamptz, timestamptz);
drop table if exists private.google_calendar_credentials;

-- Perfis: volta à política original (só o próprio).
drop policy if exists profiles_select_visible on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

drop table if exists public.lessons;
drop function if exists private.lessons_before_insert();
drop function if exists private.lessons_before_update();
drop table if exists public.teacher_availability;
drop type if exists public.calendar_sync_status;
drop type if exists public.lesson_status;

revoke execute on function private.claims_sub() from edusearch_api;
drop function if exists private.claims_sub();
revoke usage on schema private from edusearch_api;

-- btree_gist fica (inofensiva e possivelmente usada por outros objetos).

commit;
