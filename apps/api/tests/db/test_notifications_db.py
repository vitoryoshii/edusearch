"""Outbox privada: o browser não pode inspecionar nem alterar notificações."""


def test_notification_outbox_is_private_and_api_only(admin) -> None:
    table = "private.notification_outbox"
    row = admin.execute(
        "select has_table_privilege('anon', %s, 'select') as anon_read, "
        "has_table_privilege('authenticated', %s, 'insert') as user_write, "
        "has_table_privilege('edusearch_api', %s, 'select') as api_read",
        (table, table, table),
    ).fetchone()
    assert row == {"anon_read": False, "user_write": False, "api_read": False}
    fn = "private.notification_enqueue(text,uuid,uuid,text,text,jsonb,text)"
    can = admin.execute(
        "select has_function_privilege('anon', %s, 'execute') as anon, "
        "has_function_privilege('authenticated', %s, 'execute') as authenticated, "
        "has_function_privilege('edusearch_api', %s, 'execute') as api",
        (fn, fn, fn),
    ).fetchone()
    assert can == {"anon": False, "authenticated": False, "api": True}


def test_notification_outbox_deduplicates_and_claims_once(admin) -> None:
    key = "notification-test-idempotency"
    try:
        first = admin.execute(
            "select private.notification_enqueue(%s, null, null, %s, %s, %s::jsonb, %s) as id",
            (
                "booking.created",
                "notify@example.com",
                "edusearch-boas-vindas-aluno-v1",
                '{"NOME":"A"}',
                key,
            ),
        ).fetchone()["id"]
        second = admin.execute(
            "select private.notification_enqueue(%s, null, null, %s, %s, %s::jsonb, %s) as id",
            (
                "booking.created",
                "notify@example.com",
                "edusearch-boas-vindas-aluno-v1",
                '{"NOME":"A"}',
                key,
            ),
        ).fetchone()["id"]
        assert first == second
        claimed = admin.execute("select id from private.notification_claim(10, 60)").fetchall()
        assert [r["id"] for r in claimed] == [first]
        assert admin.execute("select id from private.notification_claim(10, 60)").fetchall() == []
    finally:
        admin.execute("delete from private.notification_outbox where idempotency_key = %s", (key,))


def test_recipient_confirmation_controls_enqueue_without_blocking_business_event(
    admin, users
) -> None:
    unconfirmed = users.create("Sem confirmação", email_confirmed=False)
    confirmed = users.create("Com confirmação", email_confirmed=True)
    key = f"recipient-test-{confirmed.hex}"
    try:
        absent = admin.execute(
            "select private.notification_enqueue_for_user(%s, null, %s, %s, %s::jsonb, %s) as id",
            (
                "onboarding.student_completed",
                unconfirmed,
                "edusearch-boas-vindas-aluno-v1",
                '{"NOME":"A"}',
                key + "-u",
            ),
        ).fetchone()["id"]
        assert absent is None
        first = admin.execute(
            "select private.notification_enqueue_for_user(%s, null, %s, %s, %s::jsonb, %s) as id",
            (
                "onboarding.student_completed",
                confirmed,
                "edusearch-boas-vindas-aluno-v1",
                '{"NOME":"B"}',
                key,
            ),
        ).fetchone()["id"]
        second = admin.execute(
            "select private.notification_enqueue_for_user(%s, null, %s, %s, %s::jsonb, %s) as id",
            (
                "onboarding.student_completed",
                confirmed,
                "edusearch-boas-vindas-aluno-v1",
                '{"NOME":"B"}',
                key,
            ),
        ).fetchone()["id"]
        assert first == second
    finally:
        admin.execute(
            "delete from private.notification_outbox where idempotency_key like %s", (key + "%",)
        )
