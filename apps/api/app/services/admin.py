"""Serviços administrativos: autorização persistida e negação por padrão."""

from datetime import UTC, datetime, timedelta
from typing import Annotated, Any
from uuid import UUID, uuid4

from fastapi import Depends, Request

from app.auth.dependencies import get_database
from app.auth.jwt import AuthenticatedUser
from app.db import BaseDatabase, as_connection_role
from app.errors import forbidden, not_found


class AdminService:
    def __init__(self, database: BaseDatabase) -> None:
        self._db = database

    def _permission(self, user: AuthenticatedUser, permission: str) -> str:
        # A tabela privada não é exposta ao usuário: a função só roda como a API.
        with self._db.user_transaction(user) as conn:
            with as_connection_role(conn):
                role = conn.execute(
                    "select private.admin_role_for(%s) as role", (user.id,)
                ).fetchone()["role"]
                allowed = conn.execute(
                    "select private.admin_has_permission(%s, %s) as allowed", (user.id, permission)
                ).fetchone()["allowed"]
        if not allowed:
            raise forbidden(
                "admin_permission_required", "Sua conta não tem permissão administrativa."
            )
        return str(role)

    def me(self, user: AuthenticatedUser) -> dict[str, Any]:
        role = self._permission(user, "dashboard.read")
        return {"id": user.id, "role": role}

    def dashboard(self, user: AuthenticatedUser, days: int) -> dict[str, Any]:
        self._permission(user, "dashboard.read")
        since = datetime.now(UTC) - timedelta(days=days)
        with self._db.service_transaction() as conn:
            row = conn.execute(
                "select private.admin_dashboard(%s, %s) as data", (user.id, since)
            ).fetchone()
        return row["data"] or {}

    def teachers(
        self, user: AuthenticatedUser, limit: int, offset: int, status: str | None
    ) -> dict[str, Any]:
        self._permission(user, "teachers.read")
        with self._db.service_transaction() as conn:
            row = conn.execute(
                "select private.admin_list_teachers(%s, %s, %s, %s) as data",
                (user.id, limit, offset, status),
            ).fetchone()
        return row["data"] or {"items": [], "limit": limit, "offset": offset}

    def teacher_transition(
        self, user: AuthenticatedUser, teacher_id: UUID, action: str, justification: str
    ) -> dict[str, Any]:
        permission = f"teachers.{action if action != 'reactivate' else 'suspend'}"
        self._permission(user, permission)
        try:
            with self._db.service_transaction() as conn:
                row = conn.execute(
                    "select private.admin_transition_teacher(%s, %s, %s, %s, %s) as data",
                    (user.id, teacher_id, action, justification, uuid4()),
                ).fetchone()
        except Exception as exc:
            # Não converte falhas de banco genéricas; só evita enumerar professor inexistente.
            if getattr(exc, "sqlstate", None) == "P0002":
                raise not_found("teacher_not_found", "Professor não encontrado.") from exc
            raise
        return row["data"]


def get_admin_service(
    request: Request, database: Annotated[BaseDatabase, Depends(get_database)]
) -> AdminService:
    return AdminService(database)
