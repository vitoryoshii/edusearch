"""Fase 4A — catálogo do marketplace com banco real (edusearch_api + RLS).

Professores não publicados nunca aparecem; filtros usam só dados reais do cadastro; paginação
estável; perfil público sem preço/avaliação; permissões por papel.
"""

import uuid

import pytest

from tests.db.test_scheduling_db import (  # noqa: F401 — fixtures reutilizadas
    FULL_WEEK,
    auth,
    cipher,
    client,
    google,
    make_client,
    people,
    publish,
)
from tests.test_onboarding_api import TEACHER


def make_teacher(
    client, users, make_token, admin, name, *, published=True, windows=None, **profile
):
    uid = users.create(name)
    tk = make_token(uid)
    assert (
        client.post("/v1/me/roles", json={"role": "teacher"}, headers=auth(tk)).status_code == 201
    )
    r = client.put("/v1/me/teacher-profile", json={**TEACHER, **profile}, headers=auth(tk))
    assert r.status_code == 200, r.text
    if windows is not None:
        r = client.put("/v1/me/availability", json={"windows": windows}, headers=auth(tk))
        assert r.status_code == 200, r.text
    if published:
        publish(admin, uid)
    return uid, tk


def ids(resp) -> list[str]:
    assert resp.status_code == 200, resp.text
    return [t["id"] for t in resp.json()]


def test_unpublished_teacher_is_never_visible(client, people, users, make_token, admin) -> None:
    hidden, hidden_tk = make_teacher(
        client, users, make_token, admin, "Prof Pendente", published=False, windows=FULL_WEEK
    )
    st = people["tokens"][people["s1"]]
    assert str(hidden) not in ids(client.get("/v1/teachers", headers=auth(st)))
    assert str(hidden) not in ids(client.get("/v1/teachers?q=Pendente", headers=auth(st)))
    assert (
        client.get(f"/v1/teachers/{hidden}", headers=auth(st)).json()["code"] == "teacher_not_found"
    )
    # O próprio professor pré-visualiza o perfil (ainda não publicado).
    own = client.get(f"/v1/teachers/{hidden}", headers=auth(hidden_tk)).json()
    assert own["is_own_profile"] is True and own["is_published"] is False


def test_public_profile_has_only_real_fields(client, people) -> None:
    st = people["tokens"][people["s1"]]
    r = client.get(f"/v1/teachers/{people['teacher']}", headers=auth(st))
    assert r.status_code == 200
    body = r.json()
    assert (
        body["bio"] == TEACHER["bio"]
        and body["academic_background"] == TEACHER["academic_background"]
    )
    assert body["subjects"] == ["matematica"] and body["teaching_methods"] == [
        "exercicios",
        "pratica",
    ]
    assert body["is_own_profile"] is False and body["is_published"] is True
    for forbidden in ("price_cents", "rating", "reviews", "verification_status", "email"):
        assert forbidden not in body
    card = client.get("/v1/teachers", headers=auth(st)).json()[0]
    assert "price_cents" not in card and "rating" not in card
    assert card["next_slot"] is not None  # disponibilidade total no fixture


def test_search_by_name_and_subject_with_literal_wildcards(
    client, people, users, make_token, admin
) -> None:
    fis, _ = make_teacher(
        client, users, make_token, admin, "Bruno Física", subjects=["fisica"], windows=FULL_WEEK
    )
    st = people["tokens"][people["s1"]]
    assert ids(client.get("/v1/teachers?q=bruno", headers=auth(st))) == [str(fis)]
    assert ids(client.get("/v1/teachers?q=Matem", headers=auth(st))) == [str(people["teacher"])]
    assert set(ids(client.get("/v1/teachers?q=%25", headers=auth(st)))) == set()  # "%" é literal
    assert ids(client.get("/v1/teachers?subject=fisica", headers=auth(st))) == [str(fis)]
    assert client.get("/v1/teachers?q=", headers=auth(st)).status_code == 422


def test_modality_period_and_availability_filters(client, people, users, make_token, admin) -> None:
    st = people["tokens"][people["s1"]]
    morning = [{"weekday": "seg", "start": "08:00", "end": "11:00"}]
    pres, _ = make_teacher(
        client, users, make_token, admin, "Carla Presencial", modality="presencial", windows=morning
    )
    hib, _ = make_teacher(
        client, users, make_token, admin, "Davi Híbrido", modality="hibrido", windows=[]
    )
    online = str(people["teacher"])  # online, semana inteira

    assert set(ids(client.get("/v1/teachers?modality=presencial", headers=auth(st)))) == {
        str(pres),
        str(hib),
    }
    assert set(ids(client.get("/v1/teachers?modality=online", headers=auth(st)))) == {
        online,
        str(hib),
    }
    assert set(ids(client.get("/v1/teachers?period=manha", headers=auth(st)))) == {
        online,
        str(pres),
    }
    assert set(ids(client.get("/v1/teachers?period=noite", headers=auth(st)))) == {online}
    # Sem janelas → sem próximo horário e fora do filtro "com horário livre".
    available = ids(client.get("/v1/teachers?available_only=true", headers=auth(st)))
    assert str(hib) not in available and online in available
    davi = next(
        t for t in client.get("/v1/teachers", headers=auth(st)).json() if t["id"] == str(hib)
    )
    assert davi["next_slot"] is None


def test_pagination_is_stable_and_bounded(client, people, users, make_token, admin) -> None:
    st = people["tokens"][people["s1"]]
    for n in range(3):
        make_teacher(client, users, make_token, admin, f"Zeta {n}", windows=FULL_WEEK)
    everyone = ids(client.get("/v1/teachers?limit=50", headers=auth(st)))
    pages = ids(client.get("/v1/teachers?limit=2&offset=0", headers=auth(st))) + ids(
        client.get("/v1/teachers?limit=2&offset=2", headers=auth(st))
    )
    assert pages == everyone[:4] and len(set(everyone)) == len(everyone)
    assert ids(client.get("/v1/teachers?limit=2&offset=1000", headers=auth(st))) == []
    for bad in (
        "limit=0",
        "limit=51",
        "offset=-1",
        "modality=ead",
        "period=madrugada",
        "subject=Física",
    ):
        assert client.get(f"/v1/teachers?{bad}", headers=auth(st)).status_code == 422, bad


def test_catalog_permissions(client, make_client, people, users, make_token) -> None:
    teacher_tk = people["tokens"][people["teacher"]]
    r = client.get("/v1/teachers", headers=auth(teacher_tk))
    assert r.status_code == 403 and r.json()["code"] == "role_required"
    # Professor só vê o perfil de OUTRO professor sendo aluno.
    other = people["s1"]
    assert client.get(f"/v1/teachers/{other}", headers=auth(teacher_tk)).status_code == 403
    assert (
        client.get(
            f"/v1/teachers/{uuid.uuid4()}", headers=auth(people["tokens"][people["s1"]])
        ).status_code
        == 404
    )
    assert client.get("/v1/teachers").status_code == 401
    off = make_client(stage="off")
    assert (
        off.get("/v1/teachers", headers=auth(people["tokens"][people["s1"]])).json()["code"]
        == "scheduling_disabled"
    )


@pytest.mark.parametrize(
    "path", ["/v1/teachers", "/v1/teachers?q=x&subject=fisica&modality=online&period=tarde"]
)
def test_catalog_never_leaks_unpublished_via_filters(
    client, people, users, make_token, admin, path
) -> None:
    hidden, _ = make_teacher(
        client,
        users,
        make_token,
        admin,
        "x Oculto",
        subjects=["fisica"],
        published=False,
        windows=FULL_WEEK,
    )
    assert str(hidden) not in ids(client.get(path, headers=auth(people["tokens"][people["s1"]])))
