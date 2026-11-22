"""SQL financeiro. Leituras como o USUÁRIO (RLS: participantes). Escritas SEMPRE por funções
private.payment_* (SECURITY DEFINER), chamadas como o papel de conexão: dentro de
``as_connection_role`` (com as claims do usuário) ou de ``service_transaction`` (webhook).
"""

from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg

_SELECT = """
select p.id, p.student_id, p.teacher_id, p.status::text as status,
       p.environment::text as environment,
       p.amount_cents, p.commission_bps, p.commission_cents, p.teacher_share_cents, p.currency,
       p.br_code, p.br_code_image, p.expires_at, p.paid_at, p.split_status::text as split_status,
       p.gateway_charge_id, p.last_checked_at, p.created_at, p.lesson_id,
       l.starts_at, l.ends_at, l.status::text as lesson_status, l.meet_url,
       l.calendar_sync_status::text as calendar_sync_status, s.slug as subject,
       pt.display_name as teacher_name, ps.display_name as student_name,
       r.status::text as refund_status, r.reason as refund_reason, r.created_at as refund_created_at
  from public.payment_intents p
  left join public.lessons l on l.id = p.lesson_id
  left join public.subjects s on s.id = l.subject_id
  left join public.profiles pt on pt.id = p.teacher_id
  left join public.profiles ps on ps.id = p.student_id
  left join lateral (
    select rr.status, rr.reason, rr.created_at from public.refund_requests rr
     where rr.intent_id = p.id order by rr.created_at desc limit 1
  ) r on true
"""


class PaymentsRepository:
    def __init__(self, conn: psycopg.Connection) -> None:
        self._conn = conn

    # ------------------------------------------------------------------ leitura (usuário, RLS)

    def get(self, intent_id: UUID) -> dict[str, Any] | None:
        return self._conn.execute(_SELECT + " where p.id = %s", (intent_id,)).fetchone()

    def list_for(self, user_id: UUID) -> list[dict[str, Any]]:
        return self._conn.execute(
            _SELECT
            + " where %s in (p.student_id, p.teacher_id) order by p.created_at desc limit 100",
            (user_id,),
        ).fetchall()

    def own_payout(self, teacher_id: UUID) -> dict[str, Any] | None:
        return self._conn.execute(
            "select environment::text as environment, tax_id_last4, created_at, status "
            "from public.teacher_payout_accounts where teacher_id = %s",
            (teacher_id,),
        ).fetchone()

    # ------------------------------------------------------------------ escrita (papel de conexão)

    def expire_holds(self) -> int:
        row = self._conn.execute("select private.payment_expire_holds() as n").fetchone()
        return int(row["n"]) if row else 0

    def create_hold(
        self,
        *,
        teacher_id: UUID,
        subject_id: int,
        starts_at: datetime,
        ends_at: datetime,
        key: UUID,
        environment: str,
        hold_seconds: int,
    ) -> dict[str, Any]:
        row = self._conn.execute(
            "select * from private.payment_create_hold(%s, %s::smallint, %s, %s, %s, "
            "%s::public.payment_environment, %s)",
            (teacher_id, subject_id, starts_at, ends_at, key, environment, hold_seconds),
        ).fetchone()
        assert row is not None  # noqa: S101 — a função sempre devolve uma linha ou levanta
        return row

    def attach_charge(
        self,
        intent_id: UUID,
        *,
        charge_id: str,
        br_code: str | None,
        image: str | None,
        fee: int | None,
        expires_at: datetime | None,
    ) -> None:
        self._conn.execute(
            "select private.payment_attach_charge(%s, %s, %s, %s, %s, %s)",
            (intent_id, charge_id, br_code, image, fee, expires_at),
        )

    def mark_failed(self, intent_id: UUID, detail: str) -> None:
        self._conn.execute("select private.payment_mark_failed(%s, %s)", (intent_id, detail[:200]))

    def touch_checked(self, intent_id: UUID) -> None:
        self._conn.execute("select private.payment_touch_checked(%s)", (intent_id,))

    def set_split(self, intent_id: UUID, sacc: str | None, amount: int, status: str) -> None:
        self._conn.execute(
            "select private.payment_set_split(%s, %s, %s, %s::public.split_status)",
            (intent_id, sacc, amount, status),
        )

    def payout_account_of(self, teacher_id: UUID, environment: str) -> str | None:
        row = self._conn.execute(
            "select private.payout_account_of(%s, %s::public.payment_environment) as sacc",
            (teacher_id, environment),
        ).fetchone()
        return row["sacc"] if row else None

    def payout_upsert(self, sacc: str, last4: str, environment: str) -> None:
        self._conn.execute(
            "select private.payout_account_upsert(%s, %s, %s::public.payment_environment)",
            (sacc, last4, environment),
        )

    # ------------------------------------------------------------------ webhook / conciliação

    def record_webhook(
        self, event_id: str, event_type: str, charge_id: str | None, dev: bool, sha: str
    ) -> bool:
        row = self._conn.execute(
            "select private.payment_record_webhook(%s, %s, %s, %s, %s) as first",
            (event_id, event_type, charge_id, dev, sha),
        ).fetchone()
        return bool(row and row["first"])

    def finish_webhook(self, event_id: str, outcome: str) -> None:
        self._conn.execute("select private.payment_finish_webhook(%s, %s)", (event_id, outcome))

    def confirm(self, charge_id: str, paid_amount: int, source: str) -> dict[str, Any]:
        row = self._conn.execute(
            "select * from private.payment_confirm(%s, %s, %s)", (charge_id, paid_amount, source)
        ).fetchone()
        assert row is not None  # noqa: S101
        return row

    def close_unpaid(self, charge_id: str, status: str, source: str) -> str:
        row = self._conn.execute(
            "select private.payment_close_unpaid(%s, %s::public.payment_status, %s) as r",
            (charge_id, status, source),
        ).fetchone()
        return str(row["r"]) if row else "unknown"

    def mark_after_paid(self, charge_id: str, status: str, source: str) -> str:
        row = self._conn.execute(
            "select private.payment_mark_after_paid(%s, %s::public.payment_status, %s) as r",
            (charge_id, status, source),
        ).fetchone()
        return str(row["r"]) if row else "unknown"
