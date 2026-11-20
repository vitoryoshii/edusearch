from fastapi import APIRouter

from app import __version__
from app.schemas.common import HealthResponse

router = APIRouter(tags=["infra"])


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    """Verifica se a API está no ar. Não consulta o banco nem expõe configuração."""
    return HealthResponse(status="ok", service="edusearch-api", version=__version__)
