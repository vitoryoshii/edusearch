"""Configuração da API, lida de variáveis de ambiente (prefixo ``API_``) ou de ``.env``.

Nenhum segredo tem valor padrão. Ver ``apps/api/.env.example``.
"""

from functools import lru_cache
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Algoritmos assimétricos aceitos. HS256 (segredo compartilhado legado) e "none" nunca são aceitos.
_ALLOWED_JWT_ALGORITHMS = frozenset({"ES256", "RS256", "EdDSA"})


def _split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="API_", extra="ignore")

    environment: str = "development"

    # CORS: origens EXATAS separadas por vírgula. Curinga não é aceito.
    cors_origins: str = "http://localhost:5173,http://localhost:5174,http://localhost:5190"

    # Supabase Auth. Ex.: https://pgltvnwdvatyihrozlvn.supabase.co
    supabase_url: str | None = None
    jwt_audience: str = "authenticated"
    jwt_algorithms: str = "ES256"
    jwt_leeway_seconds: int = Field(default=10, ge=0, le=60)
    # A documentação do Supabase pede para não guardar o JWKS por mais de 10 minutos.
    jwks_cache_seconds: int = Field(default=600, ge=30, le=600)
    jwks_min_refresh_seconds: int = Field(default=30, ge=1, le=300)
    jwks_timeout_seconds: float = Field(default=5.0, gt=0, le=30)

    # PostgreSQL. O papel de conexão precisa poder "SET ROLE authenticated"
    # (ver docs/database-design.md).
    database_url: SecretStr | None = None
    db_pool_min_size: int = Field(default=1, ge=0, le=20)
    db_pool_max_size: int = Field(default=5, ge=1, le=50)
    db_connect_timeout_seconds: float = Field(default=5.0, gt=0, le=60)
    db_statement_timeout_ms: int = Field(default=5000, ge=100, le=60000)

    # Hosts aceitos para avatar_url (sufixos). A foto do Google e o Storage do projeto.
    avatar_allowed_host_suffixes: str = "googleusercontent.com"

    enable_docs: bool = True

    # ------------------------------------------------------------------ agenda (Fase 3A)
    # off (padrão): rotas de agenda/aulas respondem 403 "scheduling_disabled".
    # testing: liberadas para as contas de teste (o controle de admissão já restringe quem entra).
    # Não há "production": aulas comerciais e pagamentos seguem desabilitados nesta fase.
    scheduling_stage: str = "off"

    # Google Agenda/Meet: o MESMO cliente OAuth (Web) do login, com fluxo SEPARADO (código + PKCE)
    # e escopo mínimo. O segredo só existe no servidor.
    google_oauth_client_id: str | None = None
    google_oauth_client_secret: SecretStr | None = None
    # URI de retorno EXATA cadastrada no Google Cloud (página do app que repassa o código à API).
    google_oauth_redirect_uri: str | None = None
    # Chave AES-256 (32 bytes em base64url) que cifra o refresh token. Fora do banco e do Git.
    token_encryption_key: SecretStr | None = None
    token_encryption_key_version: int = Field(default=1, ge=1, le=32767)
    google_timeout_seconds: float = Field(default=10.0, gt=0, le=30)

    # ------------------------------------------------------------------ pagamentos (Fase 5)
    # off (padrão) | sandbox (chave abc_dev_, sem dinheiro real) |
    # production (chave abc_prod_ + aprovação operacional).
    payments_stage: str = "off"
    abacatepay_api_key: SecretStr | None = None
    # Segredo do webhook (32+ caracteres) cadastrado ao criar o webhook na AbacatePay.
    abacatepay_webhook_secret: SecretStr | None = None
    # Chave PÚBLICA HMAC da AbacatePay (constante da documentação de segurança dos webhooks).
    # Copie exatamente de docs.abacatepay.com/pages/notificacoes/seguranca. Sem ela, todo webhook
    # é recusado.
    abacatepay_webhook_public_key: SecretStr | None = None
    # Split Pix com subcontas: só depois que o suporte da AbacatePay habilitar na conta.
    abacatepay_split_enabled: bool = False
    # Saques são irreversíveis e ficam desligados até homologação financeira explícita.
    subaccount_withdrawals_enabled: bool = False
    # Autorização operacional EXPLÍCITA para cobrar de verdade.
    payments_production_approved: bool = False
    payments_hold_seconds: int = Field(default=900, ge=300, le=3600)
    abacatepay_timeout_seconds: float = Field(default=10.0, gt=0, le=30)

    @field_validator("payments_stage")
    @classmethod
    def _validate_payments_stage(cls, value: str) -> str:
        if value not in {"off", "sandbox", "production"}:
            raise ValueError("API_PAYMENTS_STAGE aceita apenas off, sandbox ou production")
        return value

    @model_validator(mode="after")
    def _payments_guardrails(self) -> "Settings":
        """Impede subir com chave do ambiente errado (falha na inicialização, não na cobrança)."""
        key = self.abacatepay_api_key.get_secret_value() if self.abacatepay_api_key else ""
        if key.startswith("abc_prod_") and self.payments_stage != "production":
            raise ValueError(
                "chave de PRODUÇÃO da AbacatePay só é aceita com API_PAYMENTS_STAGE=production"
            )
        if self.payments_stage == "sandbox" and key and not key.startswith("abc_dev_"):
            raise ValueError("API_PAYMENTS_STAGE=sandbox exige chave de desenvolvimento (abc_dev_)")
        if self.payments_stage == "production":
            if not key.startswith("abc_prod_"):
                raise ValueError(
                    "API_PAYMENTS_STAGE=production exige chave de produção (abc_prod_)"
                )
            if not self.payments_production_approved:
                raise ValueError(
                    "produção exige API_PAYMENTS_PRODUCTION_APPROVED=true (autorização operacional)"
                )
            if not self.abacatepay_split_enabled:
                raise ValueError(
                    "produção exige API_ABACATEPAY_SPLIT_ENABLED=true "
                    "(Pix real sem split é bloqueado)"
                )
        secret = self.abacatepay_webhook_secret
        if secret is not None and len(secret.get_secret_value()) < 32:
            raise ValueError("API_ABACATEPAY_WEBHOOK_SECRET precisa ter ao menos 32 caracteres")
        return self

    @property
    def payments_configured(self) -> bool:
        return bool(
            self.payments_stage != "off"
            and self.abacatepay_api_key
            and self.abacatepay_webhook_secret
            and self.abacatepay_webhook_public_key
        )

    @field_validator("scheduling_stage")
    @classmethod
    def _validate_stage(cls, value: str) -> str:
        if value not in {"off", "testing"}:
            raise ValueError("API_SCHEDULING_STAGE aceita apenas off ou testing")
        return value

    @field_validator("google_oauth_redirect_uri")
    @classmethod
    def _validate_redirect(cls, value: str | None) -> str | None:
        if value is None or value.strip() == "":
            return None
        parts = urlsplit(value.strip())
        local = parts.hostname in {"localhost", "127.0.0.1"}
        if parts.scheme != "https" and not (local and parts.scheme == "http"):
            raise ValueError("API_GOOGLE_OAUTH_REDIRECT_URI deve usar https")
        if not parts.netloc or parts.query or parts.fragment:
            raise ValueError("API_GOOGLE_OAUTH_REDIRECT_URI deve ser uma URL exata, sem query")
        return value.strip()

    @property
    def calendar_configured(self) -> bool:
        return bool(
            self.google_oauth_client_id
            and self.google_oauth_client_secret
            and self.google_oauth_redirect_uri
            and self.token_encryption_key
        )

    @field_validator("cors_origins")
    @classmethod
    def _validate_origins(cls, value: str) -> str:
        for origin in _split_csv(value):
            parts = urlsplit(origin)
            if origin == "*" or "*" in origin:
                raise ValueError("API_CORS_ORIGINS não aceita curinga; liste as origens exatas")
            bad_scheme = parts.scheme not in {"http", "https"}
            if bad_scheme or not parts.netloc or parts.path not in {"", "/"}:
                raise ValueError(f"origem inválida em API_CORS_ORIGINS: {origin!r}")
            if parts.scheme == "http" and parts.hostname not in {"localhost", "127.0.0.1"}:
                raise ValueError(f"origem sem HTTPS só é aceita para localhost: {origin!r}")
        return value

    @field_validator("supabase_url")
    @classmethod
    def _validate_supabase_url(cls, value: str | None) -> str | None:
        if value is None or value.strip() == "":
            return None
        value = value.strip().rstrip("/")
        parts = urlsplit(value)
        local = parts.hostname in {"localhost", "127.0.0.1"}
        if parts.scheme != "https" and not (local and parts.scheme == "http"):
            raise ValueError("API_SUPABASE_URL deve usar https")
        if parts.path or parts.query:
            raise ValueError("API_SUPABASE_URL deve ser só a origem do projeto (sem caminho)")
        return value

    @field_validator("jwt_algorithms")
    @classmethod
    def _validate_algorithms(cls, value: str) -> str:
        algs = _split_csv(value)
        if not algs or any(a not in _ALLOWED_JWT_ALGORITHMS for a in algs):
            raise ValueError(f"API_JWT_ALGORITHMS aceita apenas {sorted(_ALLOWED_JWT_ALGORITHMS)}")
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.rstrip("/") for o in _split_csv(self.cors_origins)]

    @property
    def jwt_algorithm_list(self) -> list[str]:
        return _split_csv(self.jwt_algorithms)

    @property
    def jwt_issuer(self) -> str | None:
        return f"{self.supabase_url}/auth/v1" if self.supabase_url else None

    @property
    def jwks_url(self) -> str | None:
        return f"{self.supabase_url}/auth/v1/.well-known/jwks.json" if self.supabase_url else None

    @property
    def avatar_host_suffix_list(self) -> list[str]:
        suffixes = [s.lower().lstrip(".") for s in _split_csv(self.avatar_allowed_host_suffixes)]
        if self.supabase_url:
            host = urlsplit(self.supabase_url).hostname
            if host:
                suffixes.append(host.lower())
        return suffixes


@lru_cache
def get_settings() -> Settings:
    return Settings()
