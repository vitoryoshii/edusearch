"""Copia o pacote da API (apps/api/app) para src/app antes de pywrangler dev/deploy.

O Worker empacota só o diretório de src/; a aplicação continua com uma única fonte da verdade
em apps/api/app. Uso: uv run python sync_app.py
"""

import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent / "app"
TARGET = HERE / "src" / "app"

if TARGET.exists():
    shutil.rmtree(TARGET)
shutil.copytree(SOURCE, TARGET, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
print(f"copiado: {SOURCE} -> {TARGET}")
