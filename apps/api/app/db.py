"""Acesso ao PostgreSQL (Supabase).

Toda consulta feita em nome de um usuário roda em :meth:`BaseDatabase.user_transaction`, que abre
uma transação e executa ``SET LOCAL ROLE authenticated`` com as claims VERIFICADAS do JWT em
``request.jwt.claims``. Assim ``auth.uid()`` e as políticas RLS valem também para a API (defesa
em profundidade): mesmo um bug na API não lê nem altera linhas de outro usuário.

Dois modos de conexão, com as MESMAS transações e o mesmo RLS:

* :class:`Database` — pool local (psycopg_pool, threads). Uso: uvicorn, testes, Docker.
* :class:`DirectDatabase` — uma conexão por transação, sem pool nem threads. Uso: Cloudflare
  Python Workers + Hyperdrive (o pool fica no Hyperdrive, em modo transação). Nenhum estado de
  sessão atravessa transações: role e claims são sempre ``SET LOCAL`` / ``set_config(..., true)``.

``prepare_threshold=None``: sem prepared statements nomeados (poolers em modo transação).
"""

import json
import logging
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

from app.auth.jwt import AuthenticatedUser
from app.errors import ApiError, forbidden, service_unavailable

logger = logging.getLogger("edusearch.api.db")


def database_unavailable() -> ApiError:
    return service_unavailable(
        "database_unavailable", "Serviço temporariamente indisponível. Tente novamente."
    )


class ConnectionUnavailableError(Exception):
    """Sem conexão disponível (pool esgotado, tempo limite ou banco inalcançável)."""


class BaseDatabase:
    """Transações por papel (authenticated/anon) com claims verificadas.

    Subclasses só fornecem a conexão em :meth:`_connection`.
    """

    def __init__(self, *, statement_timeout_ms: int = 5000) -> None:
        self._statement_timeout_ms = int(statement_timeout_ms)

    def open(self) -> None:
        """Abre recursos (pool). Padrão: nada."""

    def close(self) -> None:
        """Fecha recursos (pool). Padrão: nada."""

    @contextmanager
    def _connection(self) -> Iterator[psycopg.Connection]:
        raise NotImplementedError
        yield  # pragma: no cover

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

    @contextmanager
    def service_transaction(self) -> Iterator[psycopg.Connection]:
        """Transação como o PAPEL DE CONEXÃO (edusearch_api), SEM usuário e sem claims.

        Só para chamadas do servidor sem JWT (webhook do gateway de pagamento). O papel da API não
        lê nem escreve tabelas do app sem RLS de participante: aqui ele só consegue executar as
        funções private.payment_* às quais tem EXECUTE.
        """
        with self._transaction(None, {}) as conn:
            yield conn

    def connection_role(self) -> dict[str, object]:
        """Atributos do papel de conexão (para recusar superusuário/BYPASSRLS em produção)."""
        try:
            with self._connection() as conn:
                row = conn.execute(
                    "select current_user::text, rolsuper, rolbypassrls from pg_roles "
                    "where rolname = current_user"
                ).fetchone()
                conn.rollback()
        except (ConnectionUnavailableError, psycopg.Error) as exc:
            raise database_unavailable() from exc
        if row is None:
            raise database_unavailable()
        return {"name": row[0], "superuser": bool(row[1]), "bypassrls": bool(row[2])}

    @contextmanager
    def _transaction(self, role: str | None, claims: dict) -> Iterator[psycopg.Connection]:
        try:
            with self._connection() as conn:
                conn.row_factory = dict_row
                with conn.transaction():
                    if role is not None:
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
        except ConnectionUnavailableError as exc:
            logger.warning("sem conexão disponível com o banco")
            raise database_unavailable() from exc
        except psycopg.errors.InsufficientPrivilege as exc:
            # Inclui violação de política RLS (WITH CHECK). Não revela detalhes do banco.
            raise forbidden() from exc
        except (psycopg.OperationalError, psycopg.errors.QueryCanceled) as exc:
            logger.warning("falha de banco: %s", exc.__class__.__name__)
            raise database_unavailable() from exc


class Database(BaseDatabase):
    """Pool local (psycopg_pool). Não usar em Workers (depende de threads)."""

    def __init__(
        self,
        conninfo: str,
        *,
        min_size: int = 1,
        max_size: int = 5,
        connect_timeout: float = 5.0,
        statement_timeout_ms: int = 5000,
    ) -> None:
        super().__init__(statement_timeout_ms=statement_timeout_ms)
        from psycopg_pool import ConnectionPool  # noqa: PLC0415 — dependência só fora do Worker

        self._timeout = connect_timeout
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
    def _connection(self) -> Iterator[psycopg.Connection]:
        from psycopg_pool import PoolTimeout  # noqa: PLC0415

        try:
            with self._pool.connection(timeout=self._timeout) as conn:
                yield conn
        except PoolTimeout as exc:
            raise ConnectionUnavailableError() from exc


class DirectDatabase(BaseDatabase):
    """Uma conexão NOVA por transação, fechada ao final (Workers + Hyperdrive).

    Recebe os parâmetros de conexão (``host``, ``port``, ``user``, ``password``, ``dbname``) —
    no Worker, os campos do binding Hyperdrive. Nenhuma conexão é reutilizada entre requisições
    neste processo; o reaproveitamento fica no pool do Hyperdrive, que faz RESET da sessão ao
    devolver a conexão.
    """

    def __init__(
        self,
        conn_kwargs: dict[str, Any],
        *,
        connect_timeout: float = 5.0,
        statement_timeout_ms: int = 5000,
    ) -> None:
        super().__init__(statement_timeout_ms=statement_timeout_ms)
        self._kwargs = {
            **conn_kwargs,
            "prepare_threshold": None,
            "connect_timeout": max(1, int(connect_timeout)),
            "autocommit": False,
        }

    @contextmanager
    def _connection(self) -> Iterator[psycopg.Connection]:
        try:
            conn = psycopg.connect(**self._kwargs)
        except psycopg.OperationalError as exc:
            raise ConnectionUnavailableError() from exc
        try:
            yield conn
        finally:
            conn.close()


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
