"""Cifragem de segredos guardados pela API (AES-256-GCM, biblioteca ``cryptography``).

* Refresh token do Google Agenda: cifrado com dados associados (AAD) que amarram o texto cifrado
  ao professor e à versão da chave. Copiar o valor para outra linha/conta faz a decifragem falhar.
* ``state`` do OAuth: o mesmo esquema, com AAD própria e prazo de validade embutido. Carrega o
  ``sub`` de quem iniciou a conexão e o ``code_verifier`` do PKCE; nada disso fica legível no
  navegador nem pode ser alterado.

Formato: ``nonce (12 bytes) || texto cifrado || tag (16 bytes)``.
"""

import base64
import json
import os
import time
from typing import Any
from uuid import UUID

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_NONCE_BYTES = 12
STATE_TTL_SECONDS = 600


class DecryptionError(Exception):
    """Texto cifrado inválido, adulterado, de outra conta/versão ou expirado."""


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def generate_key() -> str:
    """Gera uma chave nova (base64url de 32 bytes) para API_TOKEN_ENCRYPTION_KEY."""
    return _b64encode(AESGCM.generate_key(bit_length=256))


class TokenCipher:
    def __init__(self, key_b64: str, *, key_version: int = 1) -> None:
        try:
            key = _b64decode(key_b64.strip())
        except (ValueError, TypeError) as exc:
            raise ValueError("chave de cifragem inválida (base64url)") from exc
        if len(key) != 32:
            raise ValueError("a chave de cifragem precisa ter 32 bytes (AES-256)")
        self._aead = AESGCM(key)
        self.key_version = key_version

    # ------------------------------------------------------------------ refresh token

    def _token_aad(self, owner: UUID, key_version: int) -> bytes:
        return f"edusearch:gcal-refresh:{owner}:v{key_version}".encode()

    def encrypt_token(self, plaintext: str, *, owner: UUID) -> bytes:
        nonce = os.urandom(_NONCE_BYTES)
        aad = self._token_aad(owner, self.key_version)
        return nonce + self._aead.encrypt(nonce, plaintext.encode(), aad)

    def decrypt_token(self, blob: bytes, *, owner: UUID, key_version: int) -> str:
        if key_version != self.key_version:
            # Rotação: só a versão atual é aceita; credenciais antigas pedem reconexão.
            raise DecryptionError("versão de chave diferente")
        if len(blob) <= _NONCE_BYTES + 16:
            raise DecryptionError("texto cifrado curto")
        try:
            data = self._aead.decrypt(
                blob[:_NONCE_BYTES], blob[_NONCE_BYTES:], self._token_aad(owner, key_version)
            )
        except InvalidTag as exc:
            raise DecryptionError("texto cifrado inválido") from exc
        return data.decode()

    # ------------------------------------------------------------------ state do OAuth

    _STATE_AAD = b"edusearch:gcal-oauth-state:v1"

    def seal_state(self, payload: dict[str, Any], *, ttl: int = STATE_TTL_SECONDS) -> str:
        body = {**payload, "exp": int(time.time()) + ttl}
        nonce = os.urandom(_NONCE_BYTES)
        raw = json.dumps(body, separators=(",", ":")).encode()
        return _b64encode(nonce + self._aead.encrypt(nonce, raw, self._STATE_AAD))

    def open_state(self, token: str) -> dict[str, Any]:
        if not token or len(token) > 2048:
            raise DecryptionError("state ausente ou grande demais")
        try:
            blob = _b64decode(token)
            raw = self._aead.decrypt(blob[:_NONCE_BYTES], blob[_NONCE_BYTES:], self._STATE_AAD)
            body = json.loads(raw)
        except (ValueError, InvalidTag) as exc:
            raise DecryptionError("state inválido") from exc
        if not isinstance(body, dict) or int(body.get("exp", 0)) < int(time.time()):
            raise DecryptionError("state expirado")
        return body
