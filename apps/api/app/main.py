from typing import Literal

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app import __version__
from app.config import get_settings

settings = get_settings()

app = FastAPI(
    title="EduSearch API",
    description="API do EduSearch — Encontre o professor certo para você.",
    version=__version__,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    version: str


@app.get("/health", response_model=HealthResponse, tags=["infra"])
def health() -> HealthResponse:
    """Verifica se a API está no ar."""
    return HealthResponse(status="ok", service="edusearch-api", version=__version__)
