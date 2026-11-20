"""Roda os lints do Security/Performance Advisor (supabase/splinter) num banco DESCARTÁVEL.

Uso (CI):  python scripts/security_advisor.py <DATABASE_URL> <caminho/para/splinter.sql>

* Executa dentro de uma transação e faz ROLLBACK (não altera nada).
* Falha (exit 1) se houver lint de nível ERROR ou WARN. INFO só é listado.
* O splinter.sql é baixado no CI de um commit FIXO e conferido por SHA-256
  (.github/workflows/backend-ci.yml). Nunca rode contra o banco de produção.
"""

import sys
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

FAIL_LEVELS = {"ERROR", "WARN"}


def main(url: str, sql_path: str) -> int:
    sql = Path(sql_path).read_text(encoding="utf-8")
    with psycopg.connect(url, row_factory=dict_row) as conn:
        try:
            cur = conn.execute(sql)  # type: ignore[arg-type] — SQL de lints, sem parâmetros
            while cur.description is None and cur.nextset():
                pass
            rows = cur.fetchall() if cur.description else []
        finally:
            conn.rollback()

    failing = [r for r in rows if r["level"] in FAIL_LEVELS]
    for r in rows:
        mark = "✗" if r["level"] in FAIL_LEVELS else "·"
        print(f"{mark} [{r['level']}] {r['name']}: {r['detail']}")
    print(f"\n{len(rows)} achado(s); {len(failing)} de nível ERROR/WARN.")
    return 1 if failing else 0


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1], sys.argv[2]))
