# EduSearch API

API Python/FastAPI do EduSearch. Nesta fase expõe apenas `GET /health`.

## Executar localmente

```bash
cd apps/api
python -m venv .venv
# Windows: .venv\Scripts\activate   |   Linux/macOS: source .venv/bin/activate
pip install -e ".[dev]"
uvicorn app.main:app --reload --port 8000
```

- Health check: <http://localhost:8000/health>
- Documentação interativa: <http://localhost:8000/docs>

## Testes e lint

```bash
pytest
ruff check .
```

## Configuração

| Variável           | Padrão                                        | Descrição                       |
| ------------------ | --------------------------------------------- | ------------------------------- |
| `API_CORS_ORIGINS` | `http://localhost:5173,http://localhost:5174` | Origens liberadas no CORS (dev) |
