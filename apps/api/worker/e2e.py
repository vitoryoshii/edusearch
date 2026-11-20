"""Teste de ponta a ponta da API implantada (ou do ``pywrangler dev``) — SEM mocks de API/banco.

Dois modos:

* ``local``: sobe um JWKS em 127.0.0.1:54400, cria dois usuários fictícios direto no Postgres
  descartável (``E2E_ADMIN_DATABASE_URL``) e assina tokens ES256. O Worker local deve rodar com
  ``--var API_SUPABASE_URL:http://127.0.0.1:54400``. Valida o runtime Workers + psycopg +
  Hyperdrive (modo local) + RLS.
* ``remote``: usa tokens REAIS do Supabase de duas contas adultas de teste
  (``E2E_TOKEN_A`` e ``E2E_TOKEN_B``, obtidos por login; nunca commitados). Nenhum acesso
  administrativo ao banco.

Uso:
  python e2e.py local  http://127.0.0.1:8787
  E2E_TOKEN_A=... E2E_TOKEN_B=... python e2e.py remote https://edusearch-api-staging.<conta>.workers.dev

Os tokens e os dados dos usuários não são impressos. Saída: verificações ✓/✗ e métricas.
"""

import base64
import json
import math
import os
import statistics
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx

failures: list[str] = []
latencies: dict[str, list[float]] = {}


def check(ok: bool, msg: str, detail: object = "") -> None:
    if ok:
        print(f"  ✓ {msg}")
    else:
        failures.append(msg)
        print(f"  ✗ {msg} {str(detail)[:300]}")


class Api:
    def __init__(self, base: str) -> None:
        self.client = httpx.Client(base_url=base.rstrip("/"), timeout=60)

    def call(self, method: str, path: str, token: str | None = None, **kw) -> httpx.Response:
        headers = kw.pop("headers", {})
        if token:
            headers["Authorization"] = f"Bearer {token}"
        t0 = time.perf_counter()
        r = self.client.request(method, path, headers=headers, **kw)
        route = path.split("?", 1)[0]  # sem query string (pode conter ids)
        latencies.setdefault(f"{method} {route}", []).append((time.perf_counter() - t0) * 1000)
        return r


STUDENT = {
    "learning_goal": "Passar no ENEM (conta de teste)",
    "education_level": "medio",
    "subjects": ["matematica", "fisica"],
    "difficulty_areas": ["exercicios"],
    "preferred_weekdays": ["seg", "qua"],
    "preferred_periods": ["noite"],
    "preferred_modality": "online",
    "budget_min_cents": 5000,
    "budget_max_cents": 8000,
}
TEACHER = {
    "bio": "Professor fictício de física para validação técnica da plataforma.",
    "subjects": ["fisica"],
    "specialties": "Mecânica",
    "academic_background": "Licenciatura em Física (teste)",
    "experience": "3-5",
    "teaching_methods": ["exercicios", "pratica"],
    "methodology": None,
    "price_cents": 9550,
    "lesson_durations_minutes": [60, 45],
    "modality": "online",
    "available_weekdays": ["ter"],
    "available_periods": ["tarde"],
}


# ------------------------------------------------------------------------------- modo local


def local_setup() -> tuple[str, str, str, str, object]:
    import jwt  # noqa: PLC0415
    import psycopg  # noqa: PLC0415
    from cryptography.hazmat.primitives.asymmetric import ec  # noqa: PLC0415
    from jwt.algorithms import ECAlgorithm  # noqa: PLC0415

    key = ec.generate_private_key(ec.SECP256R1())
    jwk = json.loads(ECAlgorithm.to_jwk(key.public_key()))
    jwk.update({"kid": "e2e-local", "alg": "ES256", "use": "sig"})
    body = json.dumps({"keys": [jwk]}).encode()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            self.send_response(200 if self.path.endswith("/jwks.json") else 404)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 54400), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    issuer = "http://127.0.0.1:54400/auth/v1"

    ids = [uuid.uuid4(), uuid.uuid4()]
    with psycopg.connect(os.environ["E2E_ADMIN_DATABASE_URL"], autocommit=True) as conn:
        for i, uid in enumerate(ids):
            conn.execute(
                "insert into auth.users (id, email, raw_user_meta_data) values (%s, %s, %s)",
                (
                    uid,
                    f"e2e+{uid.hex[:8]}@example.com",
                    json.dumps({"full_name": f"Teste E2E {'AB'[i]}"}),
                ),
            )

    def token(uid, **extra):
        now = int(time.time())
        claims = {
            "iss": issuer,
            "aud": "authenticated",
            "sub": str(uid),
            "role": "authenticated",
            "iat": now - 5,
            "exp": now + 3600,
            "email": "e2e@example.com",
            **extra,
        }
        return jwt.encode(claims, key, algorithm="ES256", headers={"kid": "e2e-local"})

    def cleanup():
        with psycopg.connect(os.environ["E2E_ADMIN_DATABASE_URL"], autocommit=True) as conn:
            conn.execute("delete from auth.users where id = any(%s)", (ids,))
        server.shutdown()

    expired = token(ids[0], exp=int(time.time()) - 3600)
    return token(ids[0]), token(ids[1]), expired, str(ids[0]), cleanup


# ------------------------------------------------------------------------------- cenário


def forge(token: str) -> str:
    """Troca o "sub" do payload sem reassinar (deve ser recusado)."""
    h, p, s = token.split(".")
    claims = json.loads(base64.urlsafe_b64decode(p + "=="))
    claims["sub"] = str(uuid.uuid4())
    p2 = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=").decode()
    return f"{h}.{p2}.{s}"


def run(api: Api, a: str, b: str, expired: str | None) -> None:
    print("Infra")
    r = api.call("GET", "/health")
    check(r.status_code == 200 and r.json().get("status") == "ok", "GET /health")
    r = api.call("GET", "/v1/subjects")
    check(r.status_code == 200 and len(r.json()) >= 8, "GET /v1/subjects (anon, RLS)")
    check(r.headers.get("cache-control") == "no-store", "respostas /v1 com Cache-Control: no-store")

    print("Autenticação")
    check(api.call("GET", "/v1/me").status_code == 401, "sem token → 401")
    check(api.call("GET", "/v1/me", "abc.def.ghi").status_code == 401, "token malformado → 401")
    check(
        api.call("GET", "/v1/me", forge(a)).status_code == 401,
        "payload alterado (sub de outro) → 401",
    )
    if expired:
        r = api.call("GET", "/v1/me", expired)
        check(
            r.status_code == 401 and r.json().get("code") == "token_expired",
            "token expirado → 401 token_expired",
        )

    me_a = api.call("GET", "/v1/me", a)
    me_b = api.call("GET", "/v1/me", b)
    check(
        me_a.status_code == 200 and me_b.status_code == 200,
        "GET /v1/me para A e B",
        (me_a.text, me_b.text),
    )
    ida, idb = me_a.json()["id"], me_b.json()["id"]
    check(ida != idb, "A e B são contas distintas")

    print("Papéis e cadastros")
    r = api.call("GET", "/v1/me/student-profile", a)
    check(
        r.status_code in (403, 404, 200),
        "GET student-profile responde (403 sem papel / 404 sem cadastro)",
    )
    r = api.call("POST", "/v1/me/roles", a, json={"role": "admin"})
    check(r.status_code == 422, "papel 'admin' → 422")
    r = api.call("POST", "/v1/me/roles", a, json={"role": "student"})
    check(
        r.status_code in (200, 201) and "student" in r.json()["roles"], "A escolhe aluno (201/200)"
    )
    r = api.call("POST", "/v1/me/roles", a, json={"role": "student"})
    check(r.status_code == 200, "seleção de papel idempotente (200)")
    r = api.call(
        "PUT", "/v1/me/student-profile", a, json={**STUDENT, "verification_status": "approved"}
    )
    check(r.status_code == 422, "campo do servidor no corpo → 422")
    r = api.call("PUT", "/v1/me/student-profile", a, json={**STUDENT, "subjects": ["alquimia"]})
    check(
        r.status_code == 422 and r.json().get("code") == "unknown_subject",
        "disciplina inexistente → 422",
    )
    r = api.call("PUT", "/v1/me/student-profile", a, json=STUDENT)
    check(r.status_code == 200, "A salva cadastro de aluno", r.text)
    r = api.call("GET", "/v1/me/student-profile", a)
    check(
        r.status_code == 200 and r.json()["learning_goal"] == STUDENT["learning_goal"],
        "A recupera o cadastro (persistido)",
    )

    r = api.call("PUT", "/v1/me/teacher-profile", b, json=TEACHER)
    check(
        r.status_code == 403 and r.json().get("code") == "role_required",
        "B sem papel de professor → 403",
    )
    api.call("POST", "/v1/me/roles", b, json={"role": "teacher"})
    r = api.call("GET", "/v1/me/teacher-profile", b)
    check(r.status_code in (200, 404), "GET teacher-profile (404 antes de salvar)")
    r = api.call("PUT", "/v1/me/teacher-profile", b, json=TEACHER)
    body = r.json() if r.status_code == 200 else {}
    check(
        r.status_code == 200
        and body.get("verification_status") in ("pending", "approved", "rejected"),
        "B salva cadastro de professor",
        r.text,
    )
    check(
        body.get("is_published") is False or body.get("verification_status") == "approved",
        "professor não aprovado continua NÃO publicado",
    )
    check(body.get("lesson_duration_minutes") == 45, "duração principal = menor oferecida")

    print("Isolamento")
    r = api.call("GET", "/v1/me/student-profile", b)
    check(r.status_code in (403, 404), "B não lê o cadastro de aluno de A", r.status_code)
    r = api.call("GET", f"/v1/me/student-profile?user_id={ida}", b)
    check(r.status_code in (403, 404), "parâmetro user_id é ignorado (B continua sem acesso)")
    r = api.call("PUT", "/v1/me/student-profile", b, json=STUDENT)
    check(r.status_code == 403, "B não grava cadastro de aluno sem papel")
    r = api.call("GET", "/v1/me/student-profile", a)
    check(
        r.status_code == 200 and r.json()["learning_goal"] == STUDENT["learning_goal"],
        "dados de A intactos após tentativas de B",
    )

    print("Nome e foto")
    r = api.call(
        "PUT", "/v1/me/profile", b, json={"display_name": "Teste B Atualizado", "avatar_url": None}
    )
    check(
        r.status_code == 200 and r.json()["display_name"] == "Teste B Atualizado",
        "PUT /v1/me/profile",
    )
    r = api.call("PUT", "/v1/me/profile", b, json={"display_name": "X", "status": "active"})
    check(r.status_code == 422, "status no corpo → 422 (sem escalonamento)")
    check(
        api.call("GET", "/v1/me", a).json()["display_name"] != "Teste B Atualizado",
        "nome de B não afeta A",
    )

    print("Concorrência (requisições intercaladas A/B)")

    def who(i: int) -> tuple[int, str]:
        tok, expected = (a, ida) if i % 2 == 0 else (b, idb)
        resp = api.call("GET", "/v1/me", tok)
        return i, "ok" if resp.status_code == 200 and resp.json()[
            "id"
        ] == expected else f"ERRADO {resp.status_code}"

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(who, range(40)))
    bad = [r for r in results if r[1] != "ok"]
    check(not bad, "40 requisições concorrentes: cada uma recebe SÓ a própria conta", bad[:3])


def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] not in ("local", "remote"):
        print(__doc__)
        return 2
    mode, base = sys.argv[1], sys.argv[2]
    api = Api(base)
    cleanup = None
    if mode == "local":
        a, b, expired, _, cleanup = local_setup()
    else:
        a, b, expired = os.environ["E2E_TOKEN_A"], os.environ["E2E_TOKEN_B"], None
    try:
        run(api, a, b, expired)
    finally:
        if cleanup:
            cleanup()
    print("\nLatência (ms): rota → n, mediana, p95, máx")
    for route, values in sorted(latencies.items()):
        values.sort()
        p95 = values[min(len(values) - 1, math.ceil(len(values) * 0.95) - 1)]
        print(
            f"  {route:42s} n={len(values):3d} med={statistics.median(values):7.1f} p95={p95:7.1f} max={values[-1]:7.1f}"
        )
    print(f"\n{len(failures)} falha(s)" if failures else "\nTodas as verificações passaram.")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
