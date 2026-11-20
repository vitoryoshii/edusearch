import pytest
from pydantic import ValidationError

from app.config import Settings


@pytest.mark.parametrize(
    "origins",
    ["*", "https://*.edusearch.com.br", "http://app.edusearch.com.br", "ftp://x", "https://x/path"],
)
def test_cors_origins_must_be_explicit(origins: str) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, cors_origins=origins)


@pytest.mark.parametrize("algs", ["HS256", "ES256,HS256", "none", ""])
def test_symmetric_or_empty_algorithms_rejected(algs: str) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, jwt_algorithms=algs)


def test_supabase_url_derives_issuer_and_jwks() -> None:
    s = Settings(_env_file=None, supabase_url="https://abc.supabase.co/")
    assert s.jwt_issuer == "https://abc.supabase.co/auth/v1"
    assert s.jwks_url == "https://abc.supabase.co/auth/v1/.well-known/jwks.json"
    assert "abc.supabase.co" in s.avatar_host_suffix_list


@pytest.mark.parametrize("url", ["http://abc.supabase.co", "https://abc.supabase.co/auth/v1"])
def test_supabase_url_must_be_https_origin(url: str) -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, supabase_url=url)


def test_database_url_is_secret() -> None:
    s = Settings(_env_file=None, database_url="postgresql://u:senha-ficticia@h/db")
    assert "senha-ficticia" not in repr(s)
