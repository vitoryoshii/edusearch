"""Contratos de ``/v1/me`` (ver docs/api-contract.md)."""

import re
import unicodedata
from datetime import datetime
from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

AccountRole = Literal["student", "teacher"]
ProfileStatus = Literal["onboarding", "active", "suspended"]

_CONTROL_CHARS = re.compile("[\x00-\x1f\x7f-\x9f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]")


class MeResponse(BaseModel):
    """Dados do usuário autenticado. Somente o que ele próprio pode ver."""

    id: UUID
    email: str | None = Field(
        description="E-mail do token verificado (não é armazenado em profiles)."
    )
    display_name: str
    avatar_url: str | None
    status: ProfileStatus
    roles: list[AccountRole]
    created_at: datetime
    updated_at: datetime


class ProfileUpdate(BaseModel):
    """Campos editáveis pelo próprio usuário. Qualquer outro campo é recusado (422)."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    display_name: str = Field(min_length=1, max_length=80)
    avatar_url: str | None = Field(default=None, max_length=2048)

    @field_validator("display_name")
    @classmethod
    def _clean_name(cls, value: str) -> str:
        value = unicodedata.normalize("NFC", value)
        if _CONTROL_CHARS.search(value):
            raise ValueError("o nome não pode conter caracteres de controle")
        value = re.sub(r"\s+", " ", value).strip()
        if not value:
            raise ValueError("o nome não pode ficar vazio")
        return value

    @field_validator("avatar_url")
    @classmethod
    def _check_avatar(cls, value: str | None) -> str | None:
        # O host permitido (Google/Storage do projeto) é conferido no serviço, que conhece a config.
        if value is None or value == "":
            return None
        if any(ch.isspace() for ch in value) or _CONTROL_CHARS.search(value):
            raise ValueError("URL inválida")
        parts = urlsplit(value)
        if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
            raise ValueError("a foto precisa ser um endereço https")
        if parts.port not in (None, 443):
            raise ValueError("porta não permitida")
        return value


def avatar_host_allowed(url: str, allowed_suffixes: list[str]) -> bool:
    host = (urlsplit(url).hostname or "").lower()
    return any(host == s or host.endswith("." + s) for s in allowed_suffixes)
