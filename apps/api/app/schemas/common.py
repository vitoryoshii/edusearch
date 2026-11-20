"""Schemas compartilhados."""

from typing import Literal

from pydantic import BaseModel


class ErrorItem(BaseModel):
    loc: list[str | int]
    msg: str
    type: str


class ErrorResponse(BaseModel):
    """Formato de todo erro da API."""

    detail: str
    code: str
    errors: list[ErrorItem] | None = None


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    version: str
