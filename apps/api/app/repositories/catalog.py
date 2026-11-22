"""Catálogo do marketplace (Fase 4A). Sempre dentro de ``user_transaction`` (RLS ativo).

O RLS já restringe ``teacher_profiles``/``teacher_subjects``/``profiles`` a professores
PUBLICADOS (ou à própria conta); as consultas também filtram ``is_published`` explicitamente.
"""

from typing import Any
from uuid import UUID

import psycopg

# Períodos do dia em minutos locais (America/Sao_Paulo): [início, fim).
PERIOD_MINUTES = {
    "manha": (6 * 60, 12 * 60),
    "tarde": (12 * 60, 18 * 60),
    "noite": (18 * 60, 24 * 60),
}

_SUBJECTS = """
coalesce(array(select s.slug from public.teacher_subjects ts
                 join public.subjects s on s.id = ts.subject_id
                where ts.teacher_id = t.user_id order by s.name), '{}')
"""


def _like(value: str) -> str:
    """Padrão ILIKE literal: % e _ digitados pelo usuário não viram curingas."""
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


class CatalogRepository:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def search(
        self,
        *,
        exclude: UUID,
        q: str | None,
        subject: str | None,
        modality: str | None,
        period: str | None,
        limit: int,
        offset: int,
    ) -> list[dict[str, Any]]:
        where = ["t.is_published", "t.user_id <> %(exclude)s"]
        params: dict[str, Any] = {"exclude": exclude, "limit": limit, "offset": offset}
        if q:
            # Nome do professor OU nome/slug de uma disciplina que ele ensina.
            where.append(
                "(p.display_name ilike %(q)s or exists ("
                " select 1 from public.teacher_subjects ts join public.subjects s"
                " on s.id = ts.subject_id where ts.teacher_id = t.user_id"
                " and (s.name ilike %(q)s or s.slug ilike %(q)s)))"
            )
            params["q"] = _like(q)
        if subject:
            where.append(
                "exists (select 1 from public.teacher_subjects ts join public.subjects s"
                " on s.id = ts.subject_id where ts.teacher_id = t.user_id and s.slug = %(subject)s)"
            )
            params["subject"] = subject
        if modality:
            # "Online e presencial" (híbrido) atende quem procura qualquer uma das duas.
            where.append(
                "(t.modality = %(modality)s::public.lesson_modality or t.modality = 'hibrido')"
            )
            params["modality"] = modality
        if period:
            start, end = PERIOD_MINUTES[period]
            where.append(
                "exists (select 1 from public.teacher_availability a where a.teacher_id = t.user_id"
                " and a.start_minute < %(p_end)s and a.end_minute > %(p_start)s)"
            )
            params.update(p_start=start, p_end=end)
        sql = f"""
            select t.user_id as id, p.display_name, p.avatar_url, t.headline,
                   t.experience::text as experience, t.modality::text as modality,
                   t.lesson_durations_minutes::int[] as lesson_durations_minutes,
                   {_SUBJECTS} as subjects
              from public.teacher_profiles t
              join public.profiles p on p.id = t.user_id
             where {" and ".join(where)}
             order by p.display_name, t.user_id
             limit %(limit)s offset %(offset)s
        """  # noqa: S608 — só fragmentos fixos; valores sempre parametrizados
        return self._conn.execute(sql, params).fetchall()

    def profile(self, teacher_id: UUID) -> dict[str, Any] | None:
        """Perfil público: professor publicado (ou o próprio, para pré-visualizar)."""
        return self._conn.execute(
            f"""
            select t.user_id as id, p.display_name, p.avatar_url, t.headline, t.bio,
                   t.specialties, t.academic_background, t.experience::text as experience,
                   t.teaching_methods::text[] as teaching_methods, t.methodology,
                   t.modality::text as modality,
                   t.lesson_durations_minutes::int[] as lesson_durations_minutes,
                   t.is_published,
                   {_SUBJECTS} as subjects
              from public.teacher_profiles t
              join public.profiles p on p.id = t.user_id
             where t.user_id = %s
            """,  # noqa: S608
            (teacher_id,),
        ).fetchone()

    def subject_names(self) -> dict[str, str]:
        rows = self._conn.execute("select slug, name from public.subjects").fetchall()
        return {r["slug"]: r["name"] for r in rows}
