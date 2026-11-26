"""Inspeção do conteúdo real de documentos de credenciamento.

O MIME do navegador e os metadados do Storage não são confiáveis: o arquivo é baixado com o token
do PRÓPRIO titular (a RLS do Storage restringe ao dono), e o tipo é determinado pela assinatura
binária. Calcula SHA-256 (duplicidade), aplica limite de tamanho e recusa PDF criptografado ou com
conteúdo ativo. Nenhum documento é enviado a terceiros nem a provedores de IA.
"""

import hashlib
from dataclasses import dataclass
from urllib.parse import quote

import httpx

MAX_BYTES = 10 * 1024 * 1024
BUCKET = "teacher-verification"

_PDF_ACTIVE = (b"/JavaScript", b"/JS ", b"/JS(", b"/Launch", b"/EmbeddedFile", b"/RichMedia")


@dataclass(frozen=True)
class InspectionResult:
    ok: bool
    code: str
    detected_content_type: str | None = None
    sha256: str | None = None
    size: int = 0
    signature_present: bool = False


class InspectionUnavailableError(Exception):
    """Storage indisponível: o cliente deve tentar novamente."""


class DocumentNotFoundError(Exception):
    """Objeto inexistente ou não pertencente ao titular."""


def detect_content_type(data: bytes) -> str | None:
    if data.startswith(b"%PDF-"):
        return "application/pdf"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    return None


def inspect_bytes(data: bytes) -> InspectionResult:
    size = len(data)
    if size == 0:
        return InspectionResult(False, "inspection.empty")
    if size > MAX_BYTES:
        return InspectionResult(False, "inspection.too_large", size=size)
    detected = detect_content_type(data)
    if detected is None:
        return InspectionResult(False, "inspection.unknown_format", size=size)
    tail = data[-2048:]
    signature = False
    if detected == "application/pdf":
        if b"%%EOF" not in tail:
            return InspectionResult(False, "inspection.pdf_truncated", detected, size=size)
        if b"/Encrypt" in data:
            return InspectionResult(False, "inspection.pdf_encrypted", detected, size=size)
        if any(marker in data for marker in _PDF_ACTIVE):
            return InspectionResult(False, "inspection.pdf_active_content", detected, size=size)
        signature = b"/ByteRange" in data and b"/Sig" in data
    elif detected == "image/png" and b"IEND" not in tail:
        return InspectionResult(False, "inspection.image_truncated", detected, size=size)
    elif detected == "image/jpeg" and b"\xff\xd9" not in tail:
        return InspectionResult(False, "inspection.image_truncated", detected, size=size)
    return InspectionResult(
        True,
        "inspection.content_verified",
        detected,
        hashlib.sha256(data).hexdigest(),
        size,
        signature,
    )


class StorageDocumentInspector:
    """Baixa o objeto do bucket privado com o token do titular e inspeciona o conteúdo."""

    def __init__(
        self,
        supabase_url: str,
        publishable_key: str,
        *,
        timeout: float = 10.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._base = supabase_url.rstrip("/")
        self._key = publishable_key
        self._timeout = timeout
        self._transport = transport

    def inspect(self, storage_path: str, user_token: str) -> InspectionResult:
        url = f"{self._base}/storage/v1/object/authenticated/{BUCKET}/{quote(storage_path)}"
        headers = {"Authorization": f"Bearer {user_token}", "apikey": self._key}
        try:
            with (
                httpx.Client(
                    timeout=self._timeout, transport=self._transport, follow_redirects=False
                ) as client,
                client.stream("GET", url, headers=headers) as response,
            ):
                if response.status_code in {400, 401, 403, 404}:
                    raise DocumentNotFoundError
                if response.status_code != 200:
                    raise InspectionUnavailableError(f"http_{response.status_code}")
                chunks: list[bytes] = []
                total = 0
                for chunk in response.iter_bytes():
                    total += len(chunk)
                    if total > MAX_BYTES:
                        return InspectionResult(False, "inspection.too_large", size=total)
                    chunks.append(chunk)
        except httpx.HTTPError as exc:
            raise InspectionUnavailableError(exc.__class__.__name__) from exc
        return inspect_bytes(b"".join(chunks))
