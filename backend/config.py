import os
import secrets
from pathlib import Path
from pydantic_settings import BaseSettings


BASE_DIR = Path(__file__).parent
STORAGE_DIR = BASE_DIR / "storage"
UPLOADS_DIR = STORAGE_DIR / "uploads"
PARSED_DIR = STORAGE_DIR / "parsed"
KEY_FILE = STORAGE_DIR / ".spine.key"
JWT_SECRET_FILE = STORAGE_DIR / ".jwt_secret"


def _load_or_create_jwt_secret() -> str:
    """Load JWT secret from env var, then file, or generate and persist a new one."""
    env_val = os.environ.get("SPINE_JWT_SECRET", "").strip()
    if env_val:
        return env_val
    if JWT_SECRET_FILE.exists():
        return JWT_SECRET_FILE.read_text().strip()
    secret = secrets.token_hex(32)
    JWT_SECRET_FILE.write_text(secret)
    return secret


class Settings(BaseSettings):
    app_name: str = "Spine"
    debug: bool = False
    db_url: str = "postgresql+asyncpg://spine:spine@localhost:5433/spine"
    uploads_path: str = str(UPLOADS_DIR)
    parsed_path: str = str(PARSED_DIR)
    key_file_path: str = str(KEY_FILE)
    # Tavily key loaded from environment; never stored in DB
    tavily_api_key: str = ""
    # Auth
    jwt_secret: str = ""  # overridden post-init from file
    jwt_expire_minutes: int = 43200  # 30 days
    cookie_secure: bool = False  # set True in production via env
    cookie_samesite: str = "lax"  # set "none" in production (cross-site Vercel→Azure)
    cors_origins: str = "http://localhost:3000"
    # Admin setup key — required to create the first admin account
    setup_key: str = ""

    class Config:
        env_prefix = "SPINE_"
        env_file = BASE_DIR / ".env"
        env_file_encoding = "utf-8"


settings = Settings()

# Ensure directories exist at import time
for _dir in (UPLOADS_DIR, PARSED_DIR):
    _dir.mkdir(parents=True, exist_ok=True)

# Load/create JWT secret after storage dirs exist
if not settings.jwt_secret:
    settings.jwt_secret = _load_or_create_jwt_secret()
