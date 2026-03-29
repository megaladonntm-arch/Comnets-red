import os
from urllib.parse import quote_plus

from dotenv import load_dotenv

load_dotenv()


def get_env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    if value is None:
        return default
    value = value.strip()
    return value if value else default


def normalize_database_url(raw_url: str | None) -> str:
    if not raw_url:
        return "sqlite+aiosqlite:///./app.db"
    if raw_url.startswith("postgres://"):
        return raw_url.replace("postgres://", "postgresql+asyncpg://", 1)
    if raw_url.startswith("postgresql://"):
        return raw_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return raw_url


def build_database_url() -> str:
    database_url = get_env("DATABASE_URL")
    if database_url:
        return normalize_database_url(database_url)

    host = get_env("PGHOST") or get_env("POSTGRES_HOST")
    port = get_env("PGPORT", "5432") or "5432"
    database = get_env("PGDATABASE") or get_env("POSTGRES_DB")
    user = get_env("PGUSER") or get_env("POSTGRES_USER")
    password = get_env("PGPASSWORD") or get_env("POSTGRES_PASSWORD")

    if host and database and user and password:
        return (
            "postgresql+asyncpg://"
            f"{quote_plus(user)}:{quote_plus(password)}@{host}:{port}/{database}"
        )

    return "sqlite+aiosqlite:///./app.db"


DATABASE_URL = build_database_url()
SECRET_KEY = get_env("SECRET_KEY", "change-me")
