"""Consultas de perfil e papéis. Rodam sempre dentro de ``Database.user_transaction`` (RLS ativo).

As consultas filtram por ``user_id`` explicitamente E o RLS filtra por ``auth.uid()``: as duas
camadas precisam concordar para uma linha aparecer.
"""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

import psycopg


@dataclass(frozen=True)
class ProfileRow:
    id: UUID
    display_name: str
    avatar_url: str | None
    status: str
    created_at: datetime
    updated_at: datetime


_PROFILE_COLUMNS = "id, display_name, avatar_url, status::text as status, created_at, updated_at"


class ProfileRepository:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    def get_profile(self, user_id: UUID) -> ProfileRow | None:
        row = self._conn.execute(
            f"select {_PROFILE_COLUMNS} from public.profiles where id = %s",  # noqa: S608
            (user_id,),
        ).fetchone()
        return ProfileRow(**row) if row else None

    def list_roles(self, user_id: UUID) -> list[str]:
        rows = self._conn.execute(
            "select role::text as role from public.account_roles where user_id = %s order by role",
            (user_id,),
        ).fetchall()
        return [r["role"] for r in rows]

    def update_profile(
        self, user_id: UUID, *, display_name: str, avatar_url: str | None
    ) -> ProfileRow | None:
        # Só colunas editáveis pelo usuário (o banco também restringe por GRANT de coluna).
        row = self._conn.execute(
            f"""
            update public.profiles
               set display_name = %s, avatar_url = %s
             where id = %s
            returning {_PROFILE_COLUMNS}
            """,  # noqa: S608
            (display_name, avatar_url, user_id),
        ).fetchone()
        return ProfileRow(**row) if row else None
