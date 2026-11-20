"""Acesso ao PostgreSQL (Supabase).

Toda consulta feita em nome de um usuário roda em :meth:`Database.user_transaction`, que abre uma
transação e executa ``SET LOCAL ROLE authenticated`` com as claims VERIFICADAS do JWT em
``request.jwt.claims``. Assim ``auth.uid()`` e as políticas RLS valem também para a API (defesa
em profundidade): mesmo um bug na API não lê nem altera linhas de outro usuário.

O pool usa ``prepare_threshold=None`` para funcionar com o pooler do Supabase em modo transação.
"""

import json
import logging
from collections.abc import Iterator
from contextlib import contextmanager

import psycopg
from psycopg import sql
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool, PoolTimeout

from app.auth.jwt import AuthenticatedUser
from app.errors import ApiError, forbidden, service_unavailable

logger = logging.getLogger("edusearch.api.db")


def database_unavailable() -> ApiError:
    return service_unavailable(
        "database_unavailable", "Serviço temporariamente indisponível. Tente novamente."
    )


class Database:
    def __init__(
        self,
        conninfo: str,
        *,
        min_size: int = 1,
        max_size: int = 5,
        connect_timeout: float = 5.0,
        statement_timeout_ms: int = 5000,
    ) -> None:
        self._timeout = connect_timeout
        self._statement_timeout_ms = int(statement_timeout_ms)
        self._pool = ConnectionPool(
            conninfo,
            min_size=min_size,
            max_size=max_size,
            open=False,
            timeout=connect_timeout,
            check=ConnectionPool.check_connection,
            kwargs={
                "prepare_threshold": None,
                "connect_timeout": max(1, int(connect_timeout)),
                "application_name": "edusearch-api",
            },
            name="edusearch-api",
        )

    def open(self) -> None:
        # wait=False: a API sobe mesmo com o banco fora do ar e responde 503 até ele voltar.
        self._pool.open(wait=False)

    def close(self) -> None:
        self._pool.close()

    @contextmanager
    def user_transaction(self, user: AuthenticatedUser) -> Iterator[psycopg.Connection]:
        """Transação com o papel ``authenticated`` e as claims do usuário (RLS aplicado)."""
        with self._transaction("authenticated", user.claims) as conn:
            yield conn

    @contextmanager
    def anon_transaction(self) -> Iterator[psycopg.Connection]:
        """Transação com o papel ``anon`` (dados públicos, ex.: catálogo de disciplinas)."""
        with self._transaction("anon", {"role": "anon"}) as conn:
            yield conn

    def connection_role(self) -> dict[str, object]:
        """Atributos do papel de conexão (para recusar superusuário/BYPASSRLS em produção)."""
        try:
            with self._pool.connection(timeout=self._timeout) as conn:
                row = conn.execute(
                    "select current_user::text, rolsuper, rolbypassrls from pg_roles "
                    "where rolname = current_user"
                ).fetchone()
        except (PoolTimeout, psycopg.Error) as exc:
            raise database_unavailable() from exc
        if row is None:
            raise database_unavailable()
        return {"name": row[0], "superuser": bool(row[1]), "bypassrls": bool(row[2])}

    @contextmanager
    def _transaction(self, role: str, claims: dict) -> Iterator[psycopg.Connection]:
        try:
            with self._pool.connection(timeout=self._timeout) as conn:
                conn.row_factory = dict_row
                with conn.transaction():
                    conn.execute(sql.SQL("set local role {}").format(sql.Identifier(role)))
                    conn.execute(
                        sql.SQL("set local statement_timeout = {}").format(
                            sql.Literal(self._statement_timeout_ms)
                        )
                    )
                    conn.execute(
                        "select set_config('request.jwt.claims', %s, true)",
                        (json.dumps(claims, separators=(",", ":"), default=str),),
                    )
                    yield conn
        except ApiError:
            raise
        except PoolTimeout as exc:
            logger.warning("pool sem conexão disponível")
            raise database_unavailable() from exc
        except psycopg.errors.InsufficientPrivilege as exc:
            # Inclui violação de política RLS (WITH CHECK). Não revela detalhes do banco.
            raise forbidden() from exc
        except (psycopg.OperationalError, psycopg.errors.QueryCanceled) as exc:
            logger.warning("falha de banco: %s", exc.__class__.__name__)
            raise database_unavailable() from exc


@contextmanager
def as_connection_role(conn: psycopg.Connection) -> Iterator[None]:
    """Dentro de uma transação de usuário, executa como o PAPEL DE CONEXÃO (edusearch_api).

    Usado só para atribuir papel (INSERT em account_roles, limitado por RLS ao ``sub`` das
    claims). Ao sair, volta para ``authenticated``.
    """
    conn.execute("set local role none")
    yield
    # Sem "finally": se o bloco falhar, a transação inteira é desfeita (ROLLBACK).
    conn.execute("set local role authenticated")
