"""SQL do onboarding. Sempre dentro de ``BaseDatabase.user_transaction`` (RLS ativo como o usuário).

Exceção única: :meth:`OnboardingRepository.insert_role`, chamado dentro de
``as_connection_role`` (papel edusearch_api; RLS limita o INSERT ao ``sub`` das claims).
"""

from typing import Any
from uuid import UUID

import psycopg

from app.schemas.onboarding import StudentProfileIn, TeacherProfileIn


class UnknownSubjectsError(Exception):
    def __init__(self, slugs: list[str]) -> None:
        super().__init__(", ".join(slugs))
        self.slugs = slugs


_STUDENT_SELECT = """
select s.learning_goal, s.education_level::text as education_level,
       s.difficulty_areas::text[] as difficulty_areas,
       s.preferred_weekdays::text[] as preferred_weekdays,
       s.preferred_periods::text[] as preferred_periods,
       s.preferred_modality::text as preferred_modality,
       s.budget_min_cents, s.budget_max_cents, s.created_at, s.updated_at,
       coalesce(array(select sub.slug from public.student_subjects ss
                        join public.subjects sub on sub.id = ss.subject_id
                       where ss.student_id = s.user_id order by sub.slug), '{}') as subjects
  from public.student_profiles s
 where s.user_id = %s
"""

_TEACHER_SELECT = """
select t.headline, t.bio, t.specialties, t.academic_background, t.experience::text as experience,
       t.teaching_methods::text[] as teaching_methods, t.methodology, t.price_cents,
       t.lesson_durations_minutes::int[] as lesson_durations_minutes,
       t.lesson_duration_minutes::int as lesson_duration_minutes,
       t.modality::text as modality,
       t.available_weekdays::text[] as available_weekdays,
       t.available_periods::text[] as available_periods,
       t.verification_status::text as verification_status, t.is_published, t.published_at,
       t.created_at, t.updated_at,
       coalesce(array(select sub.slug from public.teacher_subjects ts
                        join public.subjects sub on sub.id = ts.subject_id
                       where ts.teacher_id = t.user_id order by sub.slug), '{}') as subjects
  from public.teacher_profiles t
 where t.user_id = %s
"""


class OnboardingRepository:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    # ------------------------------------------------------------------ papéis e estado

    def insert_role(self, user_id: UUID, role: str) -> None:
        # Sem alvo no ON CONFLICT: edusearch_api não tem SELECT em account_roles.
        self._conn.execute(
            "insert into public.account_roles (user_id, role) values (%s, %s) "
            "on conflict do nothing",
            (user_id, role),
        )

    def onboarding_state(self, user_id: UUID) -> dict[str, Any]:
        row = self._conn.execute(
            """
            select exists (select 1 from public.student_profiles where user_id = %s) as student,
                   (select verification_status::text from public.teacher_profiles
                     where user_id = %s) as teacher_verification,
                   coalesce((select is_published from public.teacher_profiles where user_id = %s),
                            false) as teacher_published
            """,
            (user_id, user_id, user_id),
        ).fetchone()
        assert row is not None  # noqa: S101 — consulta sem FROM sempre devolve uma linha
        return row

    # ------------------------------------------------------------------ catálogo

    def subject_ids(self, slugs: list[str]) -> dict[str, int]:
        rows = self._conn.execute(
            "select slug, id from public.subjects where is_active and slug = any(%s)", (slugs,)
        ).fetchall()
        found = {r["slug"]: r["id"] for r in rows}
        missing = sorted(set(slugs) - set(found))
        if missing:
            raise UnknownSubjectsError(missing)
        return found

    def list_subjects(self) -> list[dict[str, Any]]:
        return self._conn.execute(
            "select slug, name from public.subjects where is_active order by name"
        ).fetchall()

    # ------------------------------------------------------------------ aluno

    def get_student(self, user_id: UUID) -> dict[str, Any] | None:
        return self._conn.execute(_STUDENT_SELECT, (user_id,)).fetchone()

    def upsert_student(self, user_id: UUID, data: StudentProfileIn) -> None:
        ids = self.subject_ids(data.subjects)
        values = (
            data.learning_goal,
            data.education_level,
            data.difficulty_areas,
            data.preferred_weekdays,
            data.preferred_periods,
            data.preferred_modality,
            data.budget_min_cents,
            data.budget_max_cents,
        )
        updated = self._conn.execute(
            """
            update public.student_profiles
               set learning_goal = %s, education_level = %s::public.education_level,
                   difficulty_areas = %s::public.learning_difficulty[],
                   preferred_weekdays = %s::public.weekday[],
                   preferred_periods = %s::public.day_period[],
                   preferred_modality = %s::public.lesson_modality,
                   budget_min_cents = %s, budget_max_cents = %s
             where user_id = %s
            """,
            (*values, user_id),
        ).rowcount
        if updated == 0:
            self._conn.execute(
                """
                insert into public.student_profiles
                  (learning_goal, education_level, difficulty_areas, preferred_weekdays,
                   preferred_periods, preferred_modality, budget_min_cents, budget_max_cents,
                   user_id)
                values (%s, %s::public.education_level, %s::public.learning_difficulty[],
                        %s::public.weekday[], %s::public.day_period[],
                        %s::public.lesson_modality, %s, %s, %s)
                """,
                (*values, user_id),
            )
        self._replace_subjects("student_subjects", "student_id", user_id, list(ids.values()))

    # ------------------------------------------------------------------ professor

    def get_teacher(self, user_id: UUID) -> dict[str, Any] | None:
        return self._conn.execute(_TEACHER_SELECT, (user_id,)).fetchone()

    def upsert_teacher(self, user_id: UUID, data: TeacherProfileIn) -> None:
        ids = self.subject_ids(data.subjects)
        durations = sorted(data.lesson_durations_minutes)
        values = (
            data.headline,
            data.bio,
            data.specialties,
            data.academic_background,
            data.experience,
            data.teaching_methods,
            data.methodology,
            data.price_cents,
            durations,
            durations[0],  # duração principal = a menor oferecida
            data.modality,
            data.available_weekdays,
            data.available_periods,
        )
        updated = self._conn.execute(
            """
            update public.teacher_profiles
               set headline = %s, bio = %s, specialties = %s, academic_background = %s,
                   experience = %s::public.experience_range,
                   teaching_methods = %s::public.teaching_method[], methodology = %s,
                   price_cents = %s, lesson_durations_minutes = %s::smallint[],
                   lesson_duration_minutes = %s, modality = %s::public.lesson_modality,
                   available_weekdays = %s::public.weekday[],
                   available_periods = %s::public.day_period[]
             where user_id = %s
            """,
            (*values, user_id),
        ).rowcount
        if updated == 0:
            self._conn.execute(
                """
                insert into public.teacher_profiles
                  (headline, bio, specialties, academic_background, experience, teaching_methods,
                   methodology, price_cents, lesson_durations_minutes, lesson_duration_minutes,
                   modality, available_weekdays, available_periods, user_id)
                values (%s, %s, %s, %s, %s::public.experience_range, %s::public.teaching_method[],
                        %s, %s, %s::smallint[], %s, %s::public.lesson_modality,
                        %s::public.weekday[], %s::public.day_period[], %s)
                """,
                (*values, user_id),
            )
        self._replace_subjects("teacher_subjects", "teacher_id", user_id, list(ids.values()))

    # ------------------------------------------------------------------ disciplinas

    def _replace_subjects(self, table: str, owner: str, user_id: UUID, ids: list[int]) -> None:
        # Remove só as que saíram e insere só as novas: linhas mantidas (e seus níveis) ficam.
        # table/owner vêm de constantes internas, nunca da requisição.
        self._conn.execute(
            f"delete from public.{table} where {owner} = %s and not (subject_id = any(%s))",  # noqa: S608
            (user_id, ids),
        )
        self._conn.execute(
            f"""
            insert into public.{table} ({owner}, subject_id)
            select %s, s from unnest(%s::smallint[]) s
             where not exists (select 1 from public.{table} x
                                where x.{owner} = %s and x.subject_id = s)
            """,  # noqa: S608
            (user_id, ids, user_id),
        )
