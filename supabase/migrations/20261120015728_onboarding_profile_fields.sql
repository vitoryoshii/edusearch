-- EduSearch — Fase 2.6B: campos do onboarding real de aluno e professor.
--
-- Comparação campo a campo com os formulários (docs/database-design.md, "Onboarding ↔ banco").
-- Só ADICIONA colunas (com padrão vazio), uma tabela e privilégios: nenhum dado existente é
-- alterado ou removido, e nenhuma resposta do formulário fica sem lugar no banco.
--
-- Aluno:   "Principais dificuldades" (lista fechada)      → student_profiles.difficulty_areas
--          "Disciplinas de interesse"                      → nova tabela student_subjects
-- Professor: "Especialidades" (texto livre)               → teacher_profiles.specialties
--          "Metodologia" (lista fechada)                   → teacher_profiles.teaching_methods
--          "Como são suas aulas" (texto)                   → teacher_profiles.methodology (já existia)
--          "Duração das aulas" (várias)                    → teacher_profiles.lesson_durations_minutes
--                                                            (lesson_duration_minutes = a menor, principal)
--          "Dias" e "Períodos" (visão geral da agenda)     → available_weekdays / available_periods

-- ---------------------------------------------------------------------------------------------
-- Tipos (mesmo vocabulário do frontend: apps/web/src/lib/api/types.ts)
-- ---------------------------------------------------------------------------------------------
create type public.learning_difficulty as enum ('base', 'exercicios', 'pratica', 'fala', 'organizacao');
create type public.teaching_method as enum ('pratica', 'teorica', 'exercicios', 'conversacao', 'projetos');

-- ---------------------------------------------------------------------------------------------
-- student_profiles
-- ---------------------------------------------------------------------------------------------
alter table public.student_profiles
  add column difficulty_areas public.learning_difficulty[] not null default '{}';
alter table public.student_profiles
  add constraint student_difficulty_areas_len check (cardinality(difficulty_areas) <= 5);
comment on column public.student_profiles.difficulties is
  'Observações livres sobre dificuldades (reservado; o onboarding usa difficulty_areas).';

-- ---------------------------------------------------------------------------------------------
-- teacher_profiles
-- ---------------------------------------------------------------------------------------------
alter table public.teacher_profiles
  add column specialties              text,
  add column teaching_methods         public.teaching_method[] not null default '{}',
  add column lesson_durations_minutes smallint[] not null default '{}',
  add column available_weekdays       public.weekday[] not null default '{}',
  add column available_periods        public.day_period[] not null default '{}';

alter table public.teacher_profiles
  add constraint teacher_specialties_len check (specialties is null or char_length(specialties) <= 200),
  add constraint teacher_methods_len check (cardinality(teaching_methods) <= 5),
  add constraint teacher_durations_valid check (
    lesson_durations_minutes <@ array[30, 45, 60, 90]::smallint[] and cardinality(lesson_durations_minutes) <= 4
  ),
  -- A duração principal precisa estar entre as oferecidas (quando houver lista).
  add constraint teacher_primary_duration_offered check (
    cardinality(lesson_durations_minutes) = 0 or lesson_duration_minutes = any (lesson_durations_minutes)
  ),
  add constraint teacher_weekdays_len check (cardinality(available_weekdays) <= 7),
  add constraint teacher_periods_len check (cardinality(available_periods) <= 3);

comment on column public.teacher_profiles.methodology is 'Texto livre "Como são suas aulas".';
comment on column public.teacher_profiles.lesson_duration_minutes is
  'Duração principal (exibição/agenda): a menor de lesson_durations_minutes, definida pela API.';
comment on column public.teacher_profiles.available_weekdays is
  'Visão geral da disponibilidade. Os horários detalhados virão da agenda (fase futura).';

-- Novas colunas editáveis pelo próprio professor (as do servidor continuam de fora).
grant insert (specialties, teaching_methods, lesson_durations_minutes, available_weekdays, available_periods)
  on public.teacher_profiles to authenticated;
grant update (specialties, teaching_methods, lesson_durations_minutes, available_weekdays, available_periods)
  on public.teacher_profiles to authenticated;

grant insert (difficulty_areas) on public.student_profiles to authenticated;
grant update (difficulty_areas) on public.student_profiles to authenticated;

-- ---------------------------------------------------------------------------------------------
-- student_subjects: disciplinas de interesse do aluno (PRIVADO, como student_profiles)
-- ---------------------------------------------------------------------------------------------
create table public.student_subjects (
  student_id uuid not null references public.student_profiles (user_id) on delete cascade,
  subject_id smallint not null references public.subjects (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (student_id, subject_id)
);
alter table public.student_subjects enable row level security;
create index student_subjects_subject_idx on public.student_subjects (subject_id);
comment on table public.student_subjects is
  'Disciplinas de interesse do aluno. Privado: só o próprio aluno (e o servidor) lê.';

revoke all on table public.student_subjects from public, anon, authenticated;
grant select, delete on public.student_subjects to authenticated;
grant insert (student_id, subject_id) on public.student_subjects to authenticated;

create policy student_subjects_select_own on public.student_subjects
  for select to authenticated
  using (student_id = (select auth.uid()));

-- A FK exige student_profiles, que por sua vez exige o papel "student" persistido.
create policy student_subjects_insert_own on public.student_subjects
  for insert to authenticated
  with check (student_id = (select auth.uid()));

create policy student_subjects_delete_own on public.student_subjects
  for delete to authenticated
  using (student_id = (select auth.uid()));
