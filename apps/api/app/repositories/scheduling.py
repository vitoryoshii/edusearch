"""SQL da agenda. Sempre dentro de ``BaseDatabase.user_transaction`` (RLS ativo como o usuário).

Métodos marcados "papel de conexão" rodam dentro de ``as_connection_role`` (edusearch_api) e são
limitados por RLS ao ``sub`` das claims: credenciais do Google, horários ocupados e campos de
sincronização da aula.
"""

from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg

from app.scheduling import Window

_LESSON_SELECT = """
select l.id, l.teacher_id, l.student_id, sub.slug as subject, sub.name as subject_name,
       l.starts_at, l.ends_at, l.status::text as status,
       l.calendar_sync_status::text as calendar_sync_status, l.google_event_id, l.meet_url,
       l.cancelled_at, l.cancelled_by_role::text as cancelled_by_role, l.created_at,
       pt.display_name as teacher_name, ps.display_name as student_name
  from public.lessons l
  join public.subjects sub on sub.id = l.subject_id
  left join public.profiles pt on pt.id = l.teacher_id
  left join public.profiles ps on ps.id = l.student_id
"""


class SlotTakenError(Exception):
    """Exclusão de sobreposição: o professor ou o aluno já tem aula nesse horário."""


class LessonRejectedError(Exception):
    """Regra do trigger/constraint recusou a aula (janela, duração, disciplina...)."""


class SchedulingRepository:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    # -------------------------------------------------- credenciais (papel de conexão)

    def get_credentials(self, teacher_id: UUID) -> dict[str, Any] | None:
        return self._conn.execute(
            "select teacher_id, status, refresh_token_ciphertext, key_version, scopes, "
            "connected_at, revoked_at from private.google_calendar_credentials "
            "where teacher_id = %s",
            (teacher_id,),
        ).fetchone()

    def save_credentials(
        self, teacher_id: UUID, *, ciphertext: bytes, key_version: int, scopes: list[str]
    ) -> None:
        self._conn.execute(
            """
            insert into private.google_calendar_credentials
              (teacher_id, status, refresh_token_ciphertext, key_version, scopes, connected_at,
               revoked_at)
            values (%s, 'connected', %s, %s, %s, now(), null)
            on conflict (teacher_id) do update
               set status = 'connected',
                   refresh_token_ciphertext = excluded.refresh_token_ciphertext,
                   key_version = excluded.key_version, scopes = excluded.scopes,
                   connected_at = now(), revoked_at = null
            """,
            (teacher_id, ciphertext, key_version, scopes),
        )

    def mark_revoked(self, teacher_id: UUID) -> None:
        self._conn.execute(
            "update private.google_calendar_credentials "
            "set status = 'revoked', refresh_token_ciphertext = null, key_version = null, "
            "revoked_at = now() where teacher_id = %s",
            (teacher_id,),
        )

    def delete_credentials(self, teacher_id: UUID) -> None:
        self._conn.execute(
            "delete from private.google_calendar_credentials where teacher_id = %s", (teacher_id,)
        )

    def teacher_busy(self, teacher_id: UUID, start: datetime, end: datetime) -> list[tuple]:
        rows = self._conn.execute(
            "select starts_at, ends_at from private.teacher_busy_ranges(%s, %s, %s)",
            (teacher_id, start, end),
        ).fetchall()
        return [(r["starts_at"], r["ends_at"]) for r in rows]

    def set_calendar(
        self,
        lesson_id: UUID,
        *,
        status: str,
        event_id: str | None = None,
        meet_url: str | None = None,
        keep_event: bool = False,
    ) -> None:
        if keep_event:
            self._conn.execute(
                "update public.lessons set calendar_sync_status = %s::public.calendar_sync_status, "
                "calendar_synced_at = now() where id = %s",
                (status, lesson_id),
            )
            return
        self._conn.execute(
            "update public.lessons set calendar_sync_status = %s::public.calendar_sync_status, "
            "google_event_id = %s, meet_url = %s, calendar_synced_at = now() where id = %s",
            (status, event_id, meet_url, lesson_id),
        )

    # ------------------------------------------------------------------ disponibilidade

    def list_windows(self, teacher_id: UUID) -> list[Window]:
        rows = self._conn.execute(
            "select weekday::text as weekday, start_minute, end_minute "
            "from public.teacher_availability where teacher_id = %s",
            (teacher_id,),
        ).fetchall()
        return [Window(r["weekday"], r["start_minute"], r["end_minute"]) for r in rows]

    def replace_windows(self, teacher_id: UUID, windows: list[Window]) -> None:
        self._conn.execute(
            "delete from public.teacher_availability where teacher_id = %s", (teacher_id,)
        )
        for w in windows:
            self._conn.execute(
                "insert into public.teacher_availability "
                "(teacher_id, weekday, start_minute, end_minute) "
                "values (%s, %s::public.weekday, %s, %s)",
                (teacher_id, w.weekday, w.start_minute, w.end_minute),
            )

    # ------------------------------------------------------------------ professores reserváveis

    def teacher_offer(self, teacher_id: UUID) -> dict[str, Any] | None:
        return self._conn.execute(
            """
            select t.user_id, t.is_published,
                   t.lesson_durations_minutes::int[] as durations,
                   coalesce(array(select s.slug from public.teacher_subjects ts
                                    join public.subjects s on s.id = ts.subject_id
                                   where ts.teacher_id = t.user_id), '{}') as subjects
              from public.teacher_profiles t
             where t.user_id = %s and t.is_published
            """,
            (teacher_id,),
        ).fetchone()

    def subject_id(self, slug: str) -> int | None:
        row = self._conn.execute(
            "select id from public.subjects where slug = %s and is_active", (slug,)
        ).fetchone()
        return row["id"] if row else None

    def has_teacher_profile(self, user_id: UUID) -> bool:
        return (
            self._conn.execute(
                "select 1 from public.teacher_profiles where user_id = %s", (user_id,)
            ).fetchone()
            is not None
        )

    def lesson_by_key(self, student_id: UUID, key: UUID) -> dict[str, Any] | None:
        return self._conn.execute(
            "select id, teacher_id, starts_at from public.lessons "
            "where student_id = %s and idempotency_key = %s",
            (student_id, key),
        ).fetchone()

    def own_busy(self, user_id: UUID, start: datetime, end: datetime) -> list[tuple]:
        rows = self._conn.execute(
            "select starts_at, ends_at from public.lessons "
            "where %s in (teacher_id, student_id) and status = 'scheduled' "
            "and starts_at < %s and ends_at > %s",
            (user_id, end, start),
        ).fetchall()
        return [(r["starts_at"], r["ends_at"]) for r in rows]

    # ------------------------------------------------------------------ aulas

    def insert_lesson(
        self,
        *,
        teacher_id: UUID,
        student_id: UUID,
        subject_id: int,
        starts_at: datetime,
        ends_at: datetime,
        idempotency_key: UUID,
    ) -> tuple[UUID, bool]:
        """(id, criada_agora). Numa corrida com a MESMA chave, devolve a aula que venceu."""
        try:
            # Savepoint: uma violação não aborta a transação do usuário.
            with self._conn.transaction():
                row = self._conn.execute(
                    """
                    insert into public.lessons
                      (teacher_id, student_id, subject_id, starts_at, ends_at, idempotency_key)
                    values (%s, %s, %s, %s, %s, %s)
                    returning id
                    """,
                    (teacher_id, student_id, subject_id, starts_at, ends_at, idempotency_key),
                ).fetchone()
        except psycopg.errors.UniqueViolation:
            # Corrida com outra requisição de MESMA chave: devolve a que venceu.
            again = self._conn.execute(
                "select id from public.lessons where student_id = %s and idempotency_key = %s",
                (student_id, idempotency_key),
            ).fetchone()
            if again is None:
                raise
            return again["id"], False
        except psycopg.errors.ExclusionViolation as exc:
            raise SlotTakenError() from exc
        except psycopg.errors.CheckViolation as exc:
            raise LessonRejectedError(getattr(exc.diag, "message_primary", None) or "") from exc
        assert row is not None  # noqa: S101 — INSERT ... RETURNING sempre devolve a linha
        return row["id"], True

    def get_lesson(self, lesson_id: UUID) -> dict[str, Any] | None:
        return self._conn.execute(_LESSON_SELECT + " where l.id = %s", (lesson_id,)).fetchone()

    def list_lessons(self, user_id: UUID) -> list[dict[str, Any]]:
        return self._conn.execute(
            _LESSON_SELECT + " where %s in (l.teacher_id, l.student_id) "
            "order by l.starts_at desc limit 100",
            (user_id,),
        ).fetchall()

    def cancel_lesson(self, lesson_id: UUID) -> bool:
        return (
            self._conn.execute(
                "update public.lessons set status = 'cancelled' "
                "where id = %s and status = 'scheduled' and ends_at > now()",
                (lesson_id,),
            ).rowcount
            == 1
        )
